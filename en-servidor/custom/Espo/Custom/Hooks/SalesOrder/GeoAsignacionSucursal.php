<?php
/************************************************************************
 * Hook m6dev – asignación geográfica de sucursal al voucher (v3).
 *
 * Entidad: SalesOrder (módulo "Voucher").
 * Disparo: beforeSave. Si el voucher trae paciente (contactId) y
 * prestaciones (prestacionesIds) pero SIN sucursal asignada, busca en
 * CSucursalPrestacion las habilitaciones vigentes
 * (disponibleVoucher=true, estado=Activa) para esas prestaciones y
 * asigna la sucursal habilitada MÁS CERCANA al paciente.
 *
 * Puntaje por candidata (gana el menor):
 *   tier 0 = misma comuna (comunasId) — manda sobre la distancia,
 *            porque una sede en la comuna del paciente siempre es
 *            mejor opción que una con GPS a miles de km;
 *   tier 1 = mismo cantón (cantonEcId);
 *   tier 2 = resto.
 *   Desempate dentro del tier: distancia haversine en km entre la
 *   comuna del paciente (FarmaComunas.latitud/longitud) y el GPS de
 *   la sucursal (FarmaSucursales.ubicaciongps "lat, lng").
 * Sin match: no asigna (prioriza, no excluye).
 *
 * Deploy en servidor: copiar a
 *   custom/Espo/Custom/Hooks/SalesOrder/GeoAsignacionSucursal.php
 * (reemplaza la v2) y reconstruir (rebuild + limpiar caché).
 ************************************************************************/

namespace Espo\Custom\Hooks\SalesOrder;

use Espo\Core\Hook\Hook\BeforeSave;
use Espo\Core\Utils\Log;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Repository\Option\SaveOptions;

/**
 * @implements BeforeSave<SalesOrder>
 */
class GeoAsignacionSucursal implements BeforeSave
{
    private EntityManager $entityManager;
    private Log $log;

    public function __construct(EntityManager $entityManager, Log $log)
    {
        $this->entityManager = $entityManager;
        $this->log = $log;
    }

    public function beforeSave(Entity $entity, SaveOptions $options): void
    {
        if ($entity->getEntityType() !== 'SalesOrder') {
            return;
        }

        // Solo auto-asignar si aún no tiene sucursal.
        if ($entity->get('farmaSucursales1Id')) {
            return;
        }

        $contactId = $entity->get('contactId');
        $productIds = $entity->get('prestacionesIds');

        if (!$contactId || empty($productIds) || !is_array($productIds)) {
            return;
        }

        $contact = $this->entityManager
            ->getRDBRepository('Contact')
            ->where(['id' => $contactId])
            ->findOne();

        if (!$contact) {
            return;
        }

        // Habilitaciones vigentes para las prestaciones pedidas.
        $habList = $this->entityManager
            ->getRDBRepository('CSucursalPrestacion')
            ->where([
                'productId' => $productIds,
                'disponibleVoucher' => true,
                'estado' => 'Activa',
            ])
            ->find();

        if (!count($habList)) {
            return;
        }

        $this->assignBest($entity, $contact, $habList);
    }

    /**
     * Elige la mejor sucursal: misma comuna > mismo cantón > resto,
     * desempatando por distancia haversine (km) cuando hay coordenadas.
     *
     * @return bool true si asignó.
     */
    private function assignBest(Entity $voucher, Entity $contact, iterable $habList): bool
    {
        $comunaId = $contact->get('comunaId');
        $cantonId = $contact->get('cantonEcId');
        $origin = $this->patientCoords($contact);

        $sucursalRepo = $this->entityManager->getRDBRepository('FarmaSucursales');

        $best = null;
        $bestTier = null;
        $bestKm = null;

        foreach ($habList as $hab) {
            $sucursal = $this->loadSucursal($sucursalRepo, $hab);

            if (!$sucursal) {
                continue;
            }

            if ($comunaId && $sucursal->get('comunasId') === $comunaId) {
                $tier = 0;
                $nivel = 'comuna';
            } elseif ($cantonId && $sucursal->get('cantonEcId') === $cantonId) {
                $tier = 1;
                $nivel = 'canton';
            } else {
                $tier = 2;
                $nivel = 'distancia';
            }

            $km = null;

            if ($origin !== null) {
                $gps = $this->parseGps($sucursal->get('ubicaciongps'));

                if ($gps !== null) {
                    $km = $this->haversineKm($origin[0], $origin[1], $gps[0], $gps[1]);
                }
            }

            if (
                $best === null
                || $tier < $bestTier
                || ($tier === $bestTier && $km !== null && ($bestKm === null || $km < $bestKm))
            ) {
                $best = $sucursal;
                $bestTier = $tier;
                $bestKm = $km;
                $bestNivel = $nivel;
            }
        }

        if ($best === null) {
            return false;
        }

        $this->assign($voucher, $best);

        $detail = 'GEO-ASIGNACION voucher=' . ($voucher->getId() ?? '(nuevo)') .
            ' sucursal=' . $best->getId() .
            ' nivel=' . $bestNivel;

        if ($bestKm !== null) {
            $detail .= ' distanciaKm=' . round($bestKm, 1);
        }

        $this->log->info($detail);

        return true;
    }

    /**
     * Coordenadas del paciente vía su comuna. Null si no hay datos.
     *
     * @return array{float, float}|null
     */
    private function patientCoords(Entity $contact): ?array
    {
        $comunaId = $contact->get('comunaId');

        if (!$comunaId) {
            return null;
        }

        $comuna = $this->entityManager
            ->getRDBRepository('FarmaComunas')
            ->where(['id' => $comunaId])
            ->findOne();

        if (!$comuna) {
            return null;
        }

        $lat = $comuna->get('latitud');
        $lng = $comuna->get('longitud');

        if (!is_numeric($lat) || !is_numeric($lng)) {
            return null;
        }

        return [(float) $lat, (float) $lng];
    }

    private function loadSucursal($sucursalRepo, Entity $hab): ?Entity
    {
        $sucursalId = $hab->get('farmaSucursalesId');

        if (!$sucursalId) {
            return null;
        }

        return $sucursalRepo
            ->where(['id' => $sucursalId])
            ->findOne();
    }

    /**
     * Parsea "lat, lng" (tolera comillas/espacios). Null si inválido.
     *
     * @return array{float, float}|null
     */
    private function parseGps($raw): ?array
    {
        if (!is_string($raw) || $raw === '') {
            return null;
        }

        if (!preg_match('/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/', $raw, $m)) {
            return null;
        }

        return [(float) $m[1], (float) $m[2]];
    }

    private function haversineKm(float $lat1, float $lon1, float $lat2, float $lon2): float
    {
        $r = 6371.0;
        $dLat = deg2rad($lat2 - $lat1);
        $dLon = deg2rad($lon2 - $lon1);
        $sLat = sin($dLat / 2);
        $sLon = sin($dLon / 2);
        $a = $sLat * $sLat + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * $sLon * $sLon;

        return 2 * $r * asin(min(1.0, sqrt($a)));
    }

    private function assign(Entity $voucher, Entity $sucursal): void
    {
        $voucher->set('farmaSucursales1Id', $sucursal->getId());

        $prestadorId = $sucursal->get('farmaPrestadorId');

        if ($prestadorId) {
            $voucher->set('farmaPrestador1Id', $prestadorId);
        }
    }
}

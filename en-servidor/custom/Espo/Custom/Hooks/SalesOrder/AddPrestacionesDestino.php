<?php
/************************************************************************
 * Hook m6dev – Ticket 10417: prestaciones complementarias.
 *
 * Entidad: SalesOrder (módulo "Voucher").
 * Disparo: afterRelate, solo para la relación 'prestaciones'. Al agregar
 * una prestación de ORIGEN a un voucher, agrega automáticamente las
 * prestaciones de DESTINO definidas por las reglas ACTIVAS de
 * CReglaPrestacionComplementaria que apliquen para el prestador y la
 * sucursal de ese voucher. Evita duplicados y bucles (un solo salto).
 *
 * Basado en el código original de referencia (hallado en el repo local
 * /home/eduardo/Escritorio/proyectos/espocrm-dev/custom/.../AddPrestacionesDestino.php,
 * autor Eduardo Romero), adaptado al nombre real de la entidad en m6dev
 * (CReglaPrestacionComplementaria, con el prefijo "C" que EspoCRM agrega
 * automáticamente a las entidades custom en este servidor) y con logging
 * agregado para mantener la misma convención que GeoAsignacionSucursal.php
 * (grep por TICKET-10417 en el log, igual que se hace con GEO-ASIGNACION).
 *
 * Deploy en servidor: copiar a
 *   custom/Espo/Custom/Hooks/SalesOrder/AddPrestacionesDestino.php
 * y reconstruir (rebuild + limpiar cache).
 *
 * v2 - 2026-09-24 - Correccion de "un solo salto" (fix anti-cascada).
 * La v1 desplegada encadenaba reglas: al agregar un destino automatico
 * (A -> B), esa B podia disparar otra regla (B -> C) dentro del mismo
 * request. El caso de prueba CP-05 lo detecto. Ahora, mientras el hook
 * esta agregando destinos de forma automatica, cualquier relacion que
 * entre desde esa misma cadena se ignora. Logica de negocio intacta.
 ************************************************************************/

namespace Espo\Custom\Hooks\SalesOrder;

use Espo\Core\Hook\Hook\AfterRelate;
use Espo\Core\Utils\Log;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use Espo\ORM\Repository\Option\RelateOptions;

/**
 * @implements AfterRelate<SalesOrder>
 */
class AddPrestacionesDestino implements AfterRelate
{
    private const ENTITY_TYPE = 'CReglaPrestacionComplementaria';

    private EntityManager $entityManager;
    private Log $log;

    /** @var array<string, array<string, bool>> Memoria anti-bucle por request. */
    private static array $processed = [];

    /** @var array<string, bool> Vouchers con destinos auto-agregandose ahora. */
    private static array $autoAdding = [];

    public function __construct(EntityManager $entityManager, Log $log)
    {
        $this->entityManager = $entityManager;
        $this->log = $log;
    }

    public function afterRelate(
        Entity $entity,
        string $relationName,
        Entity $relatedEntity,
        array $columnData,
        RelateOptions $options
    ): void {
        if ($entity->getEntityType() !== 'SalesOrder') {
            return;
        }

        if ($relationName !== 'prestaciones') {
            return;
        }

        $this->process($entity, $relatedEntity);
    }

    private function process(Entity $voucher, Entity $prestacionOrigen): void
    {
        $voucherId = $voucher->getId();

        if (!$voucherId) {
            return;
        }

        $prestacionOrigenId = $prestacionOrigen->getId();

        if (!$prestacionOrigenId) {
            return;
        }

        // Un solo salto (no recursivo): si esta relacion fue provocada por una
        // agregacion automatica anterior en la misma peticion, se ignora.
        // Sin esta guarda, A -> B y B -> C se encadenarian en un solo request.
        if (isset(self::$autoAdding[$voucherId])) {
            return;
        }

        // Anti-bucle: si este (voucher, origen) ya fue procesado en la
        // misma request, salir. Corta también reglas circulares A->B->A
        // dentro de la misma petición.
        if (isset(self::$processed[$voucherId][$prestacionOrigenId])) {
            return;
        }

        self::$processed[$voucherId][$prestacionOrigenId] = true;

        $prestadorId = $voucher->get('farmaPrestador1Id');
        $sucursalId  = $voucher->get('farmaSucursales1Id');

        if (!$prestadorId || !$sucursalId) {
            return;
        }

        // Reglas ACTIVAS cuyo origen sea la prestación relacionada y que
        // apliquen para el prestador + sucursal de este voucher.
        $reglaList = $this->entityManager
            ->getRDBRepository(self::ENTITY_TYPE)
            ->where([
                'activa'             => true,
                'prestacionOrigenId' => $prestacionOrigenId,
                'prestadorId'        => $prestadorId,
                'sucursalId'         => $sucursalId,
            ])
            ->find();

        if (!count($reglaList)) {
            return;
        }

        $relation = $this->entityManager
            ->getRDBRepository('SalesOrder')
            ->getRelation($voucher, 'prestaciones');

        $addedCount = 0;

        try {
            // Bandera activa solo durante las agregaciones automaticas: corta
            // la cascada (un destino que llega por esta via no dispara reglas).
            self::$autoAdding[$voucherId] = true;

            foreach ($reglaList as $regla) {
                $destinoList = $this->entityManager
                    ->getRDBRepository(self::ENTITY_TYPE)
                    ->getRelation($regla, 'prestacionesDestino')
                    ->find();

                if (!count($destinoList)) {
                    continue;
                }

                foreach ($destinoList as $destino) {
                    $destinoId = $destino->getId();

                    // Nunca relacionar una prestación consigo misma.
                    if ($destinoId === $prestacionOrigenId) {
                        continue;
                    }

                    // Anti-duplicados: si ya está relacionada, omitir.
                    if ($relation->isRelatedById($destinoId)) {
                        continue;
                    }

                    $relation->relateById($destinoId);

                    $addedCount++;
                }
            }
        } finally {
            unset(self::$autoAdding[$voucherId]);
        }

        if ($addedCount > 0) {
            $this->log->info(
                'TICKET-10417 voucher=' . $voucherId .
                ' origen=' . $prestacionOrigenId .
                ' agregadas=' . $addedCount
            );
        }
    }
}

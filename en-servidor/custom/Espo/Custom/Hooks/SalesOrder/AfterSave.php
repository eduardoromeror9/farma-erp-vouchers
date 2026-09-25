<?php

namespace Espo\Custom\Hooks\SalesOrder;

use Espo\ORM\Entity;
use Espo\ORM\EntityManager;

class AfterSave extends \Espo\Core\Hooks\Base
{
    public function afterSave(Entity $entity, array $options = [])
    {
        $entityManager = $this->getEntityManager();

        if ($entity->isNew()) {
            return;
        }

        $prestacionIds = $entity->getLinkMultipleIdList('prestaciones'); // Multi-relación
        $prestadorId = $entity->get('farmaPrestador1Id');
        $sucursalId = $entity->get('farmaSucursales1Id');

        foreach ($prestacionIds as $prestacionId) {

            $prestacion = $entityManager->getEntity('Product', $prestacionId);
            if (!$prestacion) {
                continue;
            }
            // $GLOBALS['log']->debug('_LOG_' . __DIR__ . __FILE__ . __LINE__ . var_export($prestacion, true));


            $idHistorialPrecio = $entityManager
                ->getRDBRepository('FarmaHistorialPrecios')
                ->Join('farmaSucursaleses')
                ->where(
                    [
                        'productId' => $prestacionId,
                        'farmaSucursaleses.id' => $sucursalId
                    ]
                )
                ->order('createdAt', 'DESC')
                ->findOne();

            // $GLOBALS['log']->debug('_LOG_' . __DIR__ . __FILE__ . __LINE__ . var_export($idHistorialPrecio, true));

            if (empty($idHistorialPrecio)) {
                continue;
            }

            $entityManager
                ->getRelation($entity, 'cPreciosHistorial')
                ->relateById($idHistorialPrecio->get('id'));
            // $GLOBALS['log']->debug('_LOG_' . __DIR__ . __FILE__ . __LINE__ . var_export($idHistorialPrecio, true));
        }
    }
}
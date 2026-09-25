/**
 * 10416 - Modal de seleccion de sucursal ordenado por cercania.
 * Copia del modal de Espo con dos cambios: muestra todas las candidatas en
 * una sola pagina y las ordena por cercania (ranking de elegibilidadFin).
 * La distancia NO se agrega al nombre porque ese texto se guarda en el
 * voucher. Sin ranking valido, se comporta como el de Espo.
 */

define([
    'views/modals/select-records',
    'custom:utils/elegibilidadFin'
], function (Dep, E10416) {

    return Dep.extend({

        // Sin paginacion: las candidatas son pocas (decenas, no miles) y
        // queremos verlas todas ordenadas de una.
        MAXIMO_CANDIDATAS: 50,

        // La coleccion ya existe y todavia no hizo fetch: aqui se instala
        // el comparator.
        setupSearch: function () {
            this.collection.maxSize = this.MAXIMO_CANDIDATAS;

            this.aplicarOrdenPorCercania();

            return Dep.prototype.setupSearch.call(this);
        },

        /**
         * Instala el comparador de cercania. Backbone ordena durante el fetch
         * si la coleccion tiene comparator, asi que no hay que forzar re-render.
         * @return {boolean} true si se pudo ordenar.
         */
        aplicarOrdenPorCercania: function () {
            if (!this.collection) {
                return false;
            }

            var filtros = this.options.filters || {};
            var condicion = filtros.id;
            var ids = condicion ? condicion.value : null;

            if (!Array.isArray(ids) || !ids.length) {
                return false;
            }

            // Devuelve null si el ranking no cubre exactamente este
            // conjunto de ids: en ese caso es mejor no ordenar que ordenar
            // con un criterio que no corresponde.
            var posiciones = E10416.obtenerPosiciones(ids);

            if (!posiciones) {
                return false;
            }

            this.collection.comparator = function (model) {
                var posicion = posiciones[model.id];

                return posicion === undefined ? 9999 : posicion;
            };

            this.collection.sort();

            return true;
        }

    });
});

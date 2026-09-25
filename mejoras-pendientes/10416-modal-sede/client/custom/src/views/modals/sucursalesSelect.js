/**
 * 10416 - Modal de seleccion de sucursal acotado y ordenado por cercania.
 * Extiende el modal de Espo con tres cambios: deja la coleccion solo con las
 * sedes candidatas del paciente, las muestra todas en una pagina y las ordena
 * por cercania (ranking de elegibilidadFin). La distancia NO se agrega al
 * nombre porque ese texto se guarda en el voucher.
 */

define([
    'views/modals/select-records',
    'custom:utils/elegibilidadFin'
], function (Dep, E10416) {

    return Dep.extend({

        // Sin paginacion: las candidatas son pocas (decenas, no miles) y
        // queremos verlas todas ordenadas de una.
        MAXIMO_CANDIDATAS: 50,

        // El padre ya fijo collection.where a partir de los filtros del
        // campo; recien ahi se puede acotar la lista.
        setupSearch: function () {
            this.collection.maxSize = this.MAXIMO_CANDIDATAS;

            var resultado = Dep.prototype.setupSearch.call(this);

            this.acotarACandidatas();
            this.aplicarOrdenPorCercania();

            return resultado;
        },

        /**
         * Deja la coleccion solo con las sedes candidatas del paciente.
         * Sin candidatas no se restringe nada: se comporta como el de Espo.
         */
        acotarACandidatas: function () {
            var ids = this.obtenerIdsCandidatas();

            if (!ids.length) {
                return false;
            }

            this.collection.where = (this.collection.where || []).concat([{
                type: 'in',
                attribute: 'id',
                value: ids
            }]);

            return true;
        },

        /**
         * Candidatas segun el filtro del campo; si el campo no trajo filtro
         * de ids (todavia no hay prestador) se usan las del ranking publicado.
         */
        obtenerIdsCandidatas: function () {
            var condicion = (this.filters || {}).id;

            if (condicion && Array.isArray(condicion.value) && condicion.value.length) {
                return condicion.value;
            }

            return E10416.obtenerCandidatasPublicadas();
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

            var posiciones = E10416.obtenerPosiciones(this.obtenerIdsCandidatas());

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

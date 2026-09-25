/**
 * 10416 - Filtro de elegibilidad de prestador del voucher.
 * Mantiene el filtro original (tipoDeVoucher + estadoPrestador) y le suma la
 * elegibilidad del paciente. Si deja 0 resultados, devuelve el original.
 */

define([
    'views/fields/link',
    'custom:utils/elegibilidadFin'
], function (Dep, E10416) {

    return Dep.extend({

        // Filtro original (sin 10416). Se usa como fallback.
        getFiltroBase: function () {
            var cTipoDeVoucher = this.model.get('cTipoDeVoucher');

            if (cTipoDeVoucher && cTipoDeVoucher.length) {
                return {
                    'tipoDeVoucher': {
                        type: 'arrayAnyOf',
                        attribute: 'tipoDeVoucher',
                        value: cTipoDeVoucher,
                        data: {
                            type: 'arrayAnyOf',
                            nameValue: cTipoDeVoucher
                        }
                    },
                    'estadoPrestador': {
                        type: 'in',
                        attribute: 'estadoPrestador',
                        value: ['Contrato vigente', 'En gestión de Adendum']
                    }
                };
            }
        },

        getSelectFilters: function () {
            var self = this;
            var base = this.getFiltroBase();
            var contactId = this.model.get('contactId');

            if (!contactId) {
                return base;
            }

            if (this.filtroElegibilidad) {
                return this.filtroElegibilidad;
            }

            // Se dispara la primera vez; despues se reutiliza.
            this.filtroElegibilidad = base || {};

            E10416.obtenerElegibles(contactId).then(function (elegibles) {
                if (!elegibles || !elegibles.length) {
                    return;
                }

                // Los prestadores que ya pasan el filtro base.
                var prestadoresBase = self.prestadoresBase || null;

                return E10416.obtenerPrestadoresElegibles(elegibles, prestadoresBase)
                    .then(function (prestadoresElegibles) {
                        if (!prestadoresElegibles || !prestadoresElegibles.length) {
                            return;
                        }

                        var filtro = {
                            'id': {
                                type: 'in',
                                value: prestadoresElegibles
                            }
                        };

                        if (base) {
                            Object.keys(base).forEach(function (key) {
                                filtro[key] = base[key];
                            });
                        }

                        // IMPORTANTE: el filtro combinado puede quedar vacio
                        // (ej. los elegibles no tienen "Contrato vigente"). En
                        // ese caso se conserva el filtro base: es preferible
                        // mostrar de mas que dejar a la ejecutiva sin opciones.
                        if (self.consultarCantidad(filtro) > 0) {
                            self.filtroElegibilidad = filtro;
                            self.render();
                        }
                    });
            }).catch(function () {
                // sin filtro de elegibilidad: se mantiene el original
            });

            return this.filtroElegibilidad;
        },

        // Cuenta cuantos registros devolveria un filtro. Si es 0, el filtro
        // es contraproducente y se descarta.
        consultarCantidad: function (filtro) {
            var where = [];

            Object.keys(filtro).forEach(function (key) {
                var condicion = filtro[key];

                where.push({
                    type: condicion.type,
                    attribute: condicion.attribute || key,
                    value: condicion.value
                });
            });

            return Espo.Ajax.getRequest('FarmaPrestador', {
                maxSize: 1,
                where: where
            }).then(function (response) {
                return response.total || 0;
            }).catch(function () {
                return 0;
            });
        },

        getCreateAttributes: function () {
            var cTipoDeVoucher = this.model.get('cTipoDeVoucher');

            if (cTipoDeVoucher) {
                return {
                    'tipoDeVoucher': cTipoDeVoucher
                };
            }
        }

    });
});

/**
 * 10416 - Filtro de elegibilidad de sucursal del voucher.
 * Mantiene el filtro original (sucursales del prestador) y le suma la
 * elegibilidad del paciente. Ademas prellena la sede mas cercana, sin pisar la
 * eleccion de la ejecutiva, con el criterio del hook GeoAsignacionSucursal.php.
 * MEJORA PENDIENTE: el filtro ya no exige prestador y la vista se refresca al
 * cambiarlo. Ver LEEME.md en la raiz de esta carpeta.
 */

define([
    'views/fields/link',
    'custom:utils/elegibilidadFin'
], function (Dep, E10416) {

    return Dep.extend({

        // Evita reentradas mientras se escribe la sede sugerida.
        prellenando: false,

        setup: function () {
            Dep.prototype.setup.call(this);

            // El campo de la vista de error (panel lateral) tambien es de tipo
            // link y no lleva este modulo.
            if (this.mode === 'edit' || this.mode === 'create') {
                this.listenTo(
                    this.model,
                    'change:contactId',
                    this.sugerirSucursalMasCercana,
                    this
                );
            }

            // El ranking se publica para que el modal pueda ordenar.
            this.listenTo(this.model, 'change:contactId', this.publicarRanking, this);

            // El filtro depende del prestador: hay que recalcularlo cuando
            // cambia, si no la vista sigue con la lista anterior.
            this.listenTo(this.model, 'change:farmaPrestador1Id', this.recalcularFiltro, this);
        },

        recalcularFiltro: function () {
            this.filtrosElegibilidad = null;
            this.fetch();
        },

        /**
         * Calcula el ranking de sucursales del paciente y lo publica para
         * que el modal de selección lo use.
         */
        publicarRanking: function () {
            var self = this;
            var contactId = this.model.get('contactId');

            if (!contactId) {
                return;
            }

            E10416.obtenerElegibles(contactId).then(function (elegibles) {
                if (!elegibles || !elegibles.length) {
                    return null;
                }

                return E10416.ordenarSucursalesPorCercania(contactId, elegibles);
            }).then(function (orden) {
                E10416.publicarRanking(orden);
            }).catch(function () {
                // sin datos: el modal sencillamente no ordena
            });
        },

        /**
         * Escribe la sucursal más cercana en el voucher. No hace nada si ya hay
         * una, si el paciente no tiene medicamento o registro en el diccionario,
         * si ninguna sucursal sirve, o si la ganadora no tiene distancia
         * calculable. En esos casos el filtro sigue funcionando.
         */
        sugerirSucursalMasCercana: function () {
            var self = this;

            if (this.prellenando) {
                return;
            }

            // Ya hay una sede: nunca se pisa la decisión de la ejecutiva.
            if (this.model.get('farmaSucursales1Id')) {
                return;
            }

            var contactId = this.model.get('contactId');

            if (!contactId) {
                return;
            }

            this.prellenando = true;

            E10416.obtenerElegibles(contactId).then(function (elegibles) {
                if (!elegibles || !elegibles.length) {
                    return null;
                }

                return E10416.ordenarSucursalesPorCercania(contactId, elegibles);
            }).then(function (orden) {
                E10416.publicarRanking(orden);

                // La regla de "solo prellenar si hay distancia real" vive en
                // el modulo (elegirSucursalPrellenable) para que quede
                // probada y no se pueda olvidar.
                var mejor = E10416.elegirSucursalPrellenable(orden);

                if (!mejor) {
                    return;
                }

                // Re-chequeo: entremedio la ejecutiva pudo poner una sede.
                if (self.model.get('farmaSucursales1Id')) {
                    return;
                }
                var cambios = {
                    'farmaSucursales1Id': mejor.id,
                    'farmaSucursales1Name': mejor.name
                };

                // La sede implica su prestador (igual que hace el hook 10420).
                // Sin esto, la sede prellenada no aparecería en su propio
                // desplegable, que filtra por prestador.
                if (mejor.farmaPrestadorId) {
                    cambios['farmaPrestador1Id'] = mejor.farmaPrestadorId;
                    cambios['farmaPrestador1Name'] = mejor.farmaPrestadorName;
                }

                self.model.set(cambios);
            }).catch(function () {
                // Cualquier falla deja el voucher como estaba.
            }).then(function () {
                self.prellenando = false;
            });
        },

        /**
         * Inyecta nuestro modal de selección (el que ordena por cercanía).
         * Espo resuelve esta propiedad en actionSelect(); como el layout de
         * FarmaSucursales no define selectModalView, es el único punto que
         * decide qué modal se abre.
         */
        selectRecordsView: 'custom:views/modals/sucursalesSelect',

        getFiltroBase: function () {
            if (this.model.get('farmaPrestador1Id')) {
                return {
                    'farmaPrestador': {
                        type: 'equals',
                        attribute: 'farmaPrestadorId',
                        value: this.model.get('farmaPrestador1Id'),
                        data: {
                            type: 'is',
                            nameValue: this.model.get('farmaPrestadorName')
                        }
                    }
                };
            }
        },

        getSelectFilters: function () {
            var self = this;
            var base = this.getFiltroBase();
            var contactId = this.model.get('contactId');

            // Sin paciente no hay con que filtrar: solo el filtro original.
            if (!contactId) {
                return base;
            }

            // El prestador ya no es obligatorio: sin el, el filtro queda solo
            // con las sedes que sirven las prestaciones del medicamento.
            var clave = contactId + '|' + (this.model.get('farmaPrestador1Id') || '');

            if (this.filtrosElegibilidad && this.filtrosElegibilidad[clave]) {
                return this.filtrosElegibilidad[clave];
            }

            if (!this.filtrosElegibilidad) {
                this.filtrosElegibilidad = {};
            }

            this.filtrosElegibilidad[clave] = base || {};

            E10416.obtenerElegibles(contactId).then(function (elegibles) {
                if (!elegibles || !elegibles.length) {
                    return;
                }

                E10416.obtenerSucursalesElegibles(elegibles, null).then(function (sucursalesElegibles) {
                    if (!sucursalesElegibles || !sucursalesElegibles.length) {
                        return;
                    }

                    var filtro = {
                        'id': {
                            type: 'in',
                            value: sucursalesElegibles
                        }
                    };

                    if (base) {
                        Object.keys(base).forEach(function (key) {
                            filtro[key] = base[key];
                        });
                    }

                    // Si el filtro combinado deja 0 resultados se descarta y
                    // se conserva el filtro original: es preferible mostrar de
                    // mas que dejar a la ejecutiva sin opciones.
                    self.consultarCantidad(filtro).then(function (cantidad) {
                        if (cantidad > 0) {
                            self.filtrosElegibilidad[clave] = filtro;
                            self.render();
                        }
                    });
                });
            }).catch(function () {
                // sin filtro de elegibilidad: se mantiene el original
            });

            return this.filtrosElegibilidad[clave];
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

            return Espo.Ajax.getRequest('FarmaSucursales', {
                maxSize: 1,
                where: where
            }).then(function (response) {
                return response.total || 0;
            }).catch(function () {
                return 0;
            });
        },

        getCreateAttributes: function () {
            if (this.model.get('farmaPrestador1Id')) {
                return {
                    id: this.model.get('farmaPrestador1Id'),
                    name: this.model.get('farmaPrestadorName')
                };
            }
        }

    });
});

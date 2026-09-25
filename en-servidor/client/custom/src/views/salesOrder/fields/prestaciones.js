/**
 * 10416 - Filtro de elegibilidad de prestaciones del voucher.
 * Cruza las habilitadas en la sede (CSucursalPrestacion + FarmaHistorialPrecios)
 * con las elegibles del paciente. Sin coincidencia, no restringe.
 */

define([
    'views/fields/link-multiple',
    'custom:utils/elegibilidadFin'
], function (Dep, E10416) {

    const filterLinkField = 'farmaPrestador1';
    const attributeField = 'farmaPrestador';
    const sucursalField = 'farmaSucursales1';

    return Dep.extend({

        selectFilters: null,

        setup: function () {
            Dep.prototype.setup.call(this);

            this.listenTo(
                this.model,
                'change:' + filterLinkField + 'Id change:' + sucursalField +
                    'Id change:contactId',
                this.updateSelectFilters,
                this
            );

            this.updateSelectFilters();
        },

        // Con prestador+sucursal abre el modal custom (viene del desarrollador
        // original, 21-sep). Sin sede abre el de Espo: el filtro del
        // diccionario ya esta aplicado sobre la coleccion.
        actionSelect: function () {
            const self = this;

            const prestadorId = this.model.get(filterLinkField + 'Id');
            const sucursalId = this.model.get(sucursalField + 'Id');

            if (!prestadorId || !sucursalId) {
                Dep.prototype.actionSelect.call(this);
                return;
            }

            const ids =
                this.selectFilters &&
                this.selectFilters.id &&
                Array.isArray(this.selectFilters.id.value)
                    ? this.selectFilters.id.value
                    : [];

            if (!ids.length) {
                Espo.Ui.warning('No hay prestaciones asociadas al proveedor o a la sucursal seleccionada.');
                return;
            }

            this.createView(
                'prestacionesSelect',
                'custom:views/modals/prestaciones-select',
                {
                    productIds: ids
                },
                function (view) {
                    self.listenTo(view, 'select', function (items) {
                        items.forEach(function (item) {
                            self.addLink(item.id, item.name);
                        });
                    });

                    view.render();
                }
            );
        },

        updateSelectFilters: function () {
            const prestadorId = this.model.get(filterLinkField + 'Id');
            const sucursalId = this.model.get(sucursalField + 'Id');
            const contactId = this.model.get('contactId');
            const self = this;

            // Sin prestador/sucursal todavia no se puede cruzar con lo que
            // ofrece la sede, pero si se puede filtrar por el diccionario del
            // paciente: sin esto se veria el catalogo completo.
            if (!prestadorId || !sucursalId) {
                E10416.obtenerElegibles(contactId).then(function (elegibles) {
                    if (!elegibles || !elegibles.length) {
                        self.sinRestriccion();

                        return;
                    }

                    self.selectFilters = {
                        id: { type: 'in', value: elegibles }
                    };

                    self.fetch();
                }).catch(function () {
                    self.sinRestriccion();
                });

                return;
            }

            Promise.all([
                E10416.obtenerDisponibles(prestadorId, sucursalId),
                E10416.obtenerElegibles(contactId)
            ]).then(function (resultados) {
                const disponibles = resultados[0];
                const elegibles = resultados[1];

                // Sin datos de sede: se deja pasar (fallback seguro).
                if (!disponibles) {
                    self.sinRestriccion();

                    return;
                }

                // 10416: cruce con elegibilidad por programa + medicamento.
                const filtradas = E10416.intersecar(elegibles, disponibles);

                // Sin match de elegibilidad -> se deja pasar todo lo de la sede
                // (modo sugerencia, no bloqueo).
                if (!filtradas || !filtradas.length) {
                    self.sinRestriccion();

                    return;
                }

                self.selectFilters = {
                    id: { type: 'in', value: filtradas }
                };

                self.fetch();
            }).catch(function () {
                self.sinRestriccion();
            });
        },

        // Selector sin restricción: todo lo habilitado en la sede.
        sinRestriccion: function () {
            const prestadorId = this.model.get(filterLinkField + 'Id');
            const sucursalId = this.model.get(sucursalField + 'Id');

            if (!prestadorId || !sucursalId) {
                this.selectFilters = null;

                if (this.collection) {
                    this.collection.reset([]);
                }

                this.fetch();

                return;
            }

            E10416.obtenerDisponibles(prestadorId, sucursalId).then(function (disponibles) {
                if (!disponibles || !disponibles.length) {
                    this.clearField();

                    return;
                }

                this.selectFilters = {
                    id: { type: 'in', value: disponibles }
                };

                this.fetch();
            }.bind(this)).catch(function () {
                this.clearField();
            }.bind(this));
        },

        clearField: function () {
            this.selectFilters = {
                id: { type: 'equals', value: '000000000000000000' }
            };

            if (this.collection) {
                this.collection.reset([]);
            }

            this.fetch();
        },

        getSelectFilters: function () {
            return this.selectFilters || {};
        }

    });
});

/**
 * 10416 - Logica compartida de elegibilidad de prestaciones y sucursales.
 * Clave: medicamento del paciente (Contact.produtoId) -> elegibles
 * (CDiccionarioPMP), cruzadas con lo habilitado en la sede elegida.
 * teams1 (programa) no filtra y el diagnostico no participa.
 * Modo sugerencia: acorta la lista, nunca bloquea; sin match devuelve null.
 * El orden por cercania replica el hook GeoAsignacionSucursal.php.
 * Autor: Eduardo Romero.
 */

define('custom:utils/elegibilidadFin', [], function () {

    var MANTENEDOR = 'CDiccionarioPMP';
    var ATRIBUTO_MEDICAMENTO = 'farmaProdutos';

    // Cache en memoria durante la sesion del navegador.
    // clave: 'elegibles:<contactId>'
    var cacheElegibles = {};
    // clave: 'sucursales:<prestadorId>' y 'prestadores:<productIds joined>'
    var cacheProveedores = {};

    // Anti-request duplicado: evita disparar varias veces la misma consulta
    // cuando el usuario cambia prestador/sucursal muy rapido.
    var enCurso = {};

    /**
     * Devuelve el objecto Contact del paciente del voucher.
     * null si el voucher no tiene paciente.
     */
    function obtenerPaciente(contactId) {
        if (!contactId) {
            return Promise.resolve(null);
        }

        return Espo.Ajax.getRequest('Contact/' + contactId, {
            select: 'id,teamsIds,produtoId,comunaId,cantonEcId'
        }).then(function (paciente) {
            return paciente || null;
        }).catch(function () {
            return null;
        });
    }

    /**
     * Prestaciones elegibles para el paciente.
     *
     * @param {string} contactId  Contact del paciente del voucher
     * @return {Promise<Array|null>} array de productIds, o null si NO aplica
     *                              el filtro (sin programa, sin medicamento,
     *                              sin match, o error). null = no restringir.
     */
    function obtenerElegibles(contactId) {
        if (!contactId) {
            return Promise.resolve(null);
        }

        if (cacheElegibles[contactId] !== undefined) {
            return Promise.resolve(cacheElegibles[contactId]);
        }

        if (enCurso['eg:' + contactId]) {
            return enCurso['eg:' + contactId];
        }

        var promesa = obtenerPaciente(contactId).then(function (paciente) {
            if (!paciente) {
                return null;
            }

            var medicamento = paciente.produtoId;

            // Sin medicamento no hay clave de busqueda: no se restringe nada.
            // Ojo: teams1 (programa) ya NO es parte de la clave desde el
            // 25-sep-2026. Queda en el mantenedor como documentacion.
            if (!medicamento) {
                return null;
            }

            var where = [
                {
                    type: 'linkedWith',
                    attribute: ATRIBUTO_MEDICAMENTO,
                    value: medicamento
                }
            ];

            return Espo.Ajax.getRequest(MANTENEDOR, {
                maxSize: 200,
                select: 'id,name,productsIds',
                where: where
            }).then(function (response) {
                var ids = {};
                var total = 0;

                (response.list || []).forEach(function (registro) {
                    (registro.productsIds || []).forEach(function (productId) {
                        ids[productId] = true;
                        total++;
                    });
                });

                // Sin registros coincidentes -> no se restringe.
                if (!total) {
                    return null;
                }

                return Object.keys(ids);
            }).catch(function () {
                // Si el usuario no tiene permiso sobre el mantenedor, o la
                // API falla, se deja pasar todo en vez de dejar sin
                // prestaciones a la ejecutiva.
                return null;
            });
        });

        enCurso['eg:' + contactId] = promesa;

        return promesa.then(function (resultado) {
            cacheElegibles[contactId] = resultado;
            delete enCurso['eg:' + contactId];

            return resultado;
        }, function (error) {
            delete enCurso['eg:' + contactId];

            throw error;
        });
    }

    /**
     * Interseca dos listas de ids. null en cualquiera de las entradas
     * significa "sin restriccion" y devuelve null.
     */
    function intersecar(conRestriccion, sinRestriccion) {
        if (!conRestriccion) {
            return null;
        }

        if (!sinRestriccion) {
            return conRestriccion;
        }

        var permitidos = {};
        sinRestriccion.forEach(function (id) {
            permitidos[id] = true;
        });

        return conRestriccion.filter(function (id) {
            return !!permitidos[id];
        });
    }

    /**
     * Prestaciones habilitadas en una sucursal.
     * Usa CSucursalPrestacion (producto + sucursal + estado + disponibleVoucher).
     *
     * @return {Promise<Array|null>} productIds, o null si no hay info.
     */
    function obtenerPrestacionesDeSucursal(sucursalId) {
        if (!sucursalId) {
            return Promise.resolve(null);
        }

        if (cacheProveedores['suc:' + sucursalId] !== undefined) {
            return Promise.resolve(cacheProveedores['suc:' + sucursalId]);
        }

        return Espo.Ajax.getRequest('CSucursalPrestacion', {
            maxSize: 500,
            select: 'id,productId,farmaSucursalesId,estado,disponibleVoucher',
            where: [
                {
                    type: 'equals',
                    attribute: 'farmaSucursalesId',
                    value: sucursalId
                },
                {
                    type: 'equals',
                    attribute: 'estado',
                    value: 'Activa'
                },
                {
                    type: 'equals',
                    attribute: 'disponibleVoucher',
                    // OJO: la API de Espo NO acepta el booleano "true" en
                    // este filtro (devuelve 0). Hay que mandar 1.
                    value: 1
                }
            ]
        }).then(function (response) {
            var ids = {};

            (response.list || []).forEach(function (registro) {
                if (registro.productId) {
                    ids[registro.productId] = true;
                }
            });

            var resultado = Object.keys(ids);

            cacheProveedores['suc:' + sucursalId] = resultado;

            return resultado;
        }).catch(function () {
            return null;
        });
    }

    /**
     * Prestaciones de un prestador usando el historico de precios
     * (mismo criterio que usaba el filtro anterior de la vista).
     *
     * @return {Promise<Array|null>} productIds, o null si no hay info.
     */
    function obtenerPrestacionesDePrestador(prestadorId, sucursalId) {
        if (!prestadorId) {
            return Promise.resolve(null);
        }

        var where = [
            {
                type: 'equals',
                attribute: 'farmaPrestadorId',
                value: prestadorId
            }
        ];

        if (sucursalId) {
            where.push({
                type: 'linkedWith',
                attribute: 'farmaSucursaleses',
                value: sucursalId
            });
        }

        return Espo.Ajax.getRequest('FarmaHistorialPrecios', {
            maxSize: 500,
            sortBy: 'createdAt',
            asc: false,
            select: 'id,productId',
            where: where
        }).then(function (response) {
            var ids = {};

            (response.list || []).forEach(function (registro) {
                if (registro.productId) {
                    ids[registro.productId] = true;
                }
            });

            return Object.keys(ids);
        }).catch(function () {
            return null;
        });
    }

    /**
     * Prestaciones habilitadas en la sucursal + prestador.
     * Une las dos fuentes disponibles para no perder opciones.
     */
    function obtenerDisponibles(prestadorId, sucursalId) {
        return Promise.all([
            obtenerPrestacionesDeSucursal(sucursalId),
            obtenerPrestacionesDePrestador(prestadorId, sucursalId)
        ]).then(function (resultados) {
            var porSucursal = resultados[0];
            var porPrestador = resultados[1];

            if (!porSucursal && !porPrestador) {
                return null;
            }

            var ids = {};

            (porSucursal || []).forEach(function (id) {
                ids[id] = true;
            });

            (porPrestador || []).forEach(function (id) {
                ids[id] = true;
            });

            return Object.keys(ids);
        });
    }

    /**
     * IDs de las sucursales que ofrecen al menos una prestacion elegible.
     *
     * @param {Array} elegibles
     * @param {Array|null} sucursalIds  restriction adicional (prestador elegido)
     * @return {Promise<Array|null>} sucursalIds, o null si no aplica.
     */
    function obtenerSucursalesElegibles(elegibles, sucursalIds) {
        if (!elegibles || !elegibles.length) {
            return Promise.resolve(null);
        }

        var where = [
            {
                type: 'in',
                attribute: 'productId',
                value: elegibles
            },
            {
                type: 'equals',
                attribute: 'estado',
                value: 'Activa'
            },
            {
                type: 'equals',
                attribute: 'disponibleVoucher',
                // OJO: la API de Espo NO acepta el booleano "true" aqui.
                value: 1
            }
        ];

        return Espo.Ajax.getRequest('CSucursalPrestacion', {
            maxSize: 500,
            select: 'id,productId,farmaSucursalesId',
            where: where
        }).then(function (response) {
            var ids = {};

            (response.list || []).forEach(function (registro) {
                if (registro.farmaSucursalesId) {
                    ids[registro.farmaSucursalesId] = true;
                }
            });

            var resultado = Object.keys(ids);

            if (!resultado.length) {
                return null;
            }

            return intersecar(resultado, sucursalIds);
        }).catch(function () {
            return null;
        });
    }

    /**
     * IDs de los prestadores elegibles (los que tienen alguna sucursal con
     * una prestacion elegible habilitada).
     *
     * @param {Array} elegibles
     * @param {Array|null} prestadorIds  filtro adicional (estado/tipo)
     * @return {Promise<Array|null>} prestadorIds, o null si no aplica.
     */
    function obtenerPrestadoresElegibles(elegibles, prestadorIds) {
        if (!elegibles || !elegibles.length) {
            return Promise.resolve(null);
        }

        return obtenerSucursalesElegibles(elegibles, null).then(function (sucursalIds) {
            if (!sucursalIds) {
                return null;
            }

            return Espo.Ajax.getRequest('FarmaSucursales', {
                maxSize: 500,
                select: 'id,name,farmaPrestadorId',
                where: [
                    {
                        type: 'in',
                        attribute: 'id',
                        value: sucursalIds
                    }
                ]
            }).then(function (response) {
                var ids = {};

                (response.list || []).forEach(function (sucursal) {
                    if (sucursal.farmaPrestadorId) {
                        ids[sucursal.farmaPrestadorId] = true;
                    }
                });

                var resultado = Object.keys(ids);

                if (!resultado.length) {
                    return null;
                }

                return intersecar(resultado, prestadorIds);
            });
        }).catch(function () {
            return null;
        });
    }

    // SUCURSAL MÁS CERCANA - mismo criterio que GeoAsignacionSucursal.php
    // (misma comuna > mismo cantón > menor distancia; sin coordenadas, al final)
    // para que la pantalla y el hook al guardar propongan la misma sede.

    var RADIO_TIERRA_KM = 6371.0;

    // Parsea el texto "lat, lng" de FarmaSucursales.ubicaciongps.
    // Devuelve null si no hay coordenadas utilizables.
    function parseGps(raw) {
        if (typeof raw !== 'string' || raw === '') {
            return null;
        }

        var partes = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);

        if (!partes) {
            return null;
        }

        return [parseFloat(partes[1]), parseFloat(partes[2])];
    }

    // Distancia en km entre dos puntos. Misma formula que el hook.
    function haversineKm(lat1, lon1, lat2, lon2) {
        var rad = Math.PI / 180;

        var dLat = (lat2 - lat1) * rad;
        var dLon = (lon2 - lon1) * rad;

        var sLat = Math.sin(dLat / 2);
        var sLon = Math.sin(dLon / 2);

        var a = sLat * sLat +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * sLon * sLon;

        return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    // Coordenadas del paciente, vía la comuna de su domicilio.
    // null si no tiene comuna o la comuna no está georreferenciada.
    function obtenerOrigen(contactId) {
        if (!contactId) {
            return Promise.resolve(null);
        }

        if (cacheProveedores['origen:' + contactId] !== undefined) {
            return Promise.resolve(cacheProveedores['origen:' + contactId]);
        }

        var promesa = obtenerPaciente(contactId).then(function (paciente) {
            if (!paciente || !paciente.comunaId) {
                return null;
            }

            return Espo.Ajax.getRequest('FarmaComunas/' + paciente.comunaId, {
                select: 'id,latitud,longitud'
            }).then(function (comuna) {
                var lat = comuna ? Number(comuna.latitud) : NaN;
                var lng = comuna ? Number(comuna.longitud) : NaN;

                if (!isFinite(lat) || !isFinite(lng)) {
                    return null;
                }

                return [lat, lng];
            }).catch(function () {
                return null;
            });
        });

        enCurso['origen:' + contactId] = promesa;

        return promesa.then(function (origen) {
            cacheProveedores['origen:' + contactId] = origen;
            delete enCurso['origen:' + contactId];

            return origen;
        }, function (error) {
            delete enCurso['origen:' + contactId];

            throw error;
        });
    }

    /**
     * Sucursales candidatas, de más cercana a más lejana. Solo incluye las que
     * tienen alguna prestacion elegible habilitada.
     * @param {string} contactId
     * @param {Array} elegibles  salida de obtenerElegibles()
     * @return {Promise<Array|null>} [{sucursal, tier, nivel, km}, ...] o null
     */
    function ordenarSucursalesPorCercania(contactId, elegibles) {
        if (!elegibles || !elegibles.length) {
            return Promise.resolve(null);
        }

        return Promise.all([
            obtenerSucursalesElegibles(elegibles, null),
            obtenerPaciente(contactId),
            obtenerOrigen(contactId)
        ]).then(function (resultados) {
            var sucursalIds = resultados[0];
            var paciente = resultados[1];
            var origen = resultados[2];

            if (!sucursalIds || !sucursalIds.length || !paciente) {
                return null;
            }

            return Espo.Ajax.getRequest('FarmaSucursales', {
                maxSize: 500,
                select: 'id,name,comunasId,cantonEcId,ubicaciongps,' +
                    'farmaPrestadorId,farmaPrestadorName',
                where: [
                    {
                        type: 'in',
                        attribute: 'id',
                        value: sucursalIds
                    }
                ]
            }).then(function (response) {
                var comunaPaciente = paciente.comunaId;
                var cantonPaciente = paciente.cantonEcId;

                var ordenadas = (response.list || []).map(function (sucursal) {
                    var tier;
                    var nivel;

                    if (comunaPaciente && sucursal.comunasId === comunaPaciente) {
                        tier = 0;
                        nivel = 'comuna';
                    } else if (cantonPaciente && sucursal.cantonEcId === cantonPaciente) {
                        tier = 1;
                        nivel = 'canton';
                    } else {
                        tier = 2;
                        nivel = 'distancia';
                    }

                    var km = null;

                    if (origen) {
                        var gps = parseGps(sucursal.ubicaciongps);

                        if (gps) {
                            km = haversineKm(origen[0], origen[1], gps[0], gps[1]);
                        }
                    }

                    return {
                        sucursal: sucursal,
                        tier: tier,
                        nivel: nivel,
                        km: km
                    };
                });

                if (!ordenadas.length) {
                    return null;
                }

                // Mismo criterio de desempate que el hook PHP: gana la de
                // menor distancia; la que no tiene coordenadas queda al
                // final; a igual distancia, orden alfabetico estable.
                ordenadas.sort(function (a, b) {
                    if (a.tier !== b.tier) {
                        return a.tier - b.tier;
                    }

                    if (a.km === null && b.km === null) {
                        return a.sucursal.name.localeCompare(b.sucursal.name);
                    }

                    if (a.km === null) {
                        return 1;
                    }

                    if (b.km === null) {
                        return -1;
                    }

                    if (a.km !== b.km) {
                        return a.km - b.km;
                    }

                    return a.sucursal.name.localeCompare(b.sucursal.name);
                });

                return ordenadas;
            });
        }).catch(function () {
            // Sin permisos, sin red o sin datos: se deja como estaba.
            return null;
        });
    }

    // Ranking publicado por la vista del campo: el modal no ve el voucher.
    // Si los ids no coinciden, el modal no ordena (degrada sin romper).
    var ultimoRanking = null;

    /**
     * Sucursal a prellenar, o null.
     * REGLA DE ORO: solo si la ganadora tiene distancia REAL. Sin esta guarda
     * un paciente sin comuna cae al orden alfabetico y se propondria una sede
     * en Ecuador; en ese caso no se propone nada y elige la ejecutiva.
     * @param {Array|null} orden  salida de ordenarSucursalesPorCercania()
     * @return {Object|null}
     */
    function elegirSucursalPrellenable(orden) {
        if (!orden || !orden.length) {
            return null;
        }

        if (orden[0].km === null) {
            return null;
        }

        return orden[0].sucursal;
    }

    return {
        obtenerElegibles: obtenerElegibles,
        obtenerDisponibles: obtenerDisponibles,
        obtenerPrestacionesDeSucursal: obtenerPrestacionesDeSucursal,
        obtenerPrestacionesDePrestador: obtenerPrestacionesDePrestador,
        obtenerSucursalesElegibles: obtenerSucursalesElegibles,
        obtenerPrestadoresElegibles: obtenerPrestadoresElegibles,
        ordenarSucursalesPorCercania: ordenarSucursalesPorCercania,
        elegirSucursalPrellenable: elegirSucursalPrellenable,
        publicarRanking: function (orden) {
            ultimoRanking = orden;
        },
        // Devuelve {id -> posicion} si el ranking cubre exactamente el
        // conjunto de ids recibido. Si no, null (el modal no ordena).
        obtenerPosiciones: function (ids) {
            if (!ultimoRanking || !ultimoRanking.length || !ids || !ids.length) {
                return null;
            }

            var mapa = {};
            var i;

            for (i = 0; i < ultimoRanking.length; i++) {
                mapa[ultimoRanking[i].sucursal.id] = i;
            }

            if (Object.keys(mapa).length !== ids.length) {
                return null;
            }

            for (i = 0; i < ids.length; i++) {
                if (mapa[ids[i]] === undefined) {
                    return null;
                }
            }

            return mapa;
        },
        haversineKm: haversineKm,
        parseGps: parseGps,
        intersecar: intersecar
    };
});

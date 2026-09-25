const E = require('./arnes-10416.js');

const PACIENTE = '6ab572f5633f14cc8'; // Kesimpta
const KESIMPTAS = '6a9726b7dbc6ee60c';
const COSENTYX = '6a9726acc3a8275b8'; // variante con principio activo
const SUC_CENTRO = '6ab2b497bf0956353';
const SUC_LAS_CONDES = '6ab2b498417937e47';
const SUC_MELIPILLA = '6ab2b498062ff36c3';

function tit(t) { console.log('\n' + '='.repeat(66) + '\n' + t + '\n' + '='.repeat(66)); }

(async () => {
    // ------------------------------------------------------------------
    tit('1. Clave por MEDICAMENTO (sin programa)');
    const kesi = await E.obtenerElegibles(PACIENTE);
    console.log('Kesimpta ->', kesi ? kesi.length + ' ids' : 'null (sin match)');

    // Un paciente que NO esta en Siempre Contigo: el filtro debe igual
    // funcionar, porque la clave es solo el medicamento.
    const sinEquipo = '6ab56b88bfd20dfba'; // paciente sin comuna del 10417
    const sinEquipoEleg = await E.obtenerElegibles(sinEquipo);
    console.log('paciente 10417 (sin equipo, sin comuna) ->',
        sinEquipoEleg ? sinEquipoEleg.length + ' ids' : 'null (fallback: sin restricciones)');

    // ------------------------------------------------------------------
    tit('2. Paciente SIN medicamento -> fallback (no bloquea)');
    const sinMed = await E.obtenerElegibles('0000000000000000ff');
    console.log('contactId inexistente ->', sinMed === null ? 'null CORRECTO' : 'ERROR');
    const sinMed2 = await E.obtenerElegibles(null);
    console.log('contactId nulo ->', sinMed2 === null ? 'null CORRECTO' : 'ERROR');

    // ------------------------------------------------------------------
    tit('3. Orden por cercania');
    const orden = await E.ordenarSucursalesPorCercania(PACIENTE, kesi);
    if (!orden) {
        console.log('null -> sin match o sin datos (paciente sin comuna)');
    } else {
        orden.forEach((o, i) => {
            const km = o.km === null ? 'sin GPS' : o.km.toFixed(1) + ' km';
            console.log(`  ${i + 1}. ${o.sucursal.name}  [${o.nivel}] ${km}`);
        });
    }

    // ------------------------------------------------------------------
    tit('4. Mismo calculo CON comuna (forzada) - valida el ranking');
    // El paciente de prueba no tiene comuna, asi que forzamos el calculo
    // con coordenadas reales para verificar el orden.
    const origenSantiago = { id: 'x', comune: 'SANTIAGO', lat: -33.4569, lng: -70.6483 };
    // Reimplementamos el ranking con el mismo codigo del modulo, alimentados
    // a mano, para comprobar que Melipilla queda al final.
    const kmm = (a, b, c, d) => {
        const r = Math.PI / 180, R = 6371;
        const dLat = (c - a) * r, dLon = (d - b) * r;
        const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
        const x = s1 * s1 + Math.cos(a * r) * Math.cos(c * r) * s2 * s2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
    };
    console.log('Valparaiso  -> Santiago Centro :',
        kmm(-33.0472, -71.6127, -33.4492, -70.6627).toFixed(1), 'km');
    console.log('Valparaiso  -> Las Condes      :',
        kmm(-33.0472, -71.6127, -33.4117, -70.5485).toFixed(1), 'km');
    console.log('Valparaiso  -> Melipilla       :',
        kmm(-33.0472, -71.6127, -33.6855, -71.2146).toFixed(1), 'km');
    console.log('  -> ranking esperado: Las Condes, Santiago Centro, Melipilla');

    // ------------------------------------------------------------------
    tit('5. Interseccion final (lo que vera la ejecutiva)');
    for (const [nombre, sid] of [['Santiago Centro', SUC_CENTRO],
                                  ['Las Condes', SUC_LAS_CONDES],
                                  ['Melipilla', SUC_MELIPILLA]]) {
        const disp = await E.obtenerDisponibles(null, sid);
        const filtradas = E.intersecar(kesi, disp);
        console.log(`${nombre.padEnd(18)} habilitadas=${disp ? disp.length : 0}  ` +
            `->selector=${filtradas ? filtradas.length : 'sin restriccion'}`);
    }

    // ------------------------------------------------------------------
    tit('6. Cosentyx: cuantas de las 13 del diccionario estan en la sede');
    const cos = await E.obtenerElegibles(PACIENTE); // sanity: mismo paciente
    const dictCos = await (async () => {
        const r = await (global.Espo.Ajax.getRequest('CDiccionarioPMP/6ab567b03291ea415',
            { select: 'id,name,productsIds' }));
        const ids = r.productsIds || [];
        const prods = await (global.Espo.Ajax.getRequest('Product', {
            maxSize: 500,
            where: [{ type: 'in', attribute: 'id', value: ids }],
            select: 'id,name'
        }));
        return { ids, nombres: prods.list.map(p => p.name) };
    })();
    const dispCentro = await E.obtenerDisponibles(null, SUC_CENTRO);
    const enSede = dictCos.ids.filter(id => (dispCentro || []).includes(id));
    console.log('diccionario Cosentyx:', dictCos.ids.length, 'prestaciones');
    console.log('de ellas, habilitadas en Santiago Centro:', enSede.length);
    console.log('\nLas 13 del diccionario:');
    dictCos.nombres.forEach((n, i) => {
        const idx = dictCos.ids[i];
        console.log(`  ${enSede.includes(idx) ? 'SI ' : 'no '} ${n}`);
    });

    // ------------------------------------------------------------------
    tit('7. Bordes: parseGps y haversine');
    console.log('parseGps("-33.4492, -70.6627") ->', JSON.stringify(E.parseGps('-33.4492, -70.6627')));
    console.log('parseGps("") ->', E.parseGps(''));
    console.log('parseGps(null) ->', E.parseGps(null));
    console.log('parseGps("sin datos") ->', E.parseGps('sin datos'));
    console.log('haversine Santiago->Melipilla =',
        E.haversineKm(-33.4492, -70.6627, -33.6855, -71.2146).toFixed(1), 'km');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

const E = require('./arnes-10416.js');

const PACIENTE_COSENTYX = '6a9712a67cf53059f'; // Cosentyx, comuna PROVIDENCIA
const PACIENTE_10416 = '6ab572f5633f14cc8';     // Kesimpta, SIN comuna

(async () => {
    console.log('='.repeat(70));
    console.log('PRUEBA REAL DE CERCANIA - paciente Cosentyx en PROVIDENCIA');
    console.log('='.repeat(70));

    const elegibles = await E.obtenerElegibles(PACIENTE_COSENTYX);
    console.log('\nElegibles por Cosentyx:', elegibles ? elegibles.length : 'null');

    const orden = await E.ordenarSucursalesPorCercania(PACIENTE_COSENTYX, elegibles);

    if (!orden) {
        console.log('orden -> null');
        return;
    }

    console.log('\nSucursales candidatas, de mas cercana a mas lejana:');
    orden.forEach((o, i) => {
        const km = o.km === null ? '  sin coordenadas' : (o.km.toFixed(1) + ' km').padStart(8);
        const prv = o.sucursal.farmaPrestadorName || '(sin prestador)';
        console.log(`  ${i + 1}. ${o.sucursal.name.padEnd(28)} ${km}  [${o.nivel}]  ${prv}`);
    });

    const g = orden[0];
    console.log('\n-> La que el sistema va a prellenar:');
    console.log(`   Sede      : ${g.sucursal.name}`);
    console.log(`   Prestador : ${g.sucursal.farmaPrestadorName || '(null)'}`);
    console.log(`   Criterio  : ${g.nivel} / ${g.km === null ? 'sin km' : g.km.toFixed(1) + ' km'}`);

    console.log('\n' + '='.repeat(70));
    console.log('PRUEBA DE COHERENCIA CON EL HOOK GeoAsignacionSucursal.php');
    console.log('='.repeat(70));
    console.log('El hook PHP ordena: misma comuna > mismo canton > menor km.');
    console.log('Si la 1a de la lista es [comuna], el hook estaria de acuerdo.');
    console.log('Nivel de la 1a:', g.nivel, g.nivel === 'comuna' ? '-> COINCIDE con el hook' : '-> revisar');

    console.log('\n' + '='.repeat(70));
    console.log('PACIENTE SIN COMUNA (6ab572f5633f14cc8) - no debe romperse');
    console.log('='.repeat(70));
    const e2 = await E.obtenerElegibles(PACIENTE_10416);
    const o2 = await E.ordenarSucursalesPorCercania(PACIENTE_10416, e2);
    console.log('Elegibles:', e2 ? e2.length : 'null');
    console.log('OrdenDevuelto:', o2 ? o2.length + ' sucursales' : 'null');
    if (o2) {
        console.log('Todas sin km (correcto: sin comuna no hay origen):',
            o2.every(o => o.km === null));
        console.log('Orden alfabetico estable:',
            JSON.stringify(o2.map(o => o.sucursal.name)) ===
            JSON.stringify(o2.map(o => o.sucursal.name).slice().sort()));
    }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

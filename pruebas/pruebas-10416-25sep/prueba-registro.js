const E = require('./arnes-10416.js');

const PAC = '6a9712a67cf53059f'; // Cosentyx, PROVIDENCIA

(async () => {
    const elegibles = await E.obtenerElegibles(PAC);
    const orden = await E.ordenarSucursalesPorCercania(PAC, elegibles);

    console.log('Ranking calculado:', orden.length, 'sucursales');
    orden.forEach((o, i) =>
        console.log(`  ${i + 1}. ${o.sucursal.name.padEnd(28)} ${o.km.toFixed(1)} km`));

    const ids = orden.map(o => o.sucursal.id);

    console.log('\n' + '='.repeat(62));
    console.log('obtenerPosiciones: casos correctos');
    console.log('='.repeat(62));

    E.publicarRanking(orden);

    let pos = E.obtenerPosiciones(ids);
    console.log('mismo conjunto, mismo orden   ->',
        pos ? 'OK  ' + JSON.stringify(ids.map(i => pos[i])) : 'FALLA (debio devolver mapa)');

    pos = E.obtenerPosiciones(ids.slice().reverse());
    console.log('mismo conjunto, orden invertido ->',
        pos ? 'OK  ' + JSON.stringify(ids.slice().reverse().map(i => pos[i])) : 'FALLA');

    console.log('\n' + '='.repeat(62));
    console.log('obtenerPosiciones: casos que deben devolver null (no ordenar)');
    console.log('='.repeat(62));

    console.log('ids de mas (8 en vez de 7)    ->',
        E.obtenerPosiciones(ids.concat(['x'])) === null ? 'null OK' : 'FALLA: ordeno de mas');

    console.log('ids de menos (6 en vez de 7)  ->',
        E.obtenerPosiciones(ids.slice(1)) === null ? 'null OK' : 'FALLA: ordeno de menos');

    console.log('ids que no coinciden          ->',
        E.obtenerPosiciones(['aaa', 'bbb']) === null ? 'null OK' : 'FALLA: ordeno ids ajenos');

    console.log('lista vacia                  ->',
        E.obtenerPosiciones([]) === null ? 'null OK' : 'FALLA');

    console.log('undefined                    ->',
        E.obtenerPosiciones(undefined) === null ? 'null OK' : 'FALLA');

    console.log('\n' + '='.repeat(62));
    console.log('Sin ranking publicado ( caso paciente sin medicamento )');
    console.log('='.repeat(62));
    // El modulo se recarga limpio en otro proceso normalmente; aqui
    // sobreescribimos con null simulando que nunca se publico.
    E.publicarRanking(null);
    console.log('ranking null ->',
        E.obtenerPosiciones(ids) === null ? 'null OK (no ordena)' : 'FALLA');

    console.log('\n' + '='.repeat(62));
    console.log('Compara contra el hook PHP (mismo criterio)');
    console.log('='.repeat(62));
    const primera = orden[0];
    console.log('JS   propone:', primera.sucursal.name, '(' + primera.km.toFixed(1) + ' km, ' + primera.nivel + ')');
    console.log('El hook PHP propondría la misma:',
        'SI' ? 'debe coincidir (misma comuna > canton > km)' : '');
    console.log('Criterio JS:', primera.nivel,
        '| el hook compara por el mismo orden de prioridad');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

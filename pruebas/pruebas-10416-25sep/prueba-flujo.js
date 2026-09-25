const E = require('./arnes-10416.js');

const CASOS = [
    { nombre: 'Cosentyx en PROVIDENCIA', id: '6a9712a67cf53059f', med: 'Cosentyx' },
    { nombre: 'Kesimpta SIN comuna', id: '6ab572f5633f14cc8', med: 'Kesimpta' },
    { nombre: 'paciente 10417 (sin comuna, sin equipo)', id: '6ab56b88bfd20dfba', med: '?' },
];

(async () => {
    for (const c of CASOS) {
        console.log('\n' + '#'.repeat(64));
        console.log('# ' + c.nombre);
        console.log('#'.repeat(64));

        // 1. diccionario por medicamento
        const elegibles = await E.obtenerElegibles(c.id);
        console.log('1) Elegibles (diccionario):',
            elegibles ? elegibles.length : 'null -> SIN RESTRICCION');

        // 2. ranking de sucursales
        const orden = await E.ordenarSucursalesPorCercania(c.id, elegibles);
        console.log('2) Sucursales candidatas:', orden ? orden.length : 'null (no prellena)');

        // REGLA DE ORO: usa la misma funcion que la vista del campo
        const elegida = E.elegirSucursalPrellenable(orden);
        console.log('3) Prellena ->',
            elegida
                ? elegida.name + ' | ' + (elegida.farmaPrestadorName || '(sin prestador)') +
                  ' | ' + orden[0].km.toFixed(1) + ' km'
                : 'NO prellena (sin distancia real -> elige la ejecutiva)');

        // 4. lo que vera en el selector de prestaciones
        if (elegida) {
            const sede = elegida;
            const disponibles = await E.obtenerDisponibles(sede.farmaPrestadorId, sede.id);
            const finales = E.intersecar(elegibles, disponibles);
            console.log('4) Selector en esa sede:',
                (finales && finales.length) ? finales.length + ' prestaciones' : 'sin restriccion (fallback)');
            if (finales && finales.length) {
                const r = await (global.Espo.Ajax.getRequest('Product', {
                    maxSize: 100,
                    where: [{ type: 'in', attribute: 'id', value: finales }],
                    select: 'id,name'
                }));
                r.list.map(p => p.name).sort().forEach(n => console.log('     - ' + n));
            }
        } else {
            console.log('4) Selector: sin prellenar -> la ejecutiva elige a mano');
        }
    }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

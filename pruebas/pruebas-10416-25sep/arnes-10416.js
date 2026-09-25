// Arnés para ejecutar el módulo AMD del 10416 contra la API real de m6dev.
const fs = require('fs');
const https = require('https');
const path = require('path');

const BASE = 'https://m6dev.farma-erp.cl/api/v1';

// La credencial NO va escrita aqui. Se lee del entorno, como API_URL/API_AUTH
// en herramientas/. Ej:
//   node --env-file=../../.env prueba-flujo.js
// o a mano:
//   export API_AUTH='usuario:clave'
const CRED = process.env.API_AUTH || '';
if (!CRED) {
    console.error('Falta API_AUTH. Define la credencial de la usuaria de prueba:');
    console.error("  export API_AUTH='" + 'usuario:clave' + "'");
    process.exit(1);
}
if (CRED.indexOf(':') < 1) {
    console.error('API_AUTH debe tener el formato usuario:clave');
    process.exit(1);
}

function serialize(key, value, out) {
    // where: [ {type, attribute, value:[...]} ]  ->  where[0][type]=...
    if (Array.isArray(value)) {
        value.forEach((item, i) => serialize(`${key}[${i}]`, item, out));
        return;
    }
    if (value !== null && typeof value === 'object') {
        Object.entries(value).forEach(([k, v]) => serialize(`${key}[${k}]`, v, out));
        return;
    }
    out.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
}

function apiGet(entity, params = {}) {
    const out = [];
    Object.entries(params).forEach(([k, v]) => serialize(k, v, out));
    const qs = out.join('&');

    const url = qs ? `${BASE}/${entity}?${qs}` : `${BASE}/${entity}`;

    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'GET',
            rejectUnauthorized: false,
            headers: { 'Authorization': 'Basic ' + Buffer.from(CRED).toString('base64') }
        }, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    return reject(new Error(`${res.statusCode} ${entity}: ${body.slice(0, 200)}`));
                }
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error('JSON invalido: ' + body.slice(0, 200)));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// Espo mínimo
global.Espo = { Ajax: { getRequest: (entity, params) => apiGet(entity, params || {}) } };

// define mínimo que captura el módulo
let modulo = null;
global.define = function (id, deps, factory) {
    if (typeof deps === 'function') { factory = deps; }
    modulo = factory();
};

const RUTA = process.env.MODULO_10416;
if (!RUTA) { console.error('falta MODULO_10416'); process.exit(1); }
eval(fs.readFileSync(path.resolve(RUTA), 'utf8'));

module.exports = modulo;

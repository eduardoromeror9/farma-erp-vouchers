# AGENTS.md

Instrucciones para agentes que trabajen en este repositorio. `CLAUDE.md` tiene la
guía completa de arquitectura y política; este archivo es el resumen operativo.

## Qué es (y qué no es) este repo

No es una instalación de EspoCRM. Es una copia de trabajo de lo que ya corre en
`m6dev.farma-erp.cl` (EspoCRM 8.4.2, PHP 8.1.31): el código custom, los datos
cargados y las herramientas. No hay build, no hay `npm install`, no hay
instalación del framework. `application/` (el core) **nunca** se toca: todo va en
`custom/`.

`en-servidor/` reproduce las rutas reales del servidor, relativas a
`/var/www/html/m6dev`. `mejoras-pendientes/` tiene código escrito pero **NO**
desplegado.

## Reglas de acceso

- **Solo David Báez** tiene acceso al servidor: sube archivos.
- Se trabaja contra la API de m6dev con credenciales de variables de entorno
  (`API_URL`, `API_AUTH`, `MODULO_10416`).
- **No conectes a ningún host de Farma eRP.** No leas, pidas ni administres
  `API_AUTH`, `.env` ni `.env.local`. No ejecutes nada bajo `pruebas/` ni
  `herramientas/`: ambos tocan la API viva y está prohibido. Si necesitas
  verificar cobertura de pruebas, revisa el código estáticamente o pide que las
  corra Eduardo y te reporte.
- Nada se borra ni se altera sin autorización explícita. Nada se escribe en el
  servidor sin autorización explícita. Respaldar antes de cambiar.

## Comandos

Suite de pruebas (contra la API viva, ver "Reglas de acceso"):

```bash
cd pruebas
node --env-file=../.env pruebas-10416-25sep/prueba-flujo.js
```

`arnes-10416.js` simula un `Espo.Ajax`/`define` AMD mínimo y hace `eval` del módulo
que indique `MODULO_10416`, para que el módulo real corra sin modificaciones.

Herramientas Python, siempre en dos fases: primero revisan (solo lectura), y solo
después de una revisión limpia se aplican con `--aplicar`:

```bash
export API_URL='https://m6dev.farma-erp.cl/api/v1'
export API_AUTH='USUARIO:CLAVE'
python3 herramientas/cargar-diccionario.py --medicamento "Cosentyx" --prestaciones lista.txt
python3 herramientas/crear-paciente.py --nombre "X" --medicamento "Cosentyx" --comuna "PROVIDENCIA"
# agregar --aplicar solo cuando la revisión esté limpia
```

En un `.env`, el valor de `API_AUTH` va **entre comillas**: la clave tiene un `#` y
sin comillas se trunca (el síntoma es que la API responde vacío y todo sale "SIN
RESTRICCION"). `.env` y `.env.local` están en `.gitignore`; `.env.example` es la
plantilla versionada.

## Arquitectura en una línea

- **10416** (elegibilidad + sede) — núcleo en
  `en-servidor/client/custom/src/utils/elegibilidadFin.js`, módulo AMD memoizado
  que resuelve el medicamento del paciente a prestaciones elegibles. La clave del
  filtro es **solo el medicamento** (desde el 25-sep); el programa/`teams1` ya no
  filtra. `null` significa "sin restricción" (falla abierto), nunca "vacío o
  bloqueado": todo el sistema es sugerencia, jamás filtro duro.
- **10417** (complementarias) — hook `afterRelate` en
  `custom/Espo/Custom/Hooks/SalesOrder/AddPrestacionesDestino.php`. `self::$autoAdding`
  garantiza **un solo salto**: un destino agregado automáticamente no dispara más reglas.
- **10420** (georreferenciación) — `GeoAsignacionSucursal.php`, hook **previo a este
  proyecto**. `AfterSave.php` nunca se analizó y **no** forma parte de este trabajo.

## Trampas de la API de EspoCRM que fallan en silencio

- `total` en listados de `Contact` puede salir **negativo**: no usarlo como booleano.
- Campos inexistentes en el body de un PATCH se **ignoran en silencio** y la API
  responde "OK" (lectura fantasma). Lo mismo con los campos `readOnly`
  (`Contact.codigo`, `Contact.estado`), que los pone el sistema.
- `PATCH /entity/<id>/` (con barra final) da 404; es `PATCH /entity/<id>`.
- Filtro `in`: un parámetro por valor (`where[0][value][]=id1&where[0][value][]=id2`).
- Sin `select`, campos como `productsIds` no vienen en la respuesta.
- Hay un `Team` "AlfaCare" con `id` vacío: filtrarlo o Espo descarta el write sin avisar.

La lista completa está en `CLAUDE.md`.

## Convenciones

- Sin emojis en el proyecto.
- Comentarios breves. Autoría del código: "Autor: Eduardo Romero".
- Para las personas de negocio, escribir "Negocio", no nombres propios.

## Pendiente conocido

Falta `client/custom/src/views/modals/prestaciones-select.js` (del desarrollador
original; está en el servidor pero no hay copia en el repo). Si el servidor se
reinstala, el 10416 no se puede recuperar sin él. Pedirlo a David.

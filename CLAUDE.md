# CLAUDE.md

Este archivo entrega contexto a Claude Code (claude.ai/code) para trabajar en este repositorio.

## Qué es este repositorio

Este repositorio no es una instalación de EspoCRM: es una copia de trabajo del código custom, los datos y las herramientas de tres tickets (10416, 10417, 10420) hechos para la instancia de EspoCRM de Farma eRP en `m6dev.farma-erp.cl` (EspoCRM 8.4.2, PHP 8.1.31). El repo refleja exactamente lo que corre en ese servidor: no hay paso de build, no hay instalación del framework, y `application/` (core de EspoCRM) nunca se toca. Todo vive bajo `custom/`.

El desarrollo es de Eduardo Romero. David Báez es el único con acceso al servidor y sube archivos; nadie más toca el servidor directamente.

## Estructura del repositorio

- `en-servidor/`: el código exactamente como está desplegado, en sus rutas reales del servidor (relativas a `/var/www/html/m6dev`): `client/custom/src/...` (JS, módulos AMD, sin compilación) y `custom/Espo/Custom/Hooks/SalesOrder/...` (hooks PHP).
- `despliegue/`: instrucciones de despliegue (`INSTRUCCIONES.md`), el mensaje para David, md5 de lo desplegado, y `rollback/` con respaldos (`24sep-validado/` es la última versión validada, `pre-10416/` son los originales antes de este proyecto).
- `datos/`: snapshots JSON de lo que está cargado en m6dev (diccionario, reglas, permisos, sedes). La lógica del filtro no sirve de nada sin estos datos, aunque el código esté bien subido.
- `pruebas/`: suite de pruebas que corre el módulo real del lado cliente contra la API viva de m6dev.
- `herramientas/`: scripts en Python que cargan datos de referencia y crean pacientes de prueba por API.
- `mejoras-pendientes/`: una corrección escrita pero **NO desplegada** (modal de sede del 10416), con su propio `LEEME.md` con el diagnóstico y las rutas de destino.
- `requerimientos/`, `reportes/`, `docs/`, `logs/`: carpetas de trabajo actualmente vacías (no son entregables, ver "Reglas" más abajo).

## Arquitectura: los tickets 10416/10417/10420

El ticket **10416 (elegibilidad + sede más cercana)** tiene su núcleo en `en-servidor/client/custom/src/utils/elegibilidadFin.js`, un módulo AMD (`custom:utils/elegibilidadFin`) sin dependencias externas aparte de `Espo.Ajax`. Expone funciones memoizadas en caches a nivel de módulo (`cacheElegibles`, `cacheProveedores`), más deduplicación de requests en curso (`enCurso`):
- `obtenerElegibles(contactId)`: resuelve el medicamento del paciente (`Contact.produtoId`) a ids de prestaciones elegibles vía `CDiccionarioPMP`. La clave es **solo** el medicamento desde el 25-sep; el atributo `teams1`/programa ya no filtra, queda solo como documentación en la entidad mantenedora.
- `obtenerDisponibles` / `obtenerPrestacionesDeSucursal` / `obtenerPrestacionesDePrestador` / `obtenerSucursalesElegibles` / `obtenerPrestadoresElegibles`: cruzan las prestaciones elegibles con lo que efectivamente ofrece una sucursal o prestador dado (`CSucursalPrestacion`, `FarmaHistorialPrecios`).
- `ordenarSucursalesPorCercania` / `elegirSucursalPrellenable`: ordena las sucursales candidatas con el **mismo criterio de desempate que el hook PHP**: misma comuna (tier 0) > mismo cantón (tier 1) > distancia haversine en km (tier 2), dejando al final las candidatas sin GPS. Una sucursal solo se prellena si la ganadora tiene una distancia **real** calculada; esta guarda existe justamente para que un paciente sin comuna/geodatos nunca reciba una sede prellenada de otro país.
- El módulo también mantiene un singleton `ultimoRanking` que las vistas de campo publican con `publicarRanking()` y que el modal de selección de sede lee vía `obtenerPosiciones()`. Así es como el modal ordena su lista sin que la vista del voucher le pase nada directamente.

En toda esta lógica, `null` significa "sin restricción" (falla abierto), nunca "vacío/bloqueado". Todo el sistema está diseñado como **sugerencia, nunca como filtro duro**: cualquier permiso faltante, dato faltante o error de API degrada a "mostrar todo", por diseño explícito.

Consumidores de `elegibilidadFin.js`:
- `views/salesOrder/fields/prestaciones.js`, `farmaSucursales1.js`, `farmaPrestador1.js`: filtros/prellenado a nivel de campo en el formulario de SalesOrder ("Voucher").
- `views/modals/sucursalesSelect.js`: el modal de selección de sede, ordenado por cercanía.

**10417 (prestaciones complementarias)**: `custom/Espo/Custom/Hooks/SalesOrder/AddPrestacionesDestino.php`, un hook `afterRelate` sobre `SalesOrder.prestaciones`. Cuando se relaciona una prestación de origen a un voucher, agrega automáticamente las prestaciones de destino de las reglas activas de `CReglaPrestacionComplementaria` que coincidan con el prestador+sucursal de ese voucher. Se cuida de duplicados y de encadenamientos: `self::$autoAdding` garantiza **un solo salto**, un destino agregado automáticamente nunca dispara más reglas dentro del mismo request.

**10420 (georreferenciación)**: `custom/Espo/Custom/Hooks/SalesOrder/GeoAsignacionSucursal.php`, un hook `beforeSave` que asigna la sucursal elegible más cercana del lado del servidor cuando un voucher tiene paciente + prestaciones pero aún no tiene sucursal. Este hook **es previo a este proyecto** (solo `AfterSave.php` en la misma carpeta no está revisado/se desconoce su propósito, y **no** es parte del trabajo de este proyecto). El prellenado del lado cliente en `farmaSucursales1.js` replica a propósito la misma lógica de tiers/haversine de este hook, para que la pantalla y el guardado nunca queden en desacuerdo.

## Trampas de la API de EspoCRM relevantes para este código

Se descubrieron a la fuerza y este JS/Python las asume como conocidas:
- Los filtros booleanos de `disponibleVoucher` deben mandarse como `1`, no `true` (`true` devuelve 0 resultados en silencio).
- `Contact.total` en las respuestas de listado puede salir **negativo**: nunca tratarlo como booleano, revisar el largo de la lista en su lugar.
- Un `where` con `type: in` necesita un parámetro por valor (`where[0][value][]=id1&where[0][value][]=id2`).
- `select` no está implícito: los campos que no se piden simplemente no vienen en la respuesta (ej. `productsIds`).
- `PATCH /entity/<id>/` (con barra al final) da 404; solo funciona `PATCH /entity/<id>`.
- `Contact.codigo` y `Contact.estado` son generados por el servidor/readOnly; la API acepta y descarta en silencio los valores que se les manden.
- Los campos que no existen en una entidad son ignorados en silencio por PATCH (sin error): un escrito "fantasma" que parece exitoso.
- Hay un `Team` huérfano llamado "AlfaCare" con `id` vacío en m6dev; el código que consume `teams` debe filtrarlo o Espo descarta el write en silencio.

## Correr la suite de pruebas / herramientas: no ejecutar contra el sistema real

`pruebas/` y `herramientas/` están hechos para correr contra la **API viva de m6dev EspoCRM** usando credenciales leídas de `.env` (`API_URL`, `API_AUTH`, `MODULO_10416`) o variables de entorno exportadas, nunca hardcodeadas. Según la política de esta organización, Claude Code no debe conectarse a ningún sistema de Farma eRP (incluyendo cualquier host `*.farma-erp.cl`/`*.farma-erp.com`, EspoCRM, o cualquier host que requiera estas credenciales) y no debe leer, pedir ni manejar `API_AUTH`, `.env` ni ninguna otra credencial de este repositorio. No ejecutar nada bajo `pruebas/` ni `herramientas/`, y no abrir `.env`/`.env.local`. Si hace falta verificar la cobertura de pruebas, revisar el código de las pruebas de forma estática o pedirle a Eduardo que las corra y reporte los resultados; no ejecutarlas aunque se pida explícitamente "solo probar".

El patrón del arnés de pruebas, como referencia (sin invocarlo): `pruebas/pruebas-10416-25sep/arnes-10416.js` simula un `global.Espo.Ajax`/`define` AMD mínimo, y luego hace `eval` del módulo objetivo (ruta desde `MODULO_10416`) para que el módulo AMD real bajo `en-servidor/` o `mejoras-pendientes/` corra sin modificaciones contra la API.

## Reglas (del README, vinculantes para este proyecto)

- Nunca modificar `application/` (core de EspoCRM): todo cambio va en `custom/`.
- Ninguna credencial se escribe jamás en un archivo versionado; solo salen de variables de entorno.
- Solo David Báez sube archivos al servidor; nadie más tiene acceso.
- Nada se borra ni se altera sin autorización explícita.
- Las dudas de negocio van a Negocio; las de despliegue, a David.
- Este repo deliberadamente no guarda informes/bitácoras/notas: solo lo que corre, los datos cargados y las pruebas (según sección 1 del README).

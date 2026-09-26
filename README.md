# Farma eRP: automatización de vouchers en EspoCRM

Contenido **exacto de lo que está corriendo en m6dev** (`https://m6dev.farma-erp.cl/`,
EspoCRM 8.4.2, PHP 8.1.31) y de los datos que hay cargados ahí.

Aquí está únicamente el código que corre, los datos que hay cargados y las pruebas.
Nada de informes, bitácoras ni notas de trabajo.

---

## 1. Qué hace

Cuando se crea o edita un voucher:

| | Qué hace |
|---|---|
| **10416** | Filtra las prestaciones por el **medicamento del paciente** y prellena la **sucursal más cercana** |
| **10417** | Al agregar una prestación de origen, agrega automáticamente las de destino según la regla del prestador |
| **10420** | Al guardar, propone la sede más cercana al domicilio (hook ya existente en el servidor, no es de este trabajo) |

Modo sugerencia: **acorta la lista, nunca bloquea**. Si no hay coincidencia no se
restringe nada.

## 2. Estructura

```
espocrm-dev/
├── en-servidor/        El código que corre, con sus rutas reales del servidor
├── despliegue/          Instrucciones de subida, mensaje a David y rollback
├── datos/              Lo que está cargado en m6dev (diccionario, reglas, permisos, sedes)
├── pruebas/            Suite que corre el módulo real contra la API
├── herramientas/       Scripts para crear pacientes y cargar el diccionario por API
├── mejoras-pendientes/ Mejoras escritas pero NO desplegadas
└── .env.example        Plantilla de credenciales, sin valores reales
```

## 3. `en-servidor/`: el código

Rutas relativas a `/var/www/html/m6dev`.

| Archivo | Autor | Qué hace |
|---|---|---|
| `client/custom/src/utils/elegibilidadFin.js` | **nuestro** | Lógica compartida: elegibilidad, cercanía, cruce con la sede |
| `client/custom/src/views/salesOrder/fields/prestaciones.js` | nuestro | Filtra el selector de prestaciones |
| `client/custom/src/views/salesOrder/fields/farmaSucursales1.js` | nuestro | Filtra el selector de sede y la prellena |
| `client/custom/src/views/salesOrder/fields/farmaPrestador1.js` | nuestro | Filtra el selector de prestador |
| `client/custom/src/views/modals/sucursalesSelect.js` | nuestro | Modal de selección de sede ordenado por cercanía |
| `custom/Espo/Custom/Hooks/SalesOrder/AddPrestacionesDestino.php` | **nuestro** | Hook del 10417 |
| `custom/Espo/Custom/Hooks/SalesOrder/GeoAsignacionSucursal.php` | previo | Hook del 10420, ya estaba en el servidor |
| `custom/Espo/Custom/Hooks/SalesOrder/AfterSave.php` | previo | **Nunca se analizó.** Nadie sabe qué hace |

### md5 de lo desplegado el 25-sep

```
1af5864c1cbb4785f806e193568782ce  client/custom/src/utils/elegibilidadFin.js
4f2c4118350d5bc2f40ca8e74276cccf  client/custom/src/views/modals/sucursalesSelect.js
ad62db6693a366e147bb00e55d643edb  client/custom/src/views/salesOrder/fields/farmaSucursales1.js
5f99605d0fd6ea64eaed4837247dd9de  client/custom/src/views/salesOrder/fields/farmaPrestador1.js
196cddf350858f296b9fd5deda97626e  client/custom/src/views/salesOrder/fields/prestaciones.js
8bc20e1afbfb8e0774cde7155ac3ae93  custom/Espo/Custom/Hooks/SalesOrder/AddPrestacionesDestino.php
```

### Falta un archivo del que dependemos

`client/custom/src/views/modals/prestaciones-select.js`

Lo invoca `prestaciones.js` cuando hay prestador y sede. **Está en el servidor pero es
del desarrollador original del sistema, y no hay copia en este proyecto.** Si el servidor
se reinstala, el 10416 se rompe y no hay con qué recuperarlo. **Hay que pedirle el archivo
a David.**

## 4. `despliegue/`

| Archivo | Qué es |
|---|---|
| `INSTRUCCIONES.md` | Rutas, comandos, md5, permisos, protocolo de prueba y rollback |
| `MENSAJE-PARA-DAVID.txt` | El mensaje listo para copiar y pegar |
| `rollback/24sep-validado/` | La versión del 24-sep, la que se validó en pantalla |
| `rollback/pre-10416/` | Los originales previos al 10416 |

Para volver atrás, lo único que hace falta son los 2 archivos de `rollback/24sep-validado/`.

## 5. `datos/`: lo que está cargado en m6dev

| Archivo | Qué es |
|---|---|
| `diccionario-CDiccionarioPMP.json` | **5 registros, 64 prestaciones.** El mantenedor que lee el filtro |
| `reglas-10417-CReglaPrestacionComplementaria.json` | 4 reglas de prestaciones complementarias |
| `permisos-rol-EJECUTIVA.json` | El rol EJECUTIVA con los permisos que se le dieron |
| `sedes-cobertura-10416.json` | Las 5 sedes de prueba y las 189 combinaciones sede/prestación que se crearon |
| `registros-prueba-eliminados-CDiccionarioPMP.json` | Los 2 registros de prueba que se borraron del diccionario |
| `usuario-prueba-ejecutiva-10416.json` | La ficha de la usuaria de prueba, **sin la clave** |

**Sin el diccionario y las reglas, el código no hace nada aunque esté bien subido.**

## 6. `pruebas/`

Suite que ejecuta el módulo real contra la API de m6dev, con las credenciales de la
usuaria de prueba (rol EJECUTIVA, no admin). Las credenciales **no** están en el
repositorio: se leen del `.env`.

```bash
# una vez, para dejar tu credencial local (el .env no se sube)
cp .env.example .env
# y edita .env poniendo API_AUTH="usuario:clave"

cd pruebas
node --env-file=../.env pruebas-10416-25sep/prueba-flujo.js
```

| Script | Qué prueba |
|---|---|
| `prueba-flujo.js` | El camino completo: elegibles → candidatas → prellenado → selector |
| `prueba-registro.js` | Que el ranking se publique bien y solo ordene cuando corresponde |
| `prueba-cercania.js` | Cobertura por medicamento y bordes del cálculo de distancia |
| `prueba-real.js` | Coherencia con el hook PHP y caso sin comuna |

**Ojo con el `.env`:** el valor de `API_AUTH` va **entre comillas**. La clave de prueba
tiene un `#`, y sin comillas el archivo lo toma como el inicio de un comentario y la
clave llega cortada. El síntoma es que la API responde vacío y todo sale "SIN
RESTRICCION" en vez de dar un error claro.

Si prefieres no usar `.env`, sirve igual:

```bash
export API_AUTH="usuario:clave"
cd pruebas && node pruebas-10416-25sep/prueba-flujo.js
```

Esa usuaria se borra de m6dev al cerrar el proyecto. Ver la sección
"Autoría y credenciales".

## 6-bis. `herramientas/`

`cargar-diccionario.py` carga el diccionario de elegibilidad (medicamento → prestaciones)
por API, en dos pasos: primero **revierve** y después, solo si está limpio, **aplica**.

```bash
export API_URL='https://m6dev.farma-erp.cl/api/v1'
export API_AUTH='USUARIO:CLAVE'

# 1. revisar (solo lee)
python3 herramientas/cargar-diccionario.py \
    --medicamento "Cosentyx" --prestaciones herramientas/EJEMPLO-lista-prestaciones.txt

# 2. aplicar (escribe de verdad)
python3 herramientas/cargar-diccionario.py \
    --medicamento "Cosentyx" --prestaciones lista.txt --aplicar
```

Si el medicamento **ya tiene** un registro en el diccionario, aplicarlo a la fuerza crearía un
segundo registro igual y duplicaría las prestaciones en el filtro. Por eso:

| Bandera | Para qué |
|---|---|
| `--aplicar` | Sin esto no escribe nada |
| `--aceptar-otros-nombres` | Acepta las prestaciones que existen con otra redacción y las reusa |
| `--actualizar` | Reemplaza las prestaciones del registro que ya existe, en vez de crear otro |

| Qué | Cómo lo trata |
|---|---|
| Normaliza acentos y mayúsculas al comparar nombres | "Antígeno" = "ANTIGENO" |
| Errores de tipeo ("Zolgensmaa") | Busca también al revés y sugiere el nombre real |
| Prestación repetida en el `.txt` | La toma una vez y avisa cuántas quitó |
| Prestación que existe con otro nombre | Te la muestra; solo se reutiliza con `--aceptar-otros-nombres` |
| Varias coincidencias parecidas | **Se niega a escribir** hasta que lo resuelvas a mano |
| Varias versiones del mismo medicamento | Te avisa cuál usar |
| Varios programas con nombre parecido | Exige el nombre exacto |
| Medicamento ya cargado en el diccionario | **Se niega a escribir**; usa `--actualizar` |
| `Team` con id vacío (el "AlfaCare" de m6dev) | Lo descarta: escribiría un programa inexistente |

`crear-paciente.py` crea un paciente (Contact) por API, también en dos pasos. Antes de
crear, revisa todo lo que el filtro necesita y **te muestra qué va a pasar**:

```bash
export API_URL='https://m6dev.farma-erp.cl/api/v1'
export API_AUTH='USUARIO:CLAVE'

# 1. revisar (solo lee)
python3 herramientas/crear-paciente.py \
    --nombre "Paciente Prueba API" \
    --medicamento "Cosentyx" --comuna "PROVIDENCIA"

# 2. crear
python3 herramientas/crear-paciente.py ... --aplicar
```

Ojo: `--codigo` y `--estado` existen pero **no sirven para nada**. `codigo` y `estado`
son readOnly en `Contact`: los pone el sistema. El script lo avisa y te muestra el valor
real al final.

| Revisa | Por qué importa |
|---|---|
| Que no exista ya un paciente con ese nombre | Evita duplicados |
| Que el medicamento **esté en el diccionario** | Si no, el paciente se crea pero el filtro no le encuentra nada |
| Que las coordenadas de la comuna existan | Sin ellas no se propone la sede más cercana |
| Que el equipo exista con el nombre exacto | Hay "EXT Siempre Contigo" que se confunde con "Siempre Contigo" |
| Que el paciente quede con **equipo** (`teams`) | Sin equipo ninguna ejecutiva lo ve |

Y de paso calcula la sede que se propondría y cuántas prestaciones se verían.

**Ojo con tres cosas de la API de EspoCRM** (las que se encontraron durante el desarrollo, por si
las usas desde otro lado):

| Trampa | Qué hacer |
|---|---|
| `total` en `Contact` sale **negativo** | No lo uses como booleano, mira el largo de la lista |
| Filtro `in` | Un parámetro por valor: `where[0][value][]=id1&where[0][value][]=id2` |
| `select` omitido | La respuesta trae solo campos por defecto; si necesitas `productsIds`, pídelo explícitamente |
| `codigo` de Contact es **readOnly** | Lo mandes o no, el sistema lo genera solo. `PRB-0001` termina siendo `COS-PP1` |
| `PATCH /entity/<id>/` | La barra al final da **404**. La ruta es `PATCH /entity/<id>` |
| Campos obligatorios de Contact | `assignedUser`, `estado`, `firstName`, `sexo` y `teams`. La UI los completa sola, la API no |
| `estado` de Contact es **readOnly** | El sistema lo pone ("Con Intención"). No se puede elegir por API |
| `defaultTeam` **no existe** en Contact | Es de `User`, no del paciente. El paciente solo tiene `teams` |
| Campos inexistentes en el body | EspoCRM los **ignora en silencio** y responde "OK". Es un PATCH fantasma |
| Hay un `Team` con `id` vacío en m6dev | Se llama "AlfaCare". Filtrarlo antes de usarlo, si no se escribe `teams1:[""]` y Espo lo descarta sin avisar |

Los dos scripts necesitan un usuario con permiso de **creación** en `Contact`, `Product` y
`CDiccionarioPMP`. Con el rol EJECUTIVA responden 403.

## 7. `mejoras-pendientes/`: mejora futura, NO desplegada

### El problema: el modal de sede muestra las 713 sucursales

Al abrir el desplegable de **Sucursal** se listan las 713 sucursales del sistema, sin
ordenar, en vez de las ~9 candidatas del paciente ordenadas por cercanía.

**Lo que pidió la reunión funciona igual:** el filtro por medicamento y la propuesta de la
sede más cercana están desplegados y validados. Esto es un extra que se agregó después y
quedó con un defecto. No rompe nada: la ejecutiva puede elegir cualquiera y el filtro de
prestaciones sigue funcionando.

### Los 3 archivos de la corrección

En `mejoras-pendientes/10416-modal-sede/`, ya en sus rutas reales del servidor:

| Archivo | Qué cambia |
|---|---|
| `client/custom/src/views/modals/sucursalesSelect.js` | **El principal.** El modal acota su propia lista a las candidatas y las ordena, en vez de depender de que el campo le pase el filtro |
| `client/custom/src/utils/elegibilidadFin.js` | Agrega el getter `obtenerCandidatasPublicadas()` que entrega esas candidatas |
| `client/custom/src/views/salesOrder/fields/farmaSucursales1.js` | El filtro ya no exige prestador seleccionado, y la vista se refresca cuando el prestador cambia |

**Los tres van juntos.** Con solo el modal no funciona: necesita el getter del módulo.

### Causa

El campo de sede le pasa al modal el objeto `filters` que devuelve su `getSelectFilters()`,
y ese método exigía que hubiera prestador seleccionado. Sin prestador el filtro quedaba
vacío, y el modal no tenía ninguna lista por la que acotar ni ordenar.

### Estado

- Corrección **escrita y verificada a nivel de código** (sintaxis y suite de pruebas OK)
- **NO desplegada.** No se ha subido al servidor ni probado en pantalla
- Riesgo bajo: no toca la lógica de elegibilidad ni el prellenado, solo acota y ordena la
  lista del modal
- El `LEEME.md` de esa carpeta tiene el diagnóstico completo y los comandos por si se decide
  aplicar

### Cómo aplicarla, si se decide

Son 3 archivos en sus mismas rutas. Nada más cambia: los otros 2 del paquete
(`farmaPrestador1.js` y `prestaciones.js`) no se tocan. Rollback: copiar los 3 respaldos y
`php clear_cache.php`.

## 8. Estado

| Ticket | Progreso | Estado |
|---|---|---|
| **10420** georreferenciación | **100%** | MVP certificado en módev. Lo opcional del top-3 quedó fuera de alcance por decisión explícita. |
| **10417** prestaciones complementarias | **100%** | Hook v2 desplegado, **certificado 7/7 casos**. |
| **10416** elegibilidad | **100%** | **Desplegado y validado en pantalla** (25-sep). |
| **Global del proyecto** | **~97%** | Los 3 tickets están entregados y validados. Lo que falta es un detalle menor, no desarrollo. |

### Lo único que falta

| Detalle | Estado | Quién |
|---|---|---|
| Corrección del modal de sede (hoy lista las 713 sucursales) | **Ya escrita y verificada** en `mejoras-pendientes/`. Es una mejora extra, no un requisito: el filtro por medicamento y la sede propuesta funcionan igual. | Eduardo decide si la sube |
| Copia de `prestaciones-select.js` en el proyecto | Falta pedirla. Un archivo, ya está en el servidor | Eduardo → David |
| Bajar el log y borrar los datos de prueba | Al cerrar el proyecto | Eduardo |

### Pendientes de Negocio (no son alcance de los tickets)

| Qué | Por qué importa |
|---|---|
| 4 dudas de negocio abiertas | Definen el comportamiento esperado |
| Coordenadas de 31 comunas mal en `FarmaComunas` | Afecta al 10420 en producción |
| 9 comunas duplicadas en `FarmaComunas` | Datos sucios |
| `Kesimpta PAP-AF` no está en el diccionario | Quedó fuera del filtro |
| `Team` "AlfaCare" con `id` vacío | Registro huérfano en m6dev |

## 9. Autoría y credenciales

### Autoría

- **Desarrollo — Eduardo Romero.** El código de `en-servidor/`, el hook del 10417, las
  herramientas, la suite de pruebas y este repositorio.
- **Despliegue — David Báez.** Es el único con acceso al servidor: sube los archivos y
  corre `php clear_cache.php`. Nada llega a m6dev sin él.
- **Datos y definiciones — Negocio.** El diccionario, las reglas y las sedes.

### Credenciales

**En este repositorio no hay ninguna clave.** Ni la de la usuaria de prueba, ni la de
administrador, ni ninguna de producción.

Las credenciales se leen siempre de variables de entorno:

| Variable | Para qué |
|---|---|
| `API_URL` | Dirección de la API de m6dev |
| `API_AUTH` | Credencial, formato `USUARIO:CLAVE` |
| `MODULO_10416` | Ruta al módulo que se quiere probar |

| Archivo | Qué es |
|---|---|
| `.env.example` | Plantilla **sin valores reales**. Se versiona. Copiala a `.env` |
| `.env` | Tu credencial local. **En `.gitignore`, nunca se sube** |

Hay una usuaria de prueba en m6dev, `ejecutiva_prueba_10416`, con rol EJECUTIVA y
equipo Siempre Contigo. Existe para probar el filtro con los mismos permisos que tiene
una ejecutiva real, sin depender de permisos de administrador. **Se borra al cerrar el
proyecto.**

Fecha de borrado: ________________

**Por eso el repositorio es privado.** Contiene datos internos: el diccionario de
elegibilidad, las 5 sedes de prueba, las 189 combinaciones y las rutas del servidor.

## 10. Reglas

- **No se toca `application/`** (core de EspoCRM). Todo va en `custom/`.
- **Ninguna credencial se escribe en un archivo versionado.** Van por variable de
  entorno.
- **David Báez es el único con acceso al servidor**: sube archivos y corre
  `php clear_cache.php`. El resto trabaja contra la API.
- Nada se borra ni altera sin autorización explícita.
- **Las dudas de negocio van a Negocio**; las de despliegue, a **David**.

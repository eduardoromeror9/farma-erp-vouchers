# 10416 - Filtro de elegibilidad (prestaciones + proveedores) + sede más cercana

Que hace: cuando se crea/edita un voucher, las prestaciones que se ofrecen y los
prestadores/sucursales que se pueden elegir se filtran segun el **medicamento del
paciente** (dato que ya esta en la ficha del paciente), y **prellena la sucursal más
cercana** al domicilio.

Modo: **sugerencia**. Si la combinacion no tiene coincidencia, NO se restringe
nada: la ejecutiva ve todo lo de siempre. Nunca bloquea.

---

## Que cambio el 25-09-2026 (respecto de la version del 24-sep)

1. **La clave del diccionario pasa a ser solo el medicamento.** Antes exigia
   Programa + Medicamento; ahora basta con que el paciente tenga un producto
   asignado. El campo `teams1` de `CDiccionarioPMP` ya no filtra (queda como
   documentacion del mantenedor).
2. **Se prellena la sucursal más cercana.** Al elegir el paciente, el sistema
   calcula cual de las sedes que sirven las prestaciones de su medicamento esta
   mas cerca y la escribe en el voucher, junto con su prestador.
   - El criterio es **identico** al del hook `GeoAsignacionSucursal.php`
     (misma comuna > mismo canton > menor distancia en km), para que la pantalla
     y el hook al guardar propongan siempre la misma sede.
   - **No pisa la eleccion de la ejecutiva**: si ya hay una sede puesta, no se toca.
   - **Solo prellena si hay distancia real calculada.** Si el paciente no tiene
     comuna (o su comuna no esta georreferenciada) no se propone nada y la
     ejecutiva elige a mano. Sin esta guarda se llegaria a prellenar una sede
     en Ecuador para un paciente chileno.
3. **El modal de seleccion de sede se ordena por cercania.** Antes salia en
   orden alfabetico. Ahora muestra todas las candidatas en una sola pagina,
   ordenadas de mas cercana a mas lejana.
4. **No se muestra "(3.2 km)" en el nombre de la sede**, a proposito: ese texto
   es el que se guarda en el voucher al seleccionar, y se contaminaria la base.
5. **Dos archivos cambiaron de nombre** (el 25-sep): `elegibilidad-10416.js` ahora
   es `elegibilidadFin.js` y `sucursales-select.js` ahora es `sucursalesSelect.js`.
   En el servidor hay que **subir los nuevos y borrar los viejos**, o quedan dos
   copias del mismo modulo.
6. **El filtro ya no espera a que se elija la sede.** Antes, sin prestador/sucursal
   el selector mostraba el catalogo completo (246). Ahora, en cuanto el paciente
   tiene un medicamento, el selector muestra directamente las prestaciones del
   diccionario (13 en el caso de Cosentyx); recien al elegir la sede se cruza con
   lo que esa sede ofrece (7 en el caso de Santiago Centro).
   - El selector ademas se refresca al cambiar el paciente, no solo al cambiar la sede.

No se toco `application/` (core). No se toco ningun dato de la base. Todo es
JavaScript en `client/custom/`, sin compilacion.

---

## Archivos a subir (5)

Rutas relativas a la raiz de EspoCRM (`/var/www/html/m6dev`):

| Archivo | Que es | Nombre anterior en el servidor |
|---|---|---|
| `client/custom/src/utils/elegibilidadFin.js` | reemplaza al actual - logica compartida | `elegibilidad-10416.js` |
| `client/custom/src/views/modals/sucursalesSelect.js` | **NUEVO** - modal ordenado por cercania | `sucursales-select.js` |
| `client/custom/src/views/salesOrder/fields/farmaSucursales1.js` | reemplaza al actual - prellena la sede | (mismo nombre) |
| `client/custom/src/views/salesOrder/fields/farmaPrestador1.js` | reemplaza al actual - filtro de prestador | (mismo nombre) |
| `client/custom/src/views/salesOrder/fields/prestaciones.js` | reemplaza al actual - filtro de prestaciones | (mismo nombre) |

`md5` esperados:

```
1af5864c1cbb4785f806e193568782ce  utils/elegibilidadFin.js
4f2c4118350d5bc2f40ca8e74276cccf  views/modals/sucursalesSelect.js
ad62db6693a366e147bb00e55d643edb  views/salesOrder/fields/farmaSucursales1.js
5f99605d0fd6ea64eaed4837247dd9de  views/salesOrder/fields/farmaPrestador1.js
196cddf350858f296b9fd5deda97626e  views/salesOrder/fields/prestaciones.js
```

Los `md5` de los 5 cambiaron respecto del 24-sep (los 3 que solo tenían
actualizado el comentario de cabecera tambien). Si al descargarlos del servidor
dan distinto, es que se alteraron por el camino.

## Como subirlo

**No hay que compilar nada.** Verificado en el codigo de EspoCRM 8.4.2 del
servidor: el cargador de modulos resuelve `custom:x` a `client/custom/src/x.js`
y lo baja en cada peticion. Con subir el archivo basta.

Pasos:

```bash
cd /var/www/html/m6dev
# respaldar los archivos que se reemplazan (por si hay que volver atras)
mkdir -p /tmp/backup-10416-25sep
cp client/custom/src/utils/elegibilidad-10416.js                              /tmp/backup-10416-25sep/
cp client/custom/src/views/salesOrder/fields/farmaSucursales1.js              /tmp/backup-10416-25sep/

# subir los 5 archivos en sus rutas (crear el directorio modals/ si no existe)
mkdir -p client/custom/src/views/modals

# BORRAR los 2 archivos con el nombre anterior (renombrados)
rm -f client/custom/src/utils/elegibilidad-10416.js
rm -f client/custom/src/views/modals/sucursales-select.js

# limpiar cache (esto SI es necesario: el navegador cachea los JS)
php clear_cache.php
```

Opcional: `php rebuild.php` no hace falta para cambios solo de JS, pero no
molesta si se quiere.

**Importante para el navegador:** despues de subir, hay que hacer una recarga
forzada (Ctrl+Shift+R) o abrir en ventana privada, porque el cache del
navegador puede tener los JS viejos.

## Rollback

```bash
cd /var/www/html/m6dev
cp /tmp/backup-10416-25sep/elegibilidad-10416.js   client/custom/src/utils/elegibilidadFin.js
cp /tmp/backup-10416-25sep/farmaSucursales1.js     client/custom/src/views/salesOrder/fields/
rm -f client/custom/src/views/modals/sucursalesSelect.js
php clear_cache.php
```

Los archivos exactos de la version del 24-sep (los validados en pantalla) estan
en este mismo proyecto, en `despliegue/rollback/24sep-validado/`:
- `rollback/24sep-validado/elegibilidad-10416.js.10416-24sep` (md5 `3372014ddc85fa3569252535f105c17d`)
- `rollback/24sep-validado/farmaSucursales1.js.10416-24sep` (md5 `892a6dff6f63b0d0fddc9463a2f91a14`)

Esos dos conservan el nombre viejo a proposito: son la version del 24-sep.

Y los originales previos al 10416 en `despliegue/rollback/pre-10416/*.ori`.

## Permisos (importante)

El filtro necesita que el usuario pueda **leer** estas 5 entidades:

- `CDiccionarioPMP` (prestaciones elegibles del paciente)
- `CSucursalPrestacion` (que esta habilitado en la sede)
- `FarmaSucursales` (sucursales elegibles, y sus coordenadas GPS)
- `FarmaHistorialPrecios` (fuente complementaria)
- `FarmaComunas` (**NUEVO en esta version**: coordenadas de la comuna del paciente)

Las 4 primeras ya se le dieron el 24-sep. **`FarmaComunas` hay que verificarla**: el
calculo de distancia lee `FarmaComunas.latitud/longitud` de la comuna del
paciente. En el respaldo del rol EJECUTIVA del 24-sep esta entidad ya figuraba
con `read=all`, pero conviene confirmarlo en pantalla: si faltara, el filtro
sigue funcionando (prestaciones y sede elegibles) y lo unico que no funciona es
el **orden por cercania**, porque el prellenado se desactiva (no se propone
nada) en vez de fallar.

Si falta cualquiera de las entidades, el modulo esta disenado para **no
restringir nada** (deja pasar todo y no rompe la pantalla). Por eso el filtro
puede "no verse" sin dar error: hay que revisar los permisos antes de concluir
que el codigo no funciona.

## Como probarlo

### A. Filtro por medicamento (lo principal)

Paciente de prueba con Cosentyx: id `6a9712a67cf53059f`, comuna **PROVIDENCIA**.
Trae las 2 variantes de Cosentyx en el diccionario, con 13 prestaciones.

1. Crear voucher General, elegir ese paciente.
2. **La sede y el prestador se llenan solos**: deberia quedar
   `Sede Prueba Santiago Centro` (a 5,3 km) y `PRESTADOR PRUEBA SANTIAGO`.
3. Abrir el selector de prestaciones: deben aparecer **7 prestaciones**:
   Anticore Total, Antigeno de Superficie (HBsAG), Hemograma, Quantiferon,
   RESONANCIA MAGNETICA SACROILIACAS, Radiografia simple de Torax Ap y L, VIH 1+2.

   **Ojo: son 7, no las 13 del diccionario.** Las 6 restantes (Radiografia de
   manos, RX pelvis, Vacuna Antineumococica, Vacuna contra la influenza,
   Vacuna Hepatitis B, VHC) son legitimas del diccionario pero **esa sede no las
   tiene habilitadas**, y el filtro las cruza con lo que la sede ofrece. Eso fue
   una decision explicita: es inofilitar un examen que ese centro no hace.

### B. Paciente sin comuna (debe ser inocuo)

Paciente `6ab572f5633f14cc8` (Kesimpta, **sin comuna**). Al elegirlo **no se debe
prellenar ninguna sede** y el selector debe mostrar todas las de la sede. Sirve
para confirmar que la guarda de distancia protege contra proposedores
absurdos.

### C. Paciente sin medicamento (fallback)

Cualquier paciente sin producto asignado: **no se restringe nada**, se ven todas
las prestaciones de la sede. Nunca bloquea.

### C-bis. Sin sede elegida (lo nuevo del 25-sep)

1. Crear voucher y elegir el paciente de Cosentyx, **sin tocar la sede**.
2. Abrir el selector de prestaciones: deben aparecer las **13 del diccionario**
   (no las 246 del catalogo).
3. Recien al elegir la sede pasa a **7**.

### D. Orden por cercania

1. Con el paciente de Cosentyx, hacer clic en el campo Sucursal.
2. El modal debe abrirse con las 7 candidatas **todas en una sola pagina**,
   ordenadas asi:

   | # | Sede | Distancia |
   |---|---|---|
   | 1 | Sede Prueba Santiago Centro | 5,3 km |
   | 2 | Sede Prueba Las Condes | 6,1 km |
   | 3 | Sede Prueba Melipilla | 62,8 km |
   | 4 | Medilcorp sede unica | 3503,9 km |
   | 5 | Irhed sede Principal | 3616,8 km |
   | 6 | Enloza unica sede | 3743,6 km |
   | 7 | Axxis sede Principal | 3788,7 km |

3. Las 4 ultimas quedan al final porque estan en Ecuador/Peru. **No se muestra
   el km** en el texto de cada fila (ver nota arriba).

### E. No pisa la eleccion de la ejecutiva

1. Con el paciente de Cosentyx, **cambiar la sede a mano** antes de que se
   prellene, o cambiar la sede despues.
2. El sistema **no debe volver a cambiar sola** lo que la ejecutiva eligio.

### F. Regresion del 24-sep (el resultado NO debe cambiar)

Con el paciente `6ab572f5633f14cc8` (Kesimpta), prestador
`PRESTADOR PRUEBA SANTIAGO` y sede `Sede Prueba Santiago Centro` elegidas a mano,
el selector debe seguir mostrando las **11 prestaciones** de siempre:
Anticore Total, Antigeno de Superficie (HBsAG), Creatinina, Hemograma,
Inmunoglobulina G, Inmunoglobulina M, Prueba de embarazo, Quantiferon,
RM Columna Dorsal, RM de Cerebro Con Contraste, VIH 1+2.

**Nota sobre el numero 11**: antes eran 13. Los 2 registros de prueba que se
habian cargado en `CDiccionarioPMP` se eliminaron el 24-sep-2026 (estan marcados
como borrados, no se pueden ver). Aportaban 2 prestaciones que no estaban en el
registro real de Kesimpta.

## Dato importante para la demo

Si el paciente de prueba **no tiene comuna**, no se prellena nada y la pantalla
se ve igual que antes (todo el catalogo). Para que se vea el cambio hay que
usar un paciente **con comuna cargada**, como el de Cosentyx en Providencia.

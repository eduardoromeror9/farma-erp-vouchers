# Mejora pendiente — 10416: el modal de sede muestra las 713 sucursales

> **Estado: NO desplegado.** Estos archivos están preparados pero **no están en el
> servidor** y no forman parte de lo que se subió el 25-sep. La versión que está
> en producción es la de `en-servidor/`, que se validó y funciona para lo que
> pidió la reunión.
>
> Decidir si se aplican es cosa de Eduardo. No hay fecha comprometida.

---

## 1. Qué funciona hoy (lo que pidió la reunión)

| Requisito de la reunión | Estado |
|---|---|
| Mostrar solo las prestaciones del diccionario del paciente | **Funciona** — 13 en Cosentyx, 21 en Kesimpta |
| Proponer la sucursal más cercana | **Funciona** — se autocompleta al elegir el paciente |

Validado en pantalla por Eduardo el 25-sep y por David.

## 2. Qué NO funciona

**Al abrir el desplegable de Sucursal se listan las 713 sucursales del sistema,
desordenadas, en vez de las 9 candidatas ordenadas por cercanía.**

No rompe nada: la ejecutiva puede elegir cualquiera y el filtro de prestaciones
sigue funcionando. Pero si alguien abre ese desplegable en una reunión, se ve mal.

## 3. Por qué pasa

Se confirmó leyendo el código de EspoCRM 8.4 del servidor (`client/lib/espo-main.js`):

1. El campo de sede le pasa al modal un objeto `filters`
2. Ese objeto sale de `getSelectFilters()` del campo
3. Nuestro `getSelectFilters()` decía: *"si no hay prestador seleccionado,
   devuelve el filtro base"*
4. Y el filtro base **solo existe si hay prestador**

Sin prestador → filtro vacío → el modal lista las 713. Y sin filtro tampoco hay
lista de ids por la que ordenar.

El modal en sí leía bien los ids (`options.filters` sí llega, está confirmado en el
código de Espo): simplemente no había nada que leer.

## 4. Qué cambia esta versión

Tres cambios, en tres archivos:

| # | Archivo | Cambio |
|---|---|---|
| 1 | `utils/elegibilidadFin.js` | Nuevo getter `obtenerCandidatasPublicadas()`: devuelve los ids de las sedes candidatas del último ranking calculado. |
| 2 | `views/modals/sucursalesSelect.js` | El modal **acota su propia colección** a esas candidatas y las ordena. Ya no depende de que el campo le pase bien el filtro. |
| 3 | `views/salesOrder/fields/farmaSucursales1.js` | `getSelectFilters()` ya no exige prestador (si no hay, filtra solo por el diccionario) y la vista se refresca cuando el prestador cambia. |

**El punto 2 es el que resuelve lo reportado**: el modal se auto-limita con los datos
que ya estaban publicados, así que muestra 9 filas ordenadas aunque el campo no le
pase filtro.

Si no hay ranking publicado (paciente sin medicamento, sin comuna, sin coincidencias),
el modal se comporta exactamente como el de Espo: no acota y no ordena.

## 5. Cómo aplicarla, si se decide

Solo 3 archivos, en sus mismas rutas. Los otros 2 del paquete
(`farmaPrestador1.js` y `prestaciones.js`) no cambian.

```bash
cd /var/www/html/m6dev

# respaldar
mkdir -p /tmp/backup-10416-mejora
cp client/custom/src/utils/elegibilidadFin.js                 /tmp/backup-10416-mejora/
cp client/custom/src/views/modals/sucursalesSelect.js         /tmp/backup-10416-mejora/
cp client/custom/src/views/salesOrder/fields/farmaSucursales1.js /tmp/backup-10416-mejora/

# subir los 3 de esta carpeta a sus rutas y limpiar cache
php clear_cache.php
```

Rollback: volver a copiar los 3 desde `/tmp/backup-10416-mejora/` y `clear_cache`.

## 6. Verificación

Sintaxis correcta en los 3. La suite de pruebas corre igual contra esta versión
(`pruebas/pruebas-10416-25sep/`, apuntando `MODULO_10416` a este archivo): los
4 scripts pasan con los mismos resultados que la versión desplegada.

**Pendiente de probar en pantalla**: que el modal muestre las 9 ordenadas. Eso no se
puede verificar sin navegador.

## 7. Riesgo

Bajo. No cambia la lógica de elegibilidad ni de prellenado: solo acotar y ordenar la
lista del modal, y refrescar el filtro cuando cambia el prestador. La vuelta atrás es
copiar 3 respaldos.

A favor: es la única parte del 10416 que quedó con un defecto conocido, y se
detectó recién probando en pantalla.

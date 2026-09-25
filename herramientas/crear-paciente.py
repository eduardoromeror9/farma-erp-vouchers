#!/usr/bin/env python3
"""
Crear un paciente (Contact) por API, en dos pasos.

Un paciente recien creado no sirve de nada si no tiene:
  - el medicamento correcto (Contact.produtoId -> FarmaProduto), porque de ahi
    sale el filtro de elegibilidad del ticket 10416
  - su comuna (Contact.comunaId -> FarmaComunas), porque sin coordenadas el
    sistema no puede proponer la sede mas cercana
  - el equipo (teamsIds), porque un paciente sin equipo no lo ve ninguna
    ejecutiva. OJO: el "equipo por defecto" (defaultTeam) no es del paciente,
    es del USUARIO

Por eso el script revisa TODO eso antes de crear, y de paso te muestra que
va a pasar con el filtro: cuantas prestaciones le corresponden y que sede
propondria.

Uso:

  # 1) REVISAR (solo lee, no escribe nada)
  python3 crear-paciente.py --nombre "Paciente Prueba" --codigo PRB-0001 \
      --medicamento "Cosentyx" --comuna "PROVIDENCIA"

  # 2) APLICAR (escribe de verdad)
  python3 crear-paciente.py ... --aplicar

Necesita un usuario con permiso de creacion en Contact. Con el rol EJECUTIVA
responde 403.
"""

import argparse
import base64
import json
import math
import os
import ssl
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get('API_URL', 'https://m6dev.farma-erp.cl/api/v1')
AUTH = os.environ.get('API_AUTH', '')
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

SEXOS = ['Femenino', 'Masculino', 'Ninguno']
RADIO_TIERRA_KM = 6371.0


# --------------------------------------------------------------- utilidades

def norm(texto):
    if texto is None:
        return ''
    plano = unicodedata.normalize('NFD', str(texto))
    plano = plano.encode('ascii', 'ignore').decode()
    return ' '.join(plano.lower().split())


def pedir(metodo, ruta, cuerpo=None):
    url = API + '/' + ruta.lstrip('/')
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo)
    if datos is not None:
        req.add_header('Content-Type', 'application/json')
    if AUTH:
        req.add_header('Authorization',
                       'Basic ' + base64.b64encode(AUTH.encode()).decode())
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=90) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detalle = e.read().decode()[:600]
        raise SystemExit('ERROR %s %s -> HTTP %s\n%s'
                         % (metodo, ruta, e.code, detalle))
    except urllib.error.URLError as e:
        raise SystemExit('No se pudo conectar: %s\n'
                         'Revisa API_URL y API_AUTH.\n' % e)


def listar(entidad, select='id,name'):
    """Pagina de a 200. No usa 'total' para parar: en Contact sale negativo."""
    salida = []
    offset = 0
    while True:
        pagina = pedir('GET', '%s?maxSize=200&offset=%d&select=%s'
                       % (entidad, offset, select))
        filas = pagina.get('list') or []
        salida.extend(filas)
        if len(filas) < 200 or offset > 20000:
            break
        offset += 200
    return salida


def por_nombre_exacto(lista, nombre):
    return next((x for x in lista if norm(x['name']) == norm(nombre)), None)


def por_nombre_parecido(lista, nombre):
    n = norm(nombre)
    return [x for x in lista
            if n in norm(x['name']) or norm(x['name']) in n]


def haversine(lat1, lon1, lat2, lon2):
    f1, f2 = math.radians(lat1), math.radians(lat2)
    df = f2 - f1
    dl = math.radians(lon2 - lon1)
    a = math.sin(df / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dl / 2) ** 2
    return 2 * RADIO_TIERRA_KM * math.asin(math.sqrt(a))


def parse_gps(texto):
    if not isinstance(texto, str) or not texto:
        return None
    import re
    m = re.match(r'(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)', texto)
    return (float(m.group(1)), float(m.group(2))) if m else None


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(
        description='Crea un paciente por API. Sin --aplicar solo revisa.')
    ap.add_argument('--nombre', required=True,
                    help='Nombre y apellido, ej. "Paciente Prueba API"')
    ap.add_argument('--codigo', default='',
                    help='Opcional y casi inutil: el campo codigo de Contact es '
                         'readOnly, EspoCRM lo genera solo e ignora lo que se '
                         'mande. El script muestra el real al final.')
    ap.add_argument('--medicamento', required=True,
                    help='Medicamento asignado (FarmaProduto). Debe existir en '
                         'el diccionario CDiccionarioPMP')
    ap.add_argument('--comuna', required=True,
                    help='Comuna del paciente (FarmaComunas). Sin coordenadas '
                         'no se propone sede')
    ap.add_argument('--equipo', default='Siempre Contigo')
    ap.add_argument('--sexo', default='Ninguno', choices=SEXOS)
    ap.add_argument('--email', default='')
    ap.add_argument('--estado', default='',
                    help='Opcional. Nombre exacto de FarmaEstados')
    ap.add_argument('--asignado-a', default='',
                    help='Nombre del usuario al que se asigna el paciente. '
                         'Por defecto, el de la credencial (API_AUTH)')
    ap.add_argument('--sin-equipo', action='store_true',
                    help='Crear el paciente SIN equipo. Solo para pruebas: una '
                         'ejecutiva no vera un paciente sin equipo')
    ap.add_argument('--aplicar', action='store_true',
                    help='Escribe de verdad. Sin el flag, solo revisa.')
    args = ap.parse_args()

    modo = 'APLICAR' if args.aplicar else 'REVISAR (no escribe nada)'
    print('=' * 70)
    print(' CREAR PACIENTE  |  modo: %s' % modo)
    print('=' * 70)

    # ---- 1. no duplicar por nombre
    # OJO: el campo 'codigo' de Contact es readOnly. EspoCRM ignora el valor
    # que mandes y lo genera solo (por eso un codigo como "PRB-0001" termina
    # siendo "COS-PP1"). El codigo no sirve para evitar duplicados; lo que
    # sirve es el nombre.
    print('\n[1] Verificando que no exista ya un paciente con ese nombre ...')
    usados = pedir('GET', 'Contact?maxSize=10&where[0][type]=contains'
                          '&where[0][attribute]=name&where[0][value]='
                          + urllib.parse.quote(args.nombre))
    # OJO: el campo 'total' de Contact sale negativo (-1, -2). En Python un
    # -1 es "verdadero", asi que usarlo como booleano daria falso positivo
    # siempre. Hay que mirar la lista.
    encontrados = usados.get('list') or []
    if encontrados:
        print('    HAY %d paciente(s) con un nombre parecido:' % len(encontrados))
        for c in encontrados[:5]:
            print('      %s  %-32s  codigo=%s'
                  % (c.get('id'), c.get('name'), c.get('codigo')))
        print('    Si es el mismo, no lo crees de nuevo.')
        return 1
    print('    ninguno')
    if args.codigo:
        print('    AVISO: --codigo "%s" se va a IGNORAR.' % args.codigo)
        print('    El campo codigo es readOnly: el sistema lo genera solo.')
        print('    El codigo real se muestra al final, cuando se crea.')

    # ---- 2. medicamento
    print('\n[2] Buscando el medicamento "%s" ...' % args.medicamento)
    productos = listar('FarmaProduto')
    med = por_nombre_exacto(productos, args.medicamento)
    if med is None:
        print('    NO EXISTE con ese nombre exacto. Parecidos:')
        for p in por_nombre_parecido(productos, args.medicamento)[:10]:
            print('      %s  %s' % (p['id'], p['name']))
        return 1
    print('    id: %s   nombre: %s' % (med['id'], med['name']))

    variantes = [p for p in por_nombre_parecido(productos, args.medicamento)
                 if p['id'] != med['id']]
    if variantes:
        print('    AVISO: hay otras variantes del mismo farmaco. El filtro solo '
              'reconoce el que esta en el diccionario:')
        for p in variantes[:8]:
            print('      %s  %s' % (p['id'], p['name']))

    # ---- 3. esta en el diccionario?
    print('\n[3] Verificando que el medicamento este en el diccionario ...')
    # OJO: se codifica SOLO el valor. Si se codifica la query completa, los
    # & y los [] se escapan y la API no entiende nada (y devuelve 0).
    registros = pedir(
        'GET', 'CDiccionarioPMP?maxSize=20&select=id,name,productsIds'
               '&where[0][type]=linkedWith'
               '&where[0][attribute]=farmaProdutos'
               '&where[0][value]=' + urllib.parse.quote(med['id'])
    ).get('list') or []
    # El select no es opcional: sin el, la respuesta trae solo los campos por
    # defecto (id, name, createdAt...) y productsIds viene vacio, que hace
    # que el script crea que el medicamento no esta en el diccionario.
    elegibles = []
    for r in registros:
        for pid in (r.get('productsIds') or []):
            if pid not in elegibles:
                elegibles.append(pid)
    if not elegibles:
        print('    ESTE MEDICAMENTO NO ESTA EN EL DICCIONARIO.')
        print('    El paciente se crearia pero el filtro no le encontraria nada:')
        print('    veria todas las prestaciones de la sede.')
        print('    Opciones: usar otro medicamento, o cargar el diccionario')
        print('    con herramientas/cargar-diccionario.py')
        if not args.aplicar:
            return 1
        print('    (se continua porque pediste --aplicar)')
    else:
        print('    OK: %d registro(s), %s prestaciones elegibles'
              % (len(registros), len(elegibles)))

    # ---- 4. comuna
    print('\n[4] Buscando la comuna "%s" ...' % args.comuna)
    comunas = listar('FarmaComunas', 'id,name,latitud,longitud')
    com = por_nombre_exacto(comunas, args.comuna)
    if com is None:
        print('    NO EXISTE. Parecidos:')
        for c in por_nombre_parecido(comunas, args.comuna)[:10]:
            print('      %s  %s' % (c['id'], c['name']))
        return 1
    print('    id: %s   %s  (%s, %s)'
          % (com['id'], com['name'], com.get('latitud'), com.get('longitud')))
    if com.get('latitud') is None:
        print('    AVISO: la comuna no tiene coordenadas. El sistema NO podra '
              'proponer la sede mas cercana.')

    # ---- 5. equipo
    print('\n[5] Buscando el equipo "%s" ...' % args.equipo)
    equipos = listar('Team')
    eq = por_nombre_exacto(equipos, args.equipo)
    if eq is None:
        parecidos = por_nombre_parecido(equipos, args.equipo)
        print('    No hay exacto. Parecidos:')
        for t in parecidos[:10]:
            print('      %s  %s' % (t['id'], t['name']))
        return 1
    print('    id: %s   %s' % (eq['id'], eq['name']))

    # ---- 5-bis. usuario autenticado
    # Contact exige 'assignedUser' (obligatorio). La UI lo completa sola, pero
    # por API hay que mandarlo o el POST falla con HTTP 400.
    # Se resuelve desde el usuario de la credencial, para no inventarlo.
    print('\n[6] Resolviendo el usuario de la credencial ...')
    usuario = AUTH.split(':')[0] if ':' in AUTH else ''
    asignado_id = None
    asignado_nombre = ''
    if usuario:
        r = pedir('GET', 'User?maxSize=5&where[0][type]=equals'
                         '&where[0][attribute]=userName&where[0][value]='
                         + urllib.parse.quote(usuario))
        lista = r.get('list') or []
        if lista:
            asignado_id = lista[0]['id']
            asignado_nombre = lista[0].get('name') or usuario
    if not asignado_id:
        print('    No se pudo resolver. Usa --asignado-a "nombre" o')
        print('    revisa que API_AUTH tenga el formato usuario:clave.')
        return 1
    print('    %s  (%s)' % (asignado_nombre, asignado_id))

    # ---- 6. estado
    estado_id = None
    if args.estado:
        print('\n[6] Buscando el estado "%s" ...' % args.estado)
        estados = listar('FarmaEstados')
        est = por_nombre_exacto(estados, args.estado)
        if est is None:
            print('    NO EXISTE con ese nombre exacto. Parecidos:')
            for e in por_nombre_parecido(estados, args.estado)[:8]:
                print('      %s  %s' % (e['id'], e['name']))
            return 1
        estado_id = est['id']
        print('    id: %s   %s' % (est['id'], est['name']))

    # ---- 7. vista previa del filtro
    print('\n[7] Que va a ver el filtro con este paciente ...')
    if elegibles and com.get('latitud') is not None:
        print('    Calculando la sede mas cercana entre las que sirven '
              'esas prestaciones ...')
        candidatos = sede_mas_cercana(elegibles, com)
        if candidatos:
            print('    %d sedes sirven al menos una prestacion. Las 3 mas '
                  'cercanas:' % len(candidatos))
            for c in candidatos[:3]:
                print('      %-34s %8.1f km' % (c['nombre'], c['km']))
            ganadora = candidatos[0]
            comunes = [p for p in ganadora['productos'] if p in elegibles]
            print('    -> se propondría: %s  (%.1f km)' % (ganadora['nombre'],
                                                          ganadora['km']))
            print('    -> el selector mostraria %d de %d prestaciones'
                  % (len(comunes), len(elegibles)))
        else:
            print('    Ninguna sede tiene habilitadas esas prestaciones.')
    elif elegibles:
        print('    Sin coordenadas de comuna no se puede calcular la sede.')
        print('    El filtro mostrara las %d prestaciones del diccionario.' % len(elegibles))
    else:
        print('    El medicamento no esta en el diccionario: sin filtro.')

    # ---- 8. resumen y decision
    print('\n' + '=' * 70)
    print(' RESUMEN')
    print('=' * 70)
    print('  nombre     : %s' % args.nombre)
    print('  codigo     : %s' % (args.codigo or '(lo genera el sistema)'))
    print('  medicamento: %s  (%s)' % (med['name'], med['id']))
    print('  comuna      : %s  (%s)' % (com['name'], com['id']))
    print('  equipo     : %s  (%s)' % (eq['name'], eq['id']))
    print('  sexo       : %s' % args.sexo)
    print('  estado     : %s   (lo asigna el sistema, no se elige)'
          % (estado_id or 'automatico'))
    print('  asignado a : %s  (%s)' % (asignado_nombre, asignado_id))
    print('  equipo     : %s' % ('SI' if not args.sin_equipo else 'NO (la ejecutiva no lo vera)'))

    if not args.aplicar:
        print('\n  Modo revision: no se escribio nada.')
        print('  Cuando este conforme, agrega --aplicar.')
        return 0

    # 'estado' figura como obligatorio en los metadatos, pero es readOnly: el
    # sistema se lo pone solo ("Con Inttencion" en la practica). Por eso no
    # hace falta mandarlo ni es error no hacerlo. Si se paso --estado, solo se
    # muestra a titulo informativo.
    if not estado_id and args.estado:
        print('\n  No se encontro el estado "%s". Se seguira igual:' % args.estado)
        print('  el estado lo asigna el sistema, no se puede elegir por API.')
        print('  Opciones disponibles:')
        for e in listar('FarmaEstados')[:10]:
            print('    %s  %s' % (e['id'], e['name']))

    # ---- 9. crear
    print('\n[8] Creando el paciente ...')
    partes = args.nombre.strip().split()
    cuerpo = {
        'firstName': partes[0],
        'lastName': ' '.join(partes[1:]) if len(partes) > 1 else partes[0],
        'sexo': args.sexo,
        'codigo': args.codigo,
        'produtoId': med['id'],
        'comunaId': com['id'],
        'teamsIds': [eq['id']],
        'assignedUserId': asignado_id,
    }
    if args.sin_equipo:
        cuerpo.pop('teamsIds')
    if args.email:
        cuerpo['emailAddress'] = args.email
    # 'estado' de Contact es readOnly: el sistema lo asigna solo. Mandarlo no
    # hace nada, asi que no se manda. --estado queda como forma de consultar
    # un estado, no de asignarlo.

    nuevo = pedir('POST', 'Contact', cuerpo)
    real = pedir('GET', 'Contact/%s?select=id,name,codigo' % nuevo['id'])
    print('    creado: %s  %s' % (nuevo['id'], real.get('name')))
    if args.codigo and real.get('codigo') != args.codigo:
        print('    codigo REAL (lo genero el sistema): %s'
              % (real.get('codigo') or '(vacio)'))
        print('    el que pediste, "%s", se ignoro: el campo es readOnly'
              % args.codigo)

    # NO se asigna "equipo por defecto" al paciente: ese campo no existe en
    # Contact. defaultTeam pertenece al USUARIO y define a que equipo ve por
    # defecto. EspoCRM ignora en silencio los campos que no existen, asi que
    # mandarlo aqui no hacia nada y el script recien loODY.InvalidOperation al
    # verificar.
    # Si una ejecutiva no ve este paciente, el problema es el defaultTeam de
    # ESA usuaria, no del paciente.

    # ---- 10. verificar
    print('\n[9] Verificando ...')
    chequeo = pedir('GET', 'Contact/%s?select=id,codigo,firstName,lastName,'
                          'produtoName,comunaName,teamsNames,'
                          'estadoName,sexo,emailAddress' % nuevo['id'])
    print('    codigo      : %s   <-- este es el real, usalo para buscarlo'
          % (chequeo.get('codigo') or '(vacio)'))
    print('    nombre      : %s %s' % (chequeo.get('firstName'),
                                       chequeo.get('lastName')))
    print('    medicamento : %s' % chequeo.get('produtoName'))
    print('    comuna       : %s' % chequeo.get('comunaName'))
    print('    equipo      : %s' % (chequeo.get('teamsNames') or {}).values())
    print('    estado      : %s' % (chequeo.get('estadoName') or '(ninguno)'))

    problemas = []
    if not chequeo.get('produtoName'):
        problemas.append('no quedo el medicamento')
    if not chequeo.get('comunaName'):
        problemas.append('no quedo la comuna')
    if not (chequeo.get('teamsNames') or {}):
        problemas.append('no quedo el equipo')

    if problemas:
        print('\n    REVISAR: %s' % '; '.join(problemas))
        return 1
    print('\n    OK. Para probar el filtro con el:')
    print('      cd pruebas/pruebas-10416-25sep')
    print('      MODULO_10416=../../en-servidor/client/custom/src/utils/'
          'elegibilidadFin.js node -e "')
    print('        const E=require(\'./arnes-10416.js\');')
    print('        (async()=>{const el=await E.obtenerElegibles(process.argv[1]);')
    print('        console.log(\'Elegibles:\', el?el.length:null);})();')
    print('      " %s' % nuevo['id'])
    return 0


def sede_mas_cercana(elegibles, comuna):
    """Sedes que sirven al menos una de las prestaciones, ordenadas por km."""
    if not elegibles:
        return []
    # Para filtros 'in', Espo espera un parametro por valor: value[]=a&value[]=b
    hab = pedir(
        'GET', 'CSucursalPrestacion?maxSize=500'
               '&where[0][type]=in&where[0][attribute]=productId'
               + ''.join('&where[0][value][]=' + i for i in elegibles)
               + '&where[1][type]=equals&where[1][attribute]=estado'
               '&where[1][value]=Activa'
               '&where[2][type]=equals&where[2][attribute]=disponibleVoucher'
               '&where[2][value]=1'
    ).get('list') or []

    por_sede = {}
    for h in hab:
        por_sede.setdefault(h.get('farmaSucursalesId'), []).append(h.get('productId'))
    if not por_sede:
        return []

    ids = [k for k in por_sede if k]
    if not ids:
        return []
    sedes = pedir(
        'GET', 'FarmaSucursales?maxSize=500&select=id,name,ubicaciongps'
               '&where[0][type]=in&where[0][attribute]=id'
               + ''.join('&where[0][value][]=' + i for i in ids)
    ).get('list') or []

    origen = (comuna.get('latitud'), comuna.get('longitud'))
    salida = []
    for s in sedes:
        gps = parse_gps(s.get('ubicaciongps'))
        km = None
        if gps and origen[0] is not None and origen[1] is not None:
            km = haversine(origen[0], origen[1], gps[0], gps[1])
        salida.append({'nombre': s['name'], 'km': km if km is not None else 1e9,
                       'productos': por_sede.get(s['id'], [])})
    salida.sort(key=lambda x: x['km'])
    return salida


if __name__ == '__main__':
    sys.exit(main())

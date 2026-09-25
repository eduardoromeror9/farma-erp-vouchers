#!/usr/bin/env python3
"""
Cargar el diccionario de elegibilidad (CDiccionarioPMP) por API.

El diccionario es la llave del filtro del ticket 10416: une un medicamento
(FarmaProduto) con las prestaciones que ese medicamento autoriza (Product).

Uso en dos pasos, siempre en este orden:

  1) REVISAR  (solo lee, no escribe nada)
     python3 cargar-diccionario.py --medicamento "Cosentyx" --prestaciones lista.txt

  2) APLICAR  (solo si la revisión salió limpia)
     python3 cargar-diccionario.py --medicamento "Cosentyx" \
         --prestaciones lista.txt --aplicar

El script se niega a escribir si hay coincidencias ambiguas, para no meter la
prestacion equivocada en el diccionario sin que nadie lo note. Tampoco escribe
si el medicamento ya tiene un registro en el diccionario, salvo que se pida
--actualizar a proposito.

Necesita un usuario con permiso de creacion en Product y en CDiccionarioPMP.
Con el rol EJECUTIVA responde 403.
"""

import argparse
import base64
import json
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


# --------------------------------------------------------------- utilidades

def norm(texto):
    """Normaliza para comparar: sin acentos, minusculas, espacios colapsados."""
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
        detalle = e.read().decode()[:500]
        raise SystemExit('ERROR %s %s -> HTTP %s\n%s'
                         % (metodo, ruta, e.code, detalle))
    except urllib.error.URLError as e:
        raise SystemExit('No se pudo conectar: %s\n'
                         'Revisa API_URL y API_AUTH.\n' % e)


def listar(entidad, select='id,name'):
    """Trae todos los registros paginando de a 200.

    No se usa el campo 'total' para decidir cuando parar: en Contact sale
    negativo. Se pagina hasta que una pagina venga incompleta.
    """
    salida = []
    offset = 0
    while True:
        pagina = pedir('GET', '%s?maxSize=200&offset=%d&select=%s'
                       % (entidad, offset, select))
        filas = pagina.get('list') or []
        # En m6dev hay al menos un Team con el id vacio. Si se cuela, un POST
        # con teams1:[""] lo ignora Espo en silencio y el registro queda sin
        # programa, sin avisar. mejor ignorarlo aqui.
        filas = [f for f in filas if f.get('id')]
        salida.extend(filas)
        if len(pagina.get('list') or []) < 200 or offset > 20000:
            break
        offset += 200
    return salida


# ----------------------------------------------------------------- matching

def clasificar(catalogo, indice, nombre):
    """Compara el nombre pedido contra el catalogo.

    Devuelve (estado, candidatos) con estado:
      'ok'       -> coincidencia exacta (tras normalizar)
      'ambigua'  -> mas de un parecido: hay que decidir a mano
      'distinto' -> hay parecidos pero con otro nombre: hay que revisar
      'falta'    -> no hay nada parecido
    """
    exacto = indice.get(norm(nombre))
    if exacto:
        return 'ok', [exacto]

    palabras = [p for p in norm(nombre).split() if len(p) > 4]
    if not palabras:
        return 'falta', []
    clave = palabras[0]
    parecidos = [p for p in catalogo if clave in norm(p['name'])]

    if len(parecidos) > 1:
        return 'ambigua', parecidos

    if len(parecidos) == 1:
        return 'distinto', parecidos

    # Al reves: una palabra larga del catalogo metida dentro de lo pedido.
    # Asi "Zolgensmaa" si encuentra "Zolgensma", que con la busqueda de
    # arriba se escapaba. Solo cuando no hubo nada hacia adelante.
    pedido = norm(nombre)
    al_reves = [p for p in catalogo
                for palabra in norm(p['name']).split()
                if len(palabra) > 6 and palabra in pedido]
    if al_reves:
        return ('ambigua' if len(al_reves) > 1 else 'distinto'), al_reves

    return 'falta', []


def elegir_equipo(equipos, pedido):
    """Elige el equipo (programa) pedido. Devuelve (equipo, aviso).

    Exacto primero, porque "Siempre Contigo" esta contenido en
    "EXT Siempre Contigo" y buscar por "contiene" a secas elige el
    equipo equivocado. Si no hay exacto y hay varios parecidos, no elige
    ninguno: que lo decida una persona.
    """
    eq = next((t for t in equipos if norm(t['name']) == norm(pedido)), None)
    if eq is not None:
        return eq, None

    parecidos = [t for t in equipos if norm(pedido) in norm(t['name'])]

    if len(parecidos) == 1:
        return parecidos[0], ('    AVISO: no hay coincidencia exacta de "%s".\n'
                              '            Se usara el unico parecido: %s'
                              % (pedido, parecidos[0]['name']))

    if len(parecidos) > 1:
        print('    Hay %d equipos que contienen "%s". No se elige ninguno solo:'
              % (len(parecidos), pedido))
        for t in parecidos[:10]:
            print('      %s  %s' % (t['id'], t['name']))
        raise SystemExit('    Especifica con --equipo "nombre exacto".')

    print('    No se encontro ningun equipo que contenga "%s".' % pedido)
    idx = {}
    for t in equipos:
        idx.setdefault(norm(t['name']), t)
    _, parecidos = clasificar(equipos, idx, pedido)
    if not parecidos:
        # sin coincidencias: mostrar los que empiezan con la misma palabra
        palabras = [p for p in norm(pedido).split() if len(p) > 3]
        if palabras:
            parecidos = [t for t in equipos
                         if palabras[0] in norm(t['name'])][:10]
    if parecidos:
        print('    Lo mas parecido a lo que escribiste:')
    else:
        print('    Equipos que existen (muestra parcial):')
    for t in parecidos[:10]:
        print('      %s  %s' % (t['id'], t['name']))
    raise SystemExit('    Vuelve a intentarlo con --equipo "nombre exacto".')


def registro_existente(med_id, eq_id):
    """Devuelve el registro del diccionario para ese medicamento y equipo, o None.

    Sin esto, correr dos veces el mismo --aplicar crea dos registros
    iguales y las prestaciones quedan duplicadas en el filtro.
    """
    for r in listar('CDiccionarioPMP', 'id,name,farmaProdutosIds,teams1Ids'):
        if med_id in (r.get('farmaProdutosIds') or []):
            if eq_id in (r.get('teams1Ids') or []):
                return r
    return None


# -------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(
        description='Carga el diccionario CDiccionarioPMP (solo lectura por defecto).')
    ap.add_argument('--medicamento', required=True,
                    help='Nombre del medicamento, ej. "Cosentyx"')
    ap.add_argument('--prestaciones', required=True,
                    help='Archivo .txt o .md con una prestacion por linea. '
                         'Se ignoran lineas vacias y las que empiezan con #')
    ap.add_argument('--equipo', default='Siempre Contigo',
                    help='Nombre del programa (default: Siempre Contigo)')
    ap.add_argument('--aplicar', action='store_true',
                    help='Escribe de verdad. Sin este flag solo revisa.')
    ap.add_argument('--aceptar-otros-nombres', action='store_true',
                    help='Con --aplicar: acepta las prestaciones que existen '
                         'con otra redaccion y las reusa. Sin este flag el '
                         'script se niega a aplicar si hay alguna.')
    ap.add_argument('--actualizar', action='store_true',
                    help='Con --aplicar: en vez de crear un registro nuevo, '
                         'reemplaza las prestaciones del que ya existe para '
                         'ese medicamento y ese programa.')
    args = ap.parse_args()

    modo = 'APLICAR' if args.aplicar else 'REVISAR (no escribe nada)'
    print('=' * 70)
    print(' CARGAR DICCIONARIO  |  modo: %s' % modo)
    print('=' * 70)

    # ---- 1. el medicamento
    print('\n[1] Buscando el medicamento "%s" ...' % args.medicamento)
    productos = listar('FarmaProduto')
    idx_prod = {}
    for p in productos:
        idx_prod.setdefault(norm(p['name']), p)

    med = idx_prod.get(norm(args.medicamento))
    if med is None:
        estado, parecidos = clasificar(productos, idx_prod, args.medicamento)
        print('    NO EXACTO (%s). Parecidos:' % estado)
        for p in parecidos[:10]:
            print('      %s  %s' % (p['id'], p['name']))
        if not parecidos:
            print('    No hay ningun medicamento parecido en FarmaProduto.')
            print('    Este script NO crea medicamentos: si el producto de verdad')
            print('    no existe, primero hay que crearlo en el CRM.')
        raise SystemExit('\n    Revisa el nombre. No se seguiria sin confirmar.')

    otros_parecidos = [p for p in productos
                       if norm(p['name']) != norm(args.medicamento)
                       and norm(args.medicamento) in norm(p['name'])]
    print('    id: %s   nombre: %s' % (med['id'], med['name']))
    if otros_parecidos:
        print('    AVISO: hay otros productos parecidos. '
              'Solo este tiene el medicamento en el diccionario:')
        for p in otros_parecidos:
            print('      %s  %s' % (p['id'], p['name']))

    # ---- 2. el programa
    print('\n[2] Buscando el programa "%s" ...' % args.equipo)
    eq, aviso = elegir_equipo(listar('Team'), args.equipo)
    if aviso:
        print(aviso)
    print('    id: %s   nombre: %s' % (eq['id'], eq['name']))

    # ---- 2b. ¿este medicamento ya esta en el diccionario?
    ya_existe = registro_existente(med['id'], eq['id'])

    # ---- 3. las prestaciones
    print('\n[3] Revisando las prestaciones contra el catalogo ...')
    try:
        with open(args.prestaciones, encoding='utf-8') as f:
            lineas = f.read().split('\n')
    except OSError as e:
        raise SystemExit('    No se pudo leer %s: %s' % (args.prestaciones, e))

    crudas = [l.strip() for l in lineas
              if l.strip() and not l.strip().startswith('#')]

    # Deduplicar conservando el orden. Sin esto, una prestacion repetida dos
    # veces en el .txt creaba dos Products iguales en el catalogo.
    pedidas = []
    repetidas = []
    for nombre in crudas:
        if nombre in pedidas:
            repetidas.append(nombre)
        else:
            pedidas.append(nombre)
    if repetidas:
        print('    AVISO: %d linea(s) repetidas en el archivo, se toman una '
              'sola vez:' % len(repetidas))
        for nombre in repetidas:
            print('      %s' % nombre)

    catalogo = listar('Product')
    idx_cat = {}
    for p in catalogo:
        idx_cat.setdefault(norm(p['name']), p)
    print('    catalogo: %d prestaciones | pedidas: %d'
          % (len(catalogo), len(pedidas)))

    plan = []
    for nombre in pedidas:
        estado, cands = clasificar(catalogo, idx_cat, nombre)
        plan.append({'nombre': nombre, 'estado': estado, 'candidatos': cands})

    print()
    print('    %-50s %s' % ('PRESTACION PEDIDA', 'ESTADO'))
    print('    ' + '-' * 72)
    for p in plan:
        marca = {'ok': 'OK', 'ambigua': 'AMBIGUA', 'distinto': 'OTRO NOMBRE',
                 'falta': 'SE CREA'}[p['estado']]
        nombre = p['nombre']
        if len(nombre) > 49:
            nombre = nombre[:48] + '..'
        print('    %-50s %s' % (nombre, marca))
        for c in p['candidatos'][:6]:
            print('        %s  %s' % (c['id'], c['name']))

    n_ok = sum(1 for p in plan if p['estado'] == 'ok')
    n_crear = sum(1 for p in plan if p['estado'] == 'falta')
    n_dif = sum(1 for p in plan if p['estado'] == 'distinto')
    n_amb = sum(1 for p in plan if p['estado'] == 'ambigua')

    print('\n    Resumen: %d exactas | %d a crear | %d con otro nombre | %d ambiguas'
          % (n_ok, n_crear, n_dif, n_amb))

    # ---- 4. decidir
    if not args.aplicar:
        print('\n[4] Modo revision: no se escribio nada.')
        if n_amb:
            print('    Las AMBIGUAS hay que resolverlas a mano antes de aplicar.')
        if n_dif:
            print('    Las de "OTRO NOMBRE" ya existen pero con otra '
                  'redaccion: revisa si son la misma.')
        if ya_existe:
            print('    OJO: este medicamento YA tiene un registro en el '
                  'diccionario (%s).' % ya_existe['id'])
            print('          Con --aplicar crearia un segundo registro igual. '
                  'Usa --actualizar.')
        return 0

    if n_amb:
        print('\n[4] HAY AMBIGUAS. No se aplica nada.')
        print('    Corrige la lista de prestaciones o resuelve a mano, '
              'y vuelve a intentar.')
        return 1

    if n_dif and not args.aceptar_otros_nombres:
        print('\n[4] HAY %d PRESTACIONES CON OTRO NOMBRE. No se aplica nada.'
              % n_dif)
        print('    Ya existen en el catalogo pero con otra redaccion. El '
              'script no')
        print('    adivina si son la misma. Revisa la revision y, si son las '
              'correctas,')
        print('    repite con --aceptar-otros-nombres.')
        return 1

    if ya_existe and not args.actualizar:
        print('\n[4] ESTE MEDICAMENTO YA ESTA EN EL DICCIONARIO. No se aplica nada.')
        print('    registro existente: %s  %s' % (ya_existe['id'], ya_existe['name']))
        print('    Con --aplicar se crearia un segundo registro igual y las '
              'prestaciones')
        print('    quedarian duplicadas en el filtro de elegibilidad.')
        print('    Para reemplazar el contenido del existente, usa --actualizar.')
        return 1

    if ya_existe and args.actualizar:
        print('\n[4] Se va a REEMPLAZAR el registro existente:')
        print('    %s  %s' % (ya_existe['id'], ya_existe['name']))
        print('    Las prestaciones que no esten en el archivo nuevo se pierden.')
    else:
        print('\n[4] Aplicando ...')

    # ---- 5. crear las que faltan
    creados = 0
    for p in plan:
        if p['estado'] in ('ok', 'distinto'):
            p['id'] = p['candidatos'][0]['id']
            if p['estado'] == 'distinto':
                print('    se reutiliza: %s' % p['candidatos'][0]['name'])
        else:
            nuevo = pedir('POST', 'Product', {'name': p['nombre']})
            p['id'] = nuevo['id']
            creados += 1
            print('    creada: %s  %s' % (nuevo['id'], nuevo['name']))

    # ---- 6. el registro del diccionario
    nombre_reg = '%s - %s' % (eq['name'], med['name'])
    cuerpo = {
        'name': nombre_reg,
        'farmaProdutos': [med['id']],
        'teams1': [eq['id']],
        'products': [p['id'] for p in plan],
    }
    if ya_existe and args.actualizar:
        reg = pedir('PATCH', 'CDiccionarioPMP/%s' % ya_existe['id'], cuerpo)
        print('\n    diccionario actualizado: %s  %s' % (reg['id'], reg['name']))
    else:
        reg = pedir('POST', 'CDiccionarioPMP', cuerpo)
        print('\n    diccionario creado: %s  %s' % (reg['id'], reg['name']))

    # ---- 7. verificar
    print('\n[5] Verificando ...')
    chequeo = pedir('GET', 'CDiccionarioPMP/%s' % reg['id'])
    real = len(chequeo.get('productsIds') or [])
    print('    medicamento : %s' % (list((chequeo.get('farmaProdutosNames') or {}).values())))
    print('    programa    : %s' % (list((chequeo.get('teams1Names') or {}).values())))
    print('    prestaciones: %d' % real)
    print('    creadas     : %d' % creados)

    esperado = len(pedidas)
    if real != esperado:
        print('\n    ATENCION: se esperaban %d y hay %d.' % (esperado, real))
        return 1
    print('\n    OK: el diccionario tiene las %d prestaciones.' % real)
    return 0


if __name__ == '__main__':
    sys.exit(main())

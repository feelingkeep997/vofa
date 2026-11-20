# -*- coding: utf-8 -*-
"""把 TypeDef 的字段解出真实类型（Field signature + TypeRef 映射），得到控件清单"""
import struct, json, sys

meta = json.load(open('meta/_streams.json', encoding='utf-8'))
tables = json.load(open('meta/tables.json', encoding='utf-8'))
path = sys.argv[1]
data = open(path, 'rb').read()

blob_base = meta['#Blob']['off']

def blob_at(idx):
    b = data[blob_base:blob_base + meta['#Blob']['size']]
    p = idx
    v = 0
    s = 0
    while True:
        x = b[p]; p += 1
        v |= (x & 0x7F) << s
        s += 7
        if not x & 0x80:
            break
    return b[p:p + v]

typerefs = tables.get('TypeRef', [])
typedefs = tables.get('TypeDef', [])

ELEM = {
    0x01: 'void', 0x02: 'bool', 0x03: 'char', 0x04: 'sbyte', 0x05: 'byte',
    0x06: 'short', 0x07: 'ushort', 0x08: 'int', 0x09: 'uint', 0x0A: 'long',
    0x0B: 'ulong', 0x0C: 'float', 0x0D: 'double', 0x0E: 'string',
    0x18: 'IntPtr', 0x19: 'UIntPtr', 0x1C: 'object',
}

def compressed(b, p):
    x = b[p]
    if x & 0x80 == 0:
        return x, p + 1
    if x & 0xC0 == 0x80:
        return ((x & 0x3F) << 8) | b[p + 1], p + 2
    return ((x & 0x1F) << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3], p + 4

def tdor_name(coded):
    tag = coded & 3
    row = (coded >> 2) - 1
    if tag == 0 and 0 <= row < len(typedefs):
        td = typedefs[row]
        return (td['Namespace'] + '.' + td['Name']) if td['Namespace'] else td['Name']
    if tag == 1 and 0 <= row < len(typerefs):
        tr = typerefs[row]
        return (tr['Namespace'] + '.' + tr['Name']) if tr['Namespace'] else tr['Name']
    if tag == 2:
        return '<TypeSpec>'
    return f'<coded {coded}>'

def parse_type(b, p):
    e = b[p]; p += 1
    if e in ELEM:
        return ELEM[e], p
    if e == 0x0F:  # PTR
        t, p = parse_type(b, p)
        return t + '*', p
    if e == 0x10:  # BYREF
        t, p = parse_type(b, p)
        return 'ref ' + t, p
    if e in (0x11, 0x12):  # VALUETYPE / CLASS
        c, p = compressed(b, p)
        return tdor_name(c), p
    if e == 0x1D:  # SZARRAY
        t, p = parse_type(b, p)
        return t + '[]', p
    if e == 0x14:  # ARRAY
        t, p = parse_type(b, p)
        _, p = compressed(b, p)
        _, p = compressed(b, p)
        n, p = compressed(b, p)
        for _ in range(n):
            _, p = compressed(b, p)
        return t + '[]', p
    if e == 0x15:  # GENERICINST
        c, p = compressed(b, p)
        base = tdor_name(c)
        n, p = compressed(b, p)
        args = []
        for _ in range(n):
            t, p = parse_type(b, p)
            args.append(t)
        return f"{base.split('.')[-1]}<{','.join(args)}>", p
    if e == 0x13:  # VAR
        _, p = compressed(b, p)
        return '!T', p
    if e == 0x1E:  # MVAR
        _, p = compressed(b, p)
        return '!!T', p
    return f'<elem 0x{e:02X}>', p

def field_type(fld):
    blob = blob_at(fld['Signature'])
    if not blob:
        return '?'
    p = 1  # 跳过 FIELD (0x06)
    try:
        t, _ = parse_type(blob, p)
        return t
    except Exception as ex:
        return f'<err {ex}>'

out = {}
flds = tables['Field']
for ti, td in enumerate(typedefs):
    full = (td['Namespace'] + '.' + td['Name']) if td['Namespace'] else td['Name']
    if not td['_fields']:
        continue
    # 用 TypeDef.FieldList 精确圈定字段表行区间（1-based）
    start = td['FieldList']
    end = typedefs[ti + 1]['FieldList'] if ti + 1 < len(typedefs) else len(flds) + 1
    rows = [flds[k - 1] for k in range(start, min(end, len(flds) + 1))]
    for f in rows:
        out.setdefault(full, []).append({'name': f['Name'], 'type': field_type(f)})

json.dump(out, open('meta/fields_typed.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('types with fields:', len(out))

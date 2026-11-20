# -*- coding: utf-8 -*-
"""解析 #~ 元数据表，导出 TypeDef / MethodDef / Field / Property 名字清单"""
import struct, sys, json, os

path = sys.argv[1]
meta = json.load(open(sys.argv[2], encoding='utf-8'))  # _streams.json
data = open(path, 'rb').read()

# PE 定位
pe = struct.unpack_from('<I', data, 0x3C)[0]
coff = pe + 4
nsec = struct.unpack_from('<H', data, coff + 2)[0]
optsz = struct.unpack_from('<H', data, coff + 16)[0]
opt = coff + 20
magic = struct.unpack_from('<H', data, opt)[0]
dd = opt + (112 if magic == 0x20B else 96)
cli_rva = struct.unpack_from('<I', data, dd + 14 * 8)[0]
sec = opt + optsz
sections = []
for i in range(nsec):
    o = sec + i * 40
    vs, va, rs, rp = struct.unpack_from('<IIII', data, o + 8)
    sections.append((va, vs, rp, rs))

def r2o(rva):
    for va, vs, rp, rs in sections:
        if va <= rva < va + max(vs, rs):
            return rp + rva - va
    return None

tbl_off = meta['#~']['off']
tbl_size = meta['#~']['size']
t = data[tbl_off:tbl_off + tbl_size]

p = 0
reserved = struct.unpack_from('<I', t, p)[0]; p += 4
major, minor = t[p], t[p + 1]; p += 2
heap_sizes = t[p]; p += 1
p += 1  # reserved
valid = struct.unpack_from('<Q', t, p)[0]; p += 8
sorted_ = struct.unpack_from('<Q', t, p)[0]; p += 8
rows = {}
for i in range(64):
    if valid & (1 << i):
        rows[i] = struct.unpack_from('<I', t, p)[0]
        p += 4

# heap index 大小
str_idx = 4 if heap_sizes & 0x01 else 2
guid_idx = 4 if heap_sizes & 0x02 else 2
blob_idx = 4 if heap_sizes & 0x04 else 2

def tidx(tbl):
    return 4 if rows.get(tbl, 0) > 0xFFFF else 2

def coded(tables, bits):
    mx = max(rows.get(x, 0) for x in tables)
    return 4 if mx >= (1 << (16 - bits)) else 2

TDR = ('coded', [0x02, 0x01, 0x1B], 2)
HCA = ('coded', [0x06, 0x04, 0x01, 0x02, 0x08, 0x09, 0x0A, 0x00, 0x0E, 0x17,
                 0x14, 0x11, 0x1A, 0x1B, 0x20, 0x23, 0x26, 0x27, 0x28, 0x2A, 0x2C, 0x2B], 5)

TABLES = {
    0x00: ('Module', [('Generation', 2), ('Name', 'str'), ('Mvid', 'guid'), ('EncId', 'guid'), ('EncBaseId', 'guid')]),
    0x01: ('TypeRef', [('ResolutionScope', ('coded', [0x00, 0x1A, 0x23, 0x01], 2)), ('Name', 'str'), ('Namespace', 'str')]),
    0x02: ('TypeDef', [('Flags', 4), ('Name', 'str'), ('Namespace', 'str'), ('Extends', TDR), ('FieldList', ('tbl', 0x04)), ('MethodList', ('tbl', 0x06))]),
    0x03: ('FieldPtr', [('Field', ('tbl', 0x04))]),
    0x04: ('Field', [('Flags', 2), ('Name', 'str'), ('Signature', 'blob')]),
    0x05: ('MethodPtr', [('Method', ('tbl', 0x06))]),
    0x06: ('MethodDef', [('RVA', 4), ('ImplFlags', 2), ('Flags', 2), ('Name', 'str'), ('Signature', 'blob'), ('ParamList', ('tbl', 0x08))]),
    0x07: ('ParamPtr', [('Param', ('tbl', 0x08))]),
    0x08: ('Param', [('Flags', 2), ('Sequence', 2), ('Name', 'str')]),
    0x09: ('InterfaceImpl', [('Class', ('tbl', 0x02)), ('Interface', TDR)]),
    0x0A: ('MemberRef', [('Class', ('coded', [0x02, 0x01, 0x1A, 0x06, 0x1B], 3)), ('Name', 'str'), ('Signature', 'blob')]),
    0x0B: ('Constant', [('Type', 1), ('Padding', 1), ('Parent', ('coded', [0x04, 0x08, 0x17], 2)), ('Value', 'blob')]),
    0x0C: ('CustomAttribute', [('Parent', HCA), ('Type', ('coded', [0x06, 0x0A], 3)), ('Value', 'blob')]),
    0x0D: ('FieldMarshal', [('Parent', ('coded', [0x04, 0x08], 1)), ('NativeType', 'blob')]),
    0x0E: ('DeclSecurity', [('Action', 2), ('Parent', ('coded', [0x02, 0x06, 0x20], 2)), ('PermissionSet', 'blob')]),
    0x0F: ('ClassLayout', [('PackingSize', 2), ('ClassSize', 4), ('Parent', ('tbl', 0x02))]),
    0x10: ('FieldLayout', [('Offset', 4), ('Field', ('tbl', 0x04))]),
    0x11: ('StandAloneSig', [('Signature', 'blob')]),
    0x12: ('EventMap', [('Parent', ('tbl', 0x02)), ('EventList', ('tbl', 0x14))]),
    0x13: ('EventPtr', [('Event', ('tbl', 0x14))]),
    0x14: ('Event', [('EventFlags', 2), ('Name', 'str'), ('EventType', TDR)]),
    0x15: ('PropertyMap', [('Parent', ('tbl', 0x02)), ('PropertyList', ('tbl', 0x17))]),
    0x16: ('PropertyPtr', [('Property', ('tbl', 0x17))]),
    0x17: ('Property', [('Flags', 2), ('Name', 'str'), ('Type', 'blob')]),
    0x18: ('MethodSemantics', [('Semantics', 2), ('Method', ('tbl', 0x06)), ('Association', ('coded', [0x14, 0x17], 1))]),
    0x19: ('MethodImpl', [('Class', ('tbl', 0x02)), ('MethodBody', ('coded', [0x06, 0x0A], 1)), ('MethodDeclaration', ('coded', [0x06, 0x0A], 1))]),
    0x1A: ('ModuleRef', [('Name', 'str')]),
    0x1B: ('TypeSpec', [('Signature', 'blob')]),
    0x1C: ('ImplMap', [('MappingFlags', 2), ('MemberForwarded', ('coded', [0x04, 0x06], 1)), ('ImportName', 'str'), ('ImportScope', ('tbl', 0x1A))]),
    0x1D: ('FieldRVA', [('RVA', 4), ('Field', ('tbl', 0x04))]),
    0x1E: ('EncLog', [('Token', 4), ('FuncCode', 4)]),
    0x1F: ('EncMap', [('Token', 4)]),
    0x20: ('Assembly', [('HashAlgId', 4), ('Major', 2), ('Minor', 2), ('Build', 2), ('Rev', 2), ('Flags', 4), ('PublicKey', 'blob'), ('Name', 'str'), ('Culture', 'str')]),
    0x21: ('AssemblyProcessor', [('Processor', 4)]),
    0x22: ('AssemblyOS', [('OSPlatformID', 4), ('OSMajorVersion', 4), ('OSMinorVersion', 4)]),
    0x23: ('AssemblyRef', [('Major', 2), ('Minor', 2), ('Build', 2), ('Rev', 2), ('Flags', 4), ('PublicKeyOrToken', 'blob'), ('Name', 'str'), ('Culture', 'str'), ('HashValue', 'blob')]),
    0x24: ('AssemblyRefProcessor', [('Processor', 4), ('AssemblyRef', ('tbl', 0x23))]),
    0x25: ('AssemblyRefOS', [('OSPlatformID', 4), ('OSMajorVersion', 4), ('OSMinorVersion', 4), ('AssemblyRef', ('tbl', 0x23))]),
    0x26: ('File', [('Flags', 4), ('Name', 'str'), ('HashValue', 'blob')]),
    0x27: ('ExportedType', [('Flags', 4), ('TypeDefId', 4), ('TypeName', 'str'), ('TypeNamespace', 'str'), ('Implementation', ('coded', [0x26, 0x23, 0x27], 2))]),
    0x28: ('ManifestResource', [('Offset', 4), ('Flags', 4), ('Name', 'str'), ('Implementation', ('coded', [0x26, 0x23, 0x27], 2))]),
    0x29: ('NestedClass', [('NestedClass', ('tbl', 0x02)), ('EnclosingClass', ('tbl', 0x02))]),
    0x2A: ('GenericParam', [('Number', 2), ('Flags', 2), ('Owner', ('coded', [0x02, 0x06], 1)), ('Name', 'str')]),
    0x2B: ('MethodSpec', [('Method', ('coded', [0x06, 0x0A], 1)), ('Instantiation', 'blob')]),
    0x2C: ('GenericParamConstraint', [('Owner', ('tbl', 0x2A)), ('Constraint', TDR)]),
}

def colsize(c):
    if isinstance(c, int):
        return c
    if c == 'str':
        return str_idx
    if c == 'guid':
        return guid_idx
    if c == 'blob':
        return blob_idx
    kind = c[0]
    if kind == 'tbl':
        return tidx(c[1])
    if kind == 'coded':
        return coded(c[1], c[2])
    raise ValueError(c)

# 计算每表行大小（表必须按 tid 顺序连续）
offsets = {}
cur = p
for tid in sorted(rows):
    if tid not in TABLES:
        raise SystemExit(f'未实现的表 0x{tid:02X}（{rows[tid]} 行）—— 需要先补列定义')
    name, cols = TABLES[tid]
    size = sum(colsize(c) for _, c in cols)
    offsets[tid] = (cur, size, cols)
    cur += size * rows[tid]

# heap 读取
def heap_str(i):
    b = data[meta['#Strings']['off']:meta['#Strings']['off'] + meta['#Strings']['size']]
    e = b.find(b'\0', i)
    return b[i:e].decode('utf-8', 'replace')

def read_row(tid, idx):
    base, size, cols = offsets[tid]
    o = base + size * idx
    out = {}
    for cname, c in cols:
        cs = colsize(c)
        if cs == 2:
            v = struct.unpack_from('<H', t, o)[0]
        elif cs == 4:
            v = struct.unpack_from('<I', t, o)[0]
        o += cs
        if c == 'str':
            out[cname] = heap_str(v)
        else:
            out[cname] = v
    return out

result = {'row_counts': {TABLES[k][0]: v for k, v in rows.items() if k in TABLES}}
for tid in (0x02, 0x06, 0x04, 0x17, 0x15, 0x01, 0x0A, 0x1A, 0x26):
    if tid not in rows:
        continue
    nm = TABLES[tid][0]
    result[nm] = [read_row(tid, i) for i in range(rows[tid])]

# TypeDef 的字段/方法归属
tds = result.get('TypeDef', [])
for i, td in enumerate(tds):
    td['_fields'] = []
    td['_methods'] = []
    fstart = td['FieldList']
    fend = tds[i + 1]['FieldList'] if i + 1 < len(tds) else rows.get(0x04, 0) + 1
    mstart = td['MethodList']
    mend = tds[i + 1]['MethodList'] if i + 1 < len(tds) else rows.get(0x06, 0) + 1
    flds = result.get('Field', [])
    mths = result.get('MethodDef', [])
    for k in range(fstart, min(fend, len(flds) + 1)):
        if 1 <= k <= len(flds):
            td['_fields'].append(flds[k - 1]['Name'])
    for k in range(mstart, min(mend, len(mths) + 1)):
        if 1 <= k <= len(mths):
            td['_methods'].append(mths[k - 1]['Name'])

json.dump(result, open('meta/tables.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('rows:', {TABLES[k][0]: v for k, v in rows.items() if k in TABLES})

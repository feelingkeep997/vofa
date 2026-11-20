# -*- coding: utf-8 -*-
"""
解析 .NET metadata root，导出各 stream 偏移，并把 #US(user string) 堆里的
UTF-16 字面量全部导出 —— WinForms 的界面文本、MessageBox 提示语都在这里。
"""
import struct, sys, json, os

path = sys.argv[1]
outdir = sys.argv[2]
data = open(path, 'rb').read()
os.makedirs(outdir, exist_ok=True)

# ---- PE ----
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

cli = r2o(cli_rva)
md_rva, md_size = struct.unpack_from('<II', data, cli + 8)
md = r2o(md_rva)
print(f'# metadata root fileoff=0x{md:X} size={md_size}', file=sys.stderr)

assert data[md:md + 4] == b'BSJB', 'bad metadata signature'
p = md + 4
major, minor = struct.unpack_from('<HH', data, p); p += 4
p += 4  # reserved
vlen = struct.unpack_from('<I', data, p)[0]; p += 4
ver = data[p:p + vlen].rstrip(b'\0').decode('latin1'); p += vlen
flags, nstreams = struct.unpack_from('<HH', data, p); p += 4
print(f'# runtime {ver} streams={nstreams}', file=sys.stderr)

streams = {}
for _ in range(nstreams):
    off, size = struct.unpack_from('<II', data, p); p += 8
    e = data.index(b'\0', p)
    name = data[p:e].decode('latin1')
    p = e + 1
    while (p - md) % 4:
        p += 1
    streams[name] = (md + off, size)
    print(f'  stream {name:<10} off=0x{md+off:X} size={size}', file=sys.stderr)

json.dump({k: {'off': v[0], 'size': v[1]} for k, v in streams.items()},
          open(os.path.join(outdir, '_streams.json'), 'w'), indent=1)

# ---- #US heap ----
if '#US' in streams:
    base, size = streams['#US']
    blob = data[base:base + size]
    open(os.path.join(outdir, '#US.bin'), 'wb').write(blob)
    out = []
    p = 0
    n = len(blob)
    while p < n:
        b = blob[p]
        if b == 0:
            p += 1
            continue
        # 压缩长度
        if b & 0x80 == 0:
            ln = b; p += 1
        elif b & 0xC0 == 0x80:
            ln = ((b & 0x3F) << 8) | blob[p + 1]; p += 2
        else:
            ln = ((b & 0x1F) << 24) | (blob[p + 1] << 16) | (blob[p + 2] << 8) | blob[p + 3]; p += 4
        if ln <= 0 or p + ln > n:
            p += 1
            continue
        raw = blob[p:p + ln]
        p += ln
        # 末字节是 flag(0x01)，其余是 UTF-16LE
        body = raw[:-1] if raw and raw[-1] in (1, 0) else raw
        if len(body) % 2:
            body = body[:-1]
        try:
            s = body.decode('utf-16-le')
        except Exception:
            continue
        if not s:
            continue
        out.append(s)
    json.dump(out, open(os.path.join(outdir, 'us_strings.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=0)
    print(f'#US literals: {len(out)}', file=sys.stderr)

# ---- #Strings heap ----
if '#Strings' in streams:
    base, size = streams['#Strings']
    blob = data[base:base + size]
    names = [x.decode('utf-8', 'replace') for x in blob.split(b'\0') if x]
    json.dump(names, open(os.path.join(outdir, 'strings_heap.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=0)
    print(f'#Strings entries: {len(names)}', file=sys.stderr)

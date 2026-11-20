# -*- coding: utf-8 -*-
"""
从 .NET PE 里按 CLI Header 的 Resources 目录，把每个 ManifestResource 的原始字节抽出来。
不依赖 dnfile，手工解析 PE 结构（目标 exe 的元数据表有异常行，dnfile 可能直接崩）。
"""
import struct, sys, os, json

path = sys.argv[1]
outdir = sys.argv[2]
data = open(path, 'rb').read()

pe_off = struct.unpack_from('<I', data, 0x3C)[0]
assert data[pe_off:pe_off + 4] == b'PE\0\0', 'not PE'
coff = pe_off + 4
num_sec = struct.unpack_from('<H', data, coff + 2)[0]
opt_size = struct.unpack_from('<H', data, coff + 16)[0]
opt = coff + 20
magic = struct.unpack_from('<H', data, opt)[0]
is_pe32p = magic == 0x20b
dd_off = opt + (112 if is_pe32p else 96)
num_dd = struct.unpack_from('<I', data, dd_off - 4)[0]
dirs = []
for i in range(min(num_dd, 16)):
    rva, size = struct.unpack_from('<II', data, dd_off + i * 8)
    dirs.append((rva, size))

sec_off = opt + opt_size
sections = []
for i in range(num_sec):
    o = sec_off + i * 40
    name = data[o:o + 8].rstrip(b'\0').decode('latin1')
    vsize, vaddr, rawsize, rawptr = struct.unpack_from('<IIII', data, o + 8)
    sections.append({'name': name, 'vaddr': vaddr, 'vsize': vsize, 'rawptr': rawptr, 'rawsize': rawsize})

def rva2off(rva):
    for s in sections:
        if s['vaddr'] <= rva < s['vaddr'] + max(s['vsize'], s['rawsize']):
            return s['rawptr'] + (rva - s['vaddr'])
    return None

cli_rva, cli_size = dirs[14]
cli_off = rva2off(cli_rva)
res_rva, res_size = struct.unpack_from('<II', data, cli_off + 24)
res_off = rva2off(res_rva)
print(f'# CLI header @0x{cli_off:X}  Resources rva=0x{res_rva:X} size={res_size} fileoff=0x{res_off:X}', file=sys.stderr)

# 资源名清单来自 REA（inspect_managed_artifact），这里只按 offset/size 抽字节，
# 名字与 offset 的对应关系用下面这张表（REA 的 ManifestResource 行）
res_table = json.load(open(sys.argv[3], encoding='utf-8'))

os.makedirs(outdir, exist_ok=True)
manifest = []
for name, off, size in res_table:
    # ManifestResource.Offset 指向 4 字节长度前缀，真正的数据在其后
    base = res_off + off
    declared = struct.unpack_from('<I', data, base)[0]
    blob = data[base + 4: base + 4 + declared]
    safe = name.replace('/', '_').replace('\\', '_')
    p = os.path.join(outdir, safe)
    open(p, 'wb').write(blob)
    manifest.append({'name': name, 'offset': off, 'size': size, 'bytes': len(blob), 'file': p})

json.dump(manifest, open(os.path.join(outdir, '_manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
for m in manifest:
    print(f"{m['offset']:>8}  {m['size']:>7}  {m['name']}")

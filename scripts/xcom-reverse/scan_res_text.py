# -*- coding: utf-8 -*-
"""在 .resources 里直接扫 UTF-8 可读串（键名 + 界面文本都是 UTF-8 存的）"""
import re, sys, json

# 允许：ASCII 可打印、中文 UTF-8（E4-E9 开头）、全角标点（EF BC/BD）
pat = re.compile(rb'(?:[\x20-\x7e]|[\xe3-\xe9][\x80-\xbf]{2}|[\xef][\xbc-\xbd][\x80-\xbf]){2,}')

out = []
for path in sys.argv[1:]:
    buf = open(path, 'rb').read()
    seen = set()
    for m in pat.finditer(buf):
        try:
            s = m.group().decode('utf-8')
        except Exception:
            continue
        if len(s) < 2:
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append({'file': path.split('/')[-1].split('\\')[-1], 'off': m.start(), 'text': s})

print(json.dumps(out, ensure_ascii=False, indent=0))

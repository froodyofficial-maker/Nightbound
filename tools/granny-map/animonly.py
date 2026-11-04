# Strip a GLB down to its node hierarchy and animations (no meshes, skins, materials or images).
import json, struct, sys
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); B = b[20 + jl + 8:]
keep_acc = sorted({s[k] for a in J.get('animations', []) for s in a['samplers'] for k in ('input', 'output')})
binb = bytearray(); views = []; accs = []; amap = {}
for i in keep_acc:
    a = dict(J['accessors'][i]); v = J['bufferViews'][a['bufferView']]
    o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]; size = {5126: 4, 5123: 2, 5121: 1, 5125: 4}[a['componentType']]
    data = B[o:o + a['count'] * nc * size]
    while len(binb) % 4: binb.append(0)
    views.append({'buffer': 0, 'byteOffset': len(binb), 'byteLength': len(data)}); binb.extend(data)
    a['bufferView'] = len(views) - 1; a.pop('byteOffset', None); accs.append(a); amap[i] = len(accs) - 1
for a in J['animations']:
    for s in a['samplers']: s['input'] = amap[s['input']]; s['output'] = amap[s['output']]
for n in J['nodes']:
    for k in ('mesh', 'skin', 'camera'): n.pop(k, None)
for k in ('meshes', 'skins', 'materials', 'textures', 'images', 'samplers', 'cameras'): J.pop(k, None)
J['accessors'] = accs; J['bufferViews'] = views; J['buffers'] = [{'byteLength': len(binb)}]
js = json.dumps(J, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(binb) % 4: binb.append(0)
open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(binb)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binb), 0x004E4942) + bytes(binb))
print(dst, (28 + len(js) + len(binb)) // 1024, 'KB')

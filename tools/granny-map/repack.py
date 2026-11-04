import json, struct, io, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
cl, _ = struct.unpack('<II', b[12:20]); j = json.loads(b[20:20 + cl])
off = 20 + cl; bl, _ = struct.unpack('<II', b[off:off + 8]); bin_ = b[off + 8: off + 8 + bl]
# which texture slots each image is used for
use = {}
for m in j['materials']:
    pbr = m.get('pbrMetallicRoughness', {})
    for slot, t in [('base', pbr.get('baseColorTexture')), ('mr', pbr.get('metallicRoughnessTexture')), ('normal', m.get('normalTexture')), ('occ', m.get('occlusionTexture')), ('emis', m.get('emissiveTexture'))] + [('spec', v) for v in m.get('extensions', {}).get('KHR_materials_specular', {}).values() if isinstance(v, dict)]:
        if t: use.setdefault(j['textures'][t['index']]['source'], []).append((m['name'], slot))
    print(m['name'], m.get('alphaMode'), m.get('extensions', {}).keys())
views = j['bufferViews']
newbin = bytearray(); newviews = []
imgview = {i['bufferView']: n for n, i in enumerate(j['images'])}
for vi, v in enumerate(views):
    data = bin_[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']]
    if vi in imgview:
        n = imgview[vi]; im = Image.open(io.BytesIO(data)); im.load()
        slots = use.get(n, [])
        alpha = im.mode in ('RGBA', 'LA') and im.getchannel('A').getextrema()[0] < 250
        size = 512 if all(s[1] in ('mr', 'spec', 'occ') for s in slots) or 'Hair' in str(slots) else 1024
        im.thumbnail((size, size), Image.LANCZOS)
        out = io.BytesIO()
        if alpha: im.save(out, 'PNG', optimize=True); j['images'][n]['mimeType'] = 'image/png'
        else: im.convert('RGB').save(out, 'JPEG', quality=86, optimize=True); j['images'][n]['mimeType'] = 'image/jpeg'
        print('img', n, slots, im.size, 'alpha' if alpha else '', len(data), '->', out.tell())
        data = out.getvalue()
    while len(newbin) % 4: newbin.append(0)
    nv = dict(v); nv['byteOffset'] = len(newbin); nv['byteLength'] = len(data); newbin += data; newviews.append(nv)
while len(newbin) % 4: newbin.append(0)
j['bufferViews'] = newviews; j['buffers'][0]['byteLength'] = len(newbin)
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(newbin)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(newbin), 0x004E4942) + bytes(newbin)
open(dst, 'wb').write(out); print('total', len(b), '->', len(out))

# Convert KHR_materials_pbrSpecularGlossiness materials (no longer read by three.js) to metal/roughness.
import json, struct, sys
src, dst = sys.argv[1], sys.argv[2]
emis = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
b = open(src, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); rest = b[20 + jl:]
for m in J.get('materials', []):
    sg = m.get('extensions', {}).pop('KHR_materials_pbrSpecularGlossiness', None)
    if sg is None: continue
    pbr = m.setdefault('pbrMetallicRoughness', {})
    pbr['baseColorFactor'] = sg.get('diffuseFactor', [1, 1, 1, 1])
    if 'diffuseTexture' in sg: pbr['baseColorTexture'] = sg['diffuseTexture']
    pbr['metallicFactor'] = 0.0; pbr['roughnessFactor'] = max(0.35, 1 - sg.get('glossinessFactor', 0.1))
    if 'emissiveFactor' in m: m['emissiveFactor'] = [c * emis for c in m['emissiveFactor']]
    if not m.get('extensions'): m.pop('extensions', None)
for k in ('extensionsUsed', 'extensionsRequired'):
    if k in J:
        J[k] = [e for e in J[k] if e != 'KHR_materials_pbrSpecularGlossiness']
        if not J[k]: J.pop(k)
js = json.dumps(J, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, 20 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)
print('converted', dst)

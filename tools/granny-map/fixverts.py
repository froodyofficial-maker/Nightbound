# Move the skinned body's vertices into the space its inverse-bind matrices expect (affine fitted
# from joint-weighted vertex clusters to bind joint positions). Writes a patched GLB.
import json, struct, sys, numpy as np
src, dst = sys.argv[1], sys.argv[2]
b = bytearray(open(src, 'rb').read()); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); BO = 20 + jl + 8
N = J['nodes']
def view(i):
    a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]; off = BO + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    comp = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a['componentType']]; nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    stride = v.get('byteStride')
    assert not stride or stride == nc * np.dtype(comp).itemsize
    return off, np.frombuffer(bytes(b[off:off + a['count'] * nc * np.dtype(comp).itemsize]), dtype=comp).reshape(a['count'], nc).astype(np.float64)
sk = J['skins'][0]
_, ibm = view(sk['inverseBindMatrices']); ibm = ibm.reshape(-1, 4, 4).transpose(0, 2, 1)
bindpos = np.array([np.linalg.inv(m)[:3, 3] for m in ibm])
for n in N:
    if 'skin' not in n: continue
    for prim in J['meshes'][n['mesh']]['primitives']:
        po, P = view(prim['attributes']['POSITION']); _, jt = view(prim['attributes']['JOINTS_0']); _, wt = view(prim['attributes']['WEIGHTS_0'])
        dom = jt[np.arange(len(jt)), wt.argmax(1)].astype(int)
        S, D = [], []
        for k in set(dom.tolist()):
            sel = P[dom == k]
            if len(sel) >= 40: S.append(sel.mean(0)); D.append(bindpos[k])
        A = np.c_[np.array(S), np.ones(len(S))]; X = np.linalg.lstsq(A, np.array(D), rcond=None)[0]
        P2 = P @ X[:3] + X[3]
        b[po:po + P2.size * 4] = P2.astype(np.float32).tobytes()
        J['accessors'][prim['attributes']['POSITION']]['min'] = P2.min(0).tolist(); J['accessors'][prim['attributes']['POSITION']]['max'] = P2.max(0).tolist()
        if 'NORMAL' in prim['attributes']:
            no, Nn = view(prim['attributes']['NORMAL']); Nn = Nn @ np.linalg.inv(X[:3]).T; Nn /= np.linalg.norm(Nn, axis=1, keepdims=True) + 1e-9
            b[no:no + Nn.size * 4] = Nn.astype(np.float32).tobytes()
        print('moved', len(P2), 'vertices; affine diag', np.diag(X[:3]).round(3))
js = json.dumps(J, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
binc = bytes(b[BO:]); out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(binc) + 8 - 8 + 8 - 8) 
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binc)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binc), 0x004E4942) + binc
open(dst, 'wb').write(glb)

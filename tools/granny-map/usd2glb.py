# Granny 3 map (USDZ/usdc) -> GLB for Nightbound: game scale, ground floor at y=0, below-ground parts dropped
import sys, json, struct, io, os
import numpy as np
from pxr import Usd, UsdGeom, UsdShade
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
TEXMAX = int(sys.argv[3]) if len(sys.argv) > 3 else 512
st = Usd.Stage.Open(src)
S = 0.13            # USD units -> metres (x1.3 so doorways fit the game's characters)
YARD = -45.0        # yard level in USD units -> y = 0
HOUSE = (-94, 106, -91, 127)  # house footprint (x0, x1, z0, z1)
HOUSE_DROP = 7.3    # the house floor sits 7.5 units above the yard: lower it to just above the ground
GATES = [(-4.0, -29.9), (6.0, 30.75)]  # (x, wall z) in metres: holes cut in the outer wall for the exit gates
bb = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'render'])
groups = {}  # material path -> lists
def clip_poly(poly, keep):
    # Sutherland-Hodgman against one plane; poly: list of (pos, uv, n); keep(p) -> signed distance (>=0 kept)
    out = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        da, db = keep(a[0]), keep(b[0])
        if da >= 0: out.append(a)
        if (da >= 0) != (db >= 0):
            t = da / (da - db); out.append(tuple(a[k] + (b[k] - a[k]) * t for k in range(3)))
    return out
def cut_gates(P, U, Nn):
    outP, outU, outN = [], [], []
    for t in range(0, len(P), 3):
        tri = [(P[t + k], U[t + k], Nn[t + k]) for k in range(3)]
        pieces = [tri]
        for gx, gz in GATES:
            nxt = []
            for poly in pieces:
                zs = [v[0][2] for v in poly]
                if min(abs(z - gz) for z in zs) > 2 and not (min(zs) < gz < max(zs)): nxt.append(poly); continue
                L = clip_poly(poly, lambda p, gx=gx: (gx - 2.9) - p[0])
                Rr = clip_poly(poly, lambda p, gx=gx: p[0] - (gx + 2.9))
                for q in (L, Rr):
                    if len(q) >= 3: nxt.append(q)
            pieces = nxt
        for poly in pieces:
            for k in range(1, len(poly) - 1):
                for v in (poly[0], poly[k], poly[k + 1]): outP.append(v[0]); outU.append(v[1]); outN.append(v[2])
    return np.array(outP), np.array(outU), np.array(outN)
skipped = []
for p in st.Traverse():
    if not p.IsA(UsdGeom.Mesh): continue
    name = p.GetName()
    r = bb.ComputeWorldBound(p).ComputeAlignedRange(); mn, mx = r.GetMin(), r.GetMax()
    if name.split('_')[0] in ('KitchenDoor', 'CellarStairDoor', 'ShedDoor', 'ShedLockerDoor', 'ShedLock', 'ShedLockPart1', 'ShedLockPart2') or name.startswith('Subway') or name.startswith('Tomten') or name.startswith('Vallgrav') or 'Water' in name or mx[1] < YARD - 6 or name.startswith('Cellar'):
        skipped.append(name); continue
    m = UsdGeom.Mesh(p)
    pts = np.array(m.GetPointsAttr().Get(), dtype=np.float64)
    if len(pts) == 0: continue
    X = np.array(UsdGeom.Xformable(p).ComputeLocalToWorldTransform(Usd.TimeCode.Default()), dtype=np.float64)
    P = np.c_[pts, np.ones(len(pts))] @ X
    P = P[:, :3]
    counts = np.array(m.GetFaceVertexCountsAttr().Get()); idx = np.array(m.GetFaceVertexIndicesAttr().Get())
    # triangulate (fan) -> corner indices into the face-vertex list
    tri = []; off = 0
    for c in counts:
        for k in range(1, c - 1): tri += [off, off + k, off + k + 1]
        off += c
    tri = np.array(tri, dtype=np.int64)
    if m.GetOrientationAttr().Get() == 'leftHanded': tri = tri.reshape(-1, 3)[:, [0, 2, 1]].ravel()
    cpos = P[idx[tri]]
    pv = UsdGeom.PrimvarsAPI(p).GetPrimvar('st0')
    uv = np.zeros((len(tri), 2))
    if pv and pv.HasValue():
        vals = np.array(pv.ComputeFlattened(), dtype=np.float64)
        interp = pv.GetInterpolation()
        if interp == 'faceVarying' and len(vals) == len(idx): uv = vals[tri]
        elif len(vals) == len(pts): uv = vals[idx[tri]]
    nA = m.GetNormalsAttr(); nv = nA.Get()
    nrm = None
    if nv is not None and len(nv):
        nv = np.array(nv, dtype=np.float64); R = X[:3, :3]
        nv = nv @ R; nv /= np.maximum(1e-9, np.linalg.norm(nv, axis=1, keepdims=True))
        if len(nv) == len(idx): nrm = nv[tri]
        elif len(nv) == len(pts): nrm = nv[idx[tri]]
    if nrm is None:
        a, b, c = cpos[0::3], cpos[1::3], cpos[2::3]; fn = np.cross(b - a, c - a); fn /= np.maximum(1e-9, np.linalg.norm(fn, axis=1, keepdims=True)); nrm = np.repeat(fn, 3, axis=0)
    # placement: house down onto the yard, flatten the grounds, scale
    inside = mn[0] >= HOUSE[0] and mx[0] <= HOUSE[1] and mn[2] >= HOUSE[2] and mx[2] <= HOUSE[3] and mn[1] >= YARD - 1
    cpos = cpos.copy()
    if inside: cpos[:, 1] -= HOUSE_DROP
    if name.startswith('Tomten') or name.startswith('Vallgrav'): cpos[:, 1] = np.minimum(cpos[:, 1], YARD); cpos[:, 1] = np.maximum(cpos[:, 1], YARD - 0.3)
    cpos[:, 1] -= YARD
    cpos *= S
    if name.startswith('Muren'):
        cpos, uv, nrm = cut_gates(cpos, uv, nrm)
    mat = UsdShade.MaterialBindingAPI(p).ComputeBoundMaterial()[0]
    key = str(mat.GetPath()) if mat else 'none'
    g = groups.setdefault(key, {'pos': [], 'uv': [], 'n': [], 'names': []})
    g['pos'].append(cpos.astype(np.float32)); g['uv'].append(uv.astype(np.float32)); g['n'].append(nrm.astype(np.float32)); g['names'].append(name)
print('skipped', len(skipped))
# textures
def mat_tex(path):
    if path == 'none': return None, (0.6, 0.6, 0.6)
    prim = st.GetPrimAtPath(path); tex = None; col = (1, 1, 1)
    for s in Usd.PrimRange(prim):
        if s.IsA(UsdShade.Shader):
            sh = UsdShade.Shader(s)
            if sh.GetIdAttr().Get() == 'UsdUVTexture' and sh.GetInput('file') and tex is None:
                a = sh.GetInput('file').Get(); tex = a.resolvedPath or a.path
            if sh.GetIdAttr().Get() == 'UsdPreviewSurface':
                dc = sh.GetInput('diffuseColor')
                if dc and dc.Get() is not None and not dc.HasConnectedSource(): col = tuple(dc.Get())
    return tex, col
bin_ = bytearray(); bviews = []; accessors = []; images = []; textures = []; materials = []; meshes = []; nodes = []
def add_view(data, target=None):
    while len(bin_) % 4: bin_.append(0)
    o = len(bin_); bin_.extend(data); v = {'buffer': 0, 'byteOffset': o, 'byteLength': len(data)}
    if target: v['target'] = target
    bviews.append(v); return len(bviews) - 1
def add_acc(arr, comp, typ, target, mm=False):
    v = add_view(arr.tobytes(), target); a = {'bufferView': v, 'componentType': comp, 'count': int(arr.shape[0]), 'type': typ}
    if mm: a['min'] = arr.min(axis=0).tolist(); a['max'] = arr.max(axis=0).tolist()
    accessors.append(a); return len(accessors) - 1
img_cache = {}
for key, g in groups.items():
    pos = np.concatenate(g['pos']); uv = np.concatenate(g['uv']); n = np.concatenate(g['n'])
    # dedupe corners into indexed vertices
    q = np.c_[np.round(pos * 500), np.round(uv * 2048), np.round(n * 64)]
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    P, U, N = pos[first], uv[first], n[first]
    U = U.copy(); U[:, 1] = 1 - U[:, 1]
    I = inv.astype(np.uint32)
    tex, col = mat_tex(key)
    mat = {'name': key.split('/')[-1], 'pbrMetallicRoughness': {'metallicFactor': 0, 'roughnessFactor': 0.9, 'baseColorFactor': [col[0], col[1], col[2], 1]}, 'doubleSided': True}
    if tex and os.path.exists(tex):
        if tex not in img_cache:
            im = Image.open(tex); alpha = im.mode in ('RGBA', 'LA') and im.getextrema()[-1][0] < 250
            im = im.convert('RGBA' if alpha else 'RGB'); im.thumbnail((TEXMAX, TEXMAX))
            buf = io.BytesIO()
            if alpha: im.save(buf, 'PNG', optimize=True); mime = 'image/png'
            else: im.save(buf, 'JPEG', quality=78); mime = 'image/jpeg'
            images.append({'bufferView': add_view(buf.getvalue()), 'mimeType': mime}); textures.append({'source': len(images) - 1, 'sampler': 0})
            img_cache[tex] = (len(textures) - 1, alpha)
        ti, alpha = img_cache[tex]
        mat['pbrMetallicRoughness']['baseColorTexture'] = {'index': ti}; mat['pbrMetallicRoughness']['baseColorFactor'] = [1, 1, 1, 1]
        if alpha: mat['alphaMode'] = 'MASK'; mat['alphaCutoff'] = 0.5
    materials.append(mat)
    prim = {'attributes': {'POSITION': add_acc(P, 5126, 'VEC3', 34962, True), 'NORMAL': add_acc(N, 5126, 'VEC3', 34962), 'TEXCOORD_0': add_acc(U, 5126, 'VEC2', 34962)}, 'indices': add_acc(I, 5125, 'SCALAR', 34963), 'material': len(materials) - 1}
    meshes.append({'name': mat['name'], 'primitives': [prim]}); nodes.append({'mesh': len(meshes) - 1, 'name': mat['name']})
J = {'asset': {'version': '2.0', 'generator': 'nightbound usd2glb', 'extras': {'title': 'Granny 3 map'}}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes, 'materials': materials,
     'accessors': accessors, 'bufferViews': bviews, 'buffers': [{'byteLength': len(bin_)}], 'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]}
if images: J['images'] = images; J['textures'] = textures
js = json.dumps(J, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(bin_) % 4: bin_.append(0)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
open(out, 'wb').write(glb)
print('wrote', out, len(glb) // 1024, 'KB', 'materials', len(materials), 'verts', sum(a['count'] for a in accessors if a['type'] == 'VEC3') // 2)

# Repair corrupted inverse-bind matrices: a joint whose bind transform relative to its parent isn't a
# rigid offset (scale far from 1) gets parent_bind * rest_local instead. Writes a patched GLB.
import json, struct, sys, numpy as np
src, dst = sys.argv[1], sys.argv[2]
b = bytearray(open(src, 'rb').read()); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); BO = 20 + jl + 8
N = J['nodes']; par = {}
for i, n in enumerate(N):
    for c in n.get('children', []): par[c] = i
def q2m(q):
    x, y, z, w = q; return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def local(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4, 4).T
    M = np.eye(4); M[:3, :3] = q2m(n.get('rotation', [0, 0, 0, 1])) @ np.diag(n.get('scale', [1, 1, 1])); M[:3, 3] = n.get('translation', [0, 0, 0]); return M
fixed = 0
for sk in J['skins']:
    a = J['accessors'][sk['inverseBindMatrices']]; v = J['bufferViews'][a['bufferView']]; off = BO + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    ibm = np.frombuffer(bytes(b[off:off + 64 * a['count']]), dtype=np.float32).reshape(-1, 4, 4).transpose(0, 2, 1).astype(np.float64)
    joints = sk['joints']; idx = {j: k for k, j in enumerate(joints)}
    W = {j: np.linalg.inv(ibm[k]) for k, j in enumerate(joints)}
    # parents first
    order = []
    def visit(j):
        if j in order: return
        if par.get(j) in idx: visit(par[j])
        order.append(j)
    for j in joints: visit(j)
    Wo = dict(W)
    kids = {}
    for j in joints:
        if par.get(j) in idx: kids.setdefault(par[j], []).append(j)
    def rigid(pw, cw, c):  # does child c sit on parent world pw the way the skeleton says?
        L = np.linalg.inv(pw) @ cw; cols = np.linalg.norm(L[:3, :3], axis=0); rest = local(N[c])
        return np.abs(cols - np.linalg.norm(rest[:3, :3], axis=0)).max() < 0.03 and np.linalg.norm(L[:3, 3] - rest[:3, 3]) < 0.03 * (np.linalg.norm(rest[:3, 3]) + 1)
    good = set()
    for j in joints:
        p = par.get(j)
        if (p in idx and rigid(Wo[p], Wo[j], j)) or any(rigid(Wo[j], Wo[c], c) for c in kids.get(j, [])): good.add(j)
    print('good joints', len(good), 'of', len(joints))
    Wn = {j: Wo[j] for j in good}
    # bottom-up: a bad joint with a good child is placed from it
    for j in reversed(order):
        if j in Wn: continue
        gc = [c for c in kids.get(j, []) if c in Wn]
        if gc: Wn[j] = Wn[gc[0]] @ np.linalg.inv(local(N[gc[0]])); fixed += 1
    # top-down for the rest
    for j in order:
        if j in Wn: continue
        p = par.get(j)
        Wn[j] = (Wn[p] @ local(N[j])) if p in Wn else Wo[j]; fixed += 1
    W = Wn
    new = np.stack([np.linalg.inv(W[j]) for j in joints]).transpose(0, 2, 1).astype(np.float32)
    b[off:off + new.nbytes] = new.tobytes()
open(dst, 'wb').write(bytes(b))
print('fixed joints', fixed)

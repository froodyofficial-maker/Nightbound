# GLB -> blocked-cell grid (walls & solid props between knee and head height), plus an image
import json, struct, sys, numpy as np
from PIL import Image
f, outimg, outjson = sys.argv[1], sys.argv[2], sys.argv[3]
b = open(f, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); B = b[20 + jl + 8:]
def acc(i, dt, n):
    a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]; o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(B, dtype=dt, count=a['count'] * n, offset=o).reshape(a['count'], n) if n > 1 else np.frombuffer(B, dtype=dt, count=a['count'], offset=o)
CELL = 0.25; EXT = 44; N = int(EXT * 2 / CELL)
grid = np.zeros((N, N), np.uint8)
Y0, Y1 = 0.35, 1.7
for m in J['meshes']:
    pr = m['primitives'][0]; P = acc(pr['attributes']['POSITION'], np.float32, 3); I = acc(pr['indices'], np.uint32, 1).reshape(-1, 3)
    T = P[I]  # tris
    ymin, ymax = T[:, :, 1].min(1), T[:, :, 1].max(1)
    sel = (ymax > Y0) & (ymin < Y1)
    T = T[sel]
    if not len(T): continue
    nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ln = np.linalg.norm(nrm, axis=1) + 1e-9; ny = np.abs(nrm[:, 1]) / ln
    T = T[ny < 0.6]  # steep surfaces only (walls, sides of furniture)
    for t in T:
        # sample the triangle densely, keep samples inside the height band
        e = max(np.linalg.norm(t[1] - t[0]), np.linalg.norm(t[2] - t[0]), np.linalg.norm(t[2] - t[1]))
        k = int(min(400, max(2, e / (CELL * 0.5))))
        u, v = np.meshgrid(np.linspace(0, 1, k), np.linspace(0, 1, k)); u, v = u.ravel(), v.ravel(); ok = u + v <= 1; u, v = u[ok], v[ok]
        pts = t[0] + np.outer(u, t[1] - t[0]) + np.outer(v, t[2] - t[0])
        pts = pts[(pts[:, 1] > Y0) & (pts[:, 1] < Y1)]
        gx = ((pts[:, 0] + EXT) / CELL).astype(int); gz = ((pts[:, 2] + EXT) / CELL).astype(int)
        okk = (gx >= 0) & (gx < N) & (gz >= 0) & (gz < N)
        grid[gz[okk], gx[okk]] = 1
img = Image.fromarray(255 - grid * 255).convert('RGB')
img = img.resize((N * 2, N * 2), Image.NEAREST)
# 5 m grid lines
a = np.array(img)
for m in range(-40, 41, 5):
    c = int((m + EXT) / CELL) * 2
    a[:, c] = [255, 0, 0] if m == 0 else [200, 200, 255]; a[c, :] = [255, 0, 0] if m == 0 else [200, 200, 255]
Image.fromarray(a).save(outimg)
json.dump({'cell': CELL, 'ext': EXT, 'n': N, 'rows': [''.join('1' if v else '0' for v in row) for row in grid]}, open(outjson, 'w'))
print('blocked cells', int(grid.sum()))

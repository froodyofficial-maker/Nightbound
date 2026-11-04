# Granny's House upper floors: blocked cells = walls/props between knee and head height above each
# floor slab, plus every cell with no floor under it (stairwells, outside the house), keeping only
# what is reachable from where the stairs arrive. Usage: python3 upstairs.py granny_map.glb outdir out.js
import json, struct, sys, numpy as np
from PIL import Image
f, outdir, outjs = sys.argv[1], sys.argv[2], sys.argv[3]
b = open(f, 'rb').read(); jl = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + jl]); B = b[20 + jl + 8:]
def acc(i, dt, n):
    a = J['accessors'][i]; v = J['bufferViews'][a['bufferView']]; o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(B, dtype=dt, count=a['count'] * n, offset=o).reshape(a['count'], n) if n > 1 else np.frombuffer(B, dtype=dt, count=a['count'], offset=o)
X0, X1, Z0, Z1, C = -14.0, 16.0, -14.0, 19.0, 0.25
W, H = int((X1 - X0) / C), int((Z1 - Z0) / C)
def splat(t, keep, grid):
    e = max(np.linalg.norm(t[1] - t[0]), np.linalg.norm(t[2] - t[0]), np.linalg.norm(t[2] - t[1]))
    k = int(min(400, max(2, e / (C * 0.5))))
    u, v = np.meshgrid(np.linspace(0, 1, k), np.linspace(0, 1, k)); u, v = u.ravel(), v.ravel(); ok = u + v <= 1; u, v = u[ok], v[ok]
    p = t[0] + np.outer(u, t[1] - t[0]) + np.outer(v, t[2] - t[0]); p = p[keep(p)]
    gx = ((p[:, 0] - X0) / C).astype(int); gz = ((p[:, 2] - Z0) / C).astype(int)
    o = (gx >= 0) & (gx < W) & (gz >= 0) & (gz < H); grid[gz[o], gx[o]] = True
def floor_boxes(FLOOR, SEED, OPEN):
    wall = np.zeros((H, W), bool); floor = np.zeros((H, W), bool)
    for m in J['meshes']:
        for pr in m['primitives']:
            P = acc(pr['attributes']['POSITION'], np.float32, 3); it = J['accessors'][pr['indices']]['componentType']
            I = acc(pr['indices'], np.uint32 if it == 5125 else np.uint16, 1).reshape(-1, 3); T = P[I]
            ymin, ymax = T[:, :, 1].min(1), T[:, :, 1].max(1)
            nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); ln = np.linalg.norm(nrm, axis=1) + 1e-9; ny = nrm[:, 1] / ln
            for t in T[(np.abs(ny) < 0.6) & (ymax > FLOOR + 0.35) & (ymin < FLOOR + 1.7)]:
                splat(t, lambda p: (p[:, 1] > FLOOR + 0.35) & (p[:, 1] < FLOOR + 1.7), wall)
            for t in T[(ny > 0.98) & (ymax - ymin < 0.08) & (ymax > FLOOR - 0.2) & (ymin < FLOOR + 0.2)]:
                splat(t, lambda p: np.abs(p[:, 1] - FLOOR) < 0.2, floor)
    # fill pinholes in the floor (texture seams), then block where there's no floor
    def shift_or(g, n):
        out = g.copy()
        for _ in range(n):
            o = out.copy(); o[1:] |= out[:-1]; o[:-1] |= out[1:]; o[:, 1:] |= out[:, :-1]; o[:, :-1] |= out[:, 1:]; out = o
        return out
    def shift_and(g, n):
        out = g.copy()
        for _ in range(n):
            o = out.copy(); o[1:] &= out[:-1]; o[:-1] &= out[1:]; o[:, 1:] &= out[:, :-1]; o[:, :-1] &= out[:, 1:]; out = o
        return out
    floor = shift_and(shift_or(floor, 2), 2)
    blocked = wall | ~floor
    xc = lambda i: X0 + (i + 0.5) * C; zc = lambda j: Z0 + (j + 0.5) * C
    import math
    for j in range(H):
        for i in range(W):
            x, z = xc(i), zc(j)
            for u in OPEN:
                if u[0] == 'rect' and u[1] < x < u[2] and u[3] < z < u[4]: blocked[j, i] = False
                if u[0] == 'sector':
                    _, cx, cz, r0, r1, a0, a1 = u; r = math.hypot(x - cx, z - cz); a = math.degrees(math.atan2(z - cz, x - cx)) % 360
                    if r0 < r < r1 and (a - a0) % 360 < (a1 - a0) % 360: blocked[j, i] = False
    # keep only the floor you can actually reach from the top of the stairs
    seen = np.zeros_like(blocked); st = [(int((SEED[1] - Z0) / C), int((SEED[0] - X0) / C))]; seen[st[0]] = True
    while st:
        j, i = st.pop()
        for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, c = j + dj, i + di
            if 0 <= a < H and 0 <= c < W and not blocked[a, c] and not seen[a, c]: seen[a, c] = True; st.append((a, c))
    blocked |= ~seen
    img = np.zeros((H, W, 3), np.uint8); img[floor] = [90, 90, 90]; img[wall] = [220, 60, 60]; img[~blocked] = [230, 230, 230]
    Image.fromarray(img).resize((W * 4, H * 4), Image.NEAREST).save(outdir + '/floor%g.png' % FLOOR)
    used = np.zeros_like(blocked); boxes = []
    for j in range(H):
        i = 0
        while i < W:
            if blocked[j, i] and not used[j, i]:
                w = 1
                while i + w < W and blocked[j, i + w] and not used[j, i + w]: w += 1
                h = 1
                while j + h < H and all(blocked[j + h, i:i + w]) and not any(used[j + h, i:i + w]): h += 1
                used[j:j + h, i:i + w] = True
                boxes.append([round(X0 + (i + w / 2) * C, 3), round(Z0 + (j + h / 2) * C, 3), round(w * C / 2, 3), round(h * C / 2, 3)])
                i += w
            else: i += 1
    print('floor', FLOOR, len(boxes), 'boxes; walkable cells', int((~blocked).sum()))
    return boxes
FLOORS = [
    (4.14, (3.2, -8.75), [('rect', 2.85, 3.6, -10.0, -7.55), ('rect', -1.55, 0.8, -4.6, -3.95)]),   # first floor: top of flight 1, foot of flight 2
    (8.25, (3.2, -8.75), [('rect', 2.85, 3.6, -10.0, -7.55), ('sector', 2.5, 0.0, 0.35, 1.45, -15, 65)]),  # second floor: top of flight 2, foot of the spiral
    (13.37, (0.9, 0.1), [('sector', 2.5, 0.0, 0.35, 1.5, 140, 205)]),   # the tower room: top of the spiral
]
src = open(outjs).read()
if '\n// Upper floors' in src: src = src[:src.index('\n// Upper floors')]
if '\n// First floor' in src: src = src[:src.index('\n// First floor')]
out = []
for y, seed, opn in FLOORS: out.append({'y': y, 'boxes': floor_boxes(y, seed, opn)})
src += '\n// Upper floors (first, second, tower room): walls plus everything with no floor under it, as boxes\n// [x, z, hx, hz] within x ' + str(X0) + '..' + str(X1) + ', z ' + str(Z0) + '..' + str(Z1) + '. Generated by tools/granny-map/upstairs.py.\nexport const GRANNY_FLOORS = ' + json.dumps(out, separators=(',', ':')) + ';\n'
open(outjs, 'w').write(src)

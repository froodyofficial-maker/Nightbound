# Store each joint's bind-pose (T-pose) world rotation from a skinned GLB's inverse-bind matrices
# into another GLB with the same node list (the animation-only copy), as node.extras.bindQ.
import json, struct, sys, numpy as np
skinned, animonly = sys.argv[1], sys.argv[2]
exec(open(__file__.replace('bindquats.py', 'fixibm.py')).read().split("fixed = 0")[0].replace("src, dst = sys.argv[1], sys.argv[2]", "src = skinned"))
def world(i):
    M = local(N[i])
    while i in par: i = par[i]; M = local(N[i]) @ M
    return M
def rot2q(R):
    w = np.sqrt(max(0, 1 + R[0, 0] + R[1, 1] + R[2, 2])) / 2; x = np.sqrt(max(0, 1 + R[0, 0] - R[1, 1] - R[2, 2])) / 2
    y = np.sqrt(max(0, 1 - R[0, 0] + R[1, 1] - R[2, 2])) / 2; z = np.sqrt(max(0, 1 - R[0, 0] - R[1, 1] + R[2, 2])) / 2
    x = np.copysign(x, R[2, 1] - R[1, 2]); y = np.copysign(y, R[0, 2] - R[2, 0]); z = np.copysign(z, R[1, 0] - R[0, 1])
    q = np.array([x, y, z, w]); return q / np.linalg.norm(q)
sk = J['skins'][0]
a = J['accessors'][sk['inverseBindMatrices']]; v = J['bufferViews'][a['bufferView']]; off = BO + v.get('byteOffset', 0) + a.get('byteOffset', 0)
ibm = np.frombuffer(bytes(b[off:off + 64 * a['count']]), dtype=np.float32).reshape(-1, 4, 4).transpose(0, 2, 1).astype(np.float64)
meshnode = [i for i, n in enumerate(N) if 'skin' in n][0]; MW = world(int(sys.argv[3]) if len(sys.argv) > 3 else meshnode)
out = {}
for k, j in enumerate(sk['joints']):
    W = MW @ np.linalg.inv(ibm[k]); R = W[:3, :3]
    u, _, vt = np.linalg.svd(R); Rn = u @ vt
    if np.linalg.det(Rn) < 0: Rn = u @ np.diag([1, 1, -1]) @ vt
    out[j] = rot2q(Rn).tolist()
ab = open(animonly, 'rb').read(); al = struct.unpack('<I', ab[12:16])[0]; AJ = json.loads(ab[20:20 + al]); rest = ab[20 + al:]
for j, q in out.items(): AJ['nodes'][j].setdefault('extras', {})['bindQ'] = [round(x, 6) for x in q]
js = json.dumps(AJ, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
binchunk = rest
open(animonly, 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(binchunk)) + struct.pack('<II', len(js), 0x4E4F534A) + js + binchunk)
print('bindQ stored for', len(out), 'joints')

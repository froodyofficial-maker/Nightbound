// Builds Nightbound.html: one self-contained file (three.js, game code, CSS, fonts inlined)
// that runs when double-clicked, with no server needed.
//   cd tools && npm install && cd .. && node tools/build.mjs
import { build } from './node_modules/esbuild/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');

const threeVendor = {
  name: 'three-vendor',
  setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: join(pub, 'vendor/three/three.module.min.js') }));
    b.onResolve({ filter: /^three\/addons\// }, a => ({ path: join(pub, 'vendor/three/addons', a.path.slice('three/addons/'.length)) }));
  },
};

const res = await build({
  entryPoints: [join(pub, 'js/main.js')],
  bundle: true, format: 'iife', minify: true, write: false, target: 'es2020',
  plugins: [threeVendor], legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let css = await readFile(join(pub, 'css/style.css'), 'utf8');
for (const m of [...css.matchAll(/url\(\.\.\/fonts\/([\w.-]+\.woff2)\)/g)]) {
  const b64 = (await readFile(join(pub, 'fonts', m[1]))).toString('base64');
  css = css.replace(m[0], `url(data:font/woff2;base64,${b64})`);
}
const MIME = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
for (const m of [...new Set([...css.matchAll(/url\(\.\.\/img\/([\w.-]+)\)/g)].map(x => x[0]))]) {
  const file = m.slice('url(../img/'.length, -1), b64 = (await readFile(join(pub, 'img', file))).toString('base64');
  css = css.split(m).join(`url(data:${MIME[file.split('.').pop()]};base64,${b64})`);
}

let html = await readFile(join(pub, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>${css}</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
const peer = (await readFile(join(pub, 'vendor/peerjs.min.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
// the Foreman's rigged model as base64 in an inert tag placed before the game script (read by foremanGlb.js)
const glb = (await readFile(join(pub, 'models/foreman.glb'))).toString('base64');
const chucky = (await readFile(join(pub, 'models/chucky.glb'))).toString('base64');
const tedGlb = (await readFile(join(pub, 'models/ted.glb'))).toString('base64');
const rayGlb = (await readFile(join(pub, 'models/ray.glb'))).toString('base64');
const extraGlb = ['slimer', 'axe', 'ghosttrap', 'granny_map', 'granny', 'granny_anims', 'batman', 'grandpa', 'spidermom', 'beartrap', 'taser'].map(n => `<script id="nb-${n}-glb" type="application/octet-stream">${readFileSync(join(pub, 'models/' + n + '.glb')).toString('base64')}</script>\n`).join('');
const voices = ['bringit', 'email', 'weak', 'cock', 'shit', 'idle', 'arfh', 'teddy', 'problems', 'fuckme', 'listen', 'pussy', 'thunder'].map(n => `<script id="nb-voice-ted/${n}" type="application/octet-stream">${readFileSync(join(pub, 'audio/ted/' + n + '.mp3')).toString('base64')}</script>\n`).join('');
const withModel = html.replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script id="nb-foreman-glb" type="application/octet-stream">${glb}</script>\n<script id="nb-chucky-glb" type="application/octet-stream">${chucky}</script>\n<script id="nb-ted-glb" type="application/octet-stream">${tedGlb}</script>\n<script id="nb-ray-glb" type="application/octet-stream">${rayGlb}</script>\n${extraGlb}${voices}<script>${peer}</script>\n<script>${js}</script>`);
// the web build stays small: it fetches public/models/foreman.glb instead of embedding it
const web = html.replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script>${peer}</script>\n<script>${js}</script>`);
const note = `<title>Nightbound</title>\n  <!-- Built file: everything is inlined. Source lives in public/. -->\n  <script>window.__NB_BUILT__=${Date.now()}</script>`;
const offline = withModel.replace('<title>Nightbound</title>', note), page = web.replace('<title>Nightbound</title>', note);
await writeFile(join(root, 'Nightbound.html'), offline);
await writeFile(join(root, 'index.html'), page); // GitHub Pages entry point
console.log(`Nightbound.html ${(offline.length / 1048576).toFixed(2)} MB, index.html ${(page.length / 1048576).toFixed(2)} MB`);

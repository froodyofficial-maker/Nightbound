// Builds Nightbound.html: one self-contained file (three.js, game code, CSS, fonts inlined)
// that runs when double-clicked, with no server needed.
//   cd tools && npm install && cd .. && node tools/build.mjs
import { build } from './node_modules/esbuild/lib/main.js';
import { readFile, writeFile } from 'node:fs/promises';
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

let html = await readFile(join(pub, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>${css}</style>`);
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '');
const peer = (await readFile(join(pub, 'vendor/peerjs.min.js'), 'utf8')).replace(/<\/script/gi, '<\\/script');
// the Foreman's rigged model as base64 in an inert tag placed before the game script (read by foremanGlb.js)
const glb = (await readFile(join(pub, 'models/foreman.glb'))).toString('base64');
html = html.replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script id="nb-foreman-glb" type="application/octet-stream">${glb}</script>\n<script>${peer}</script>\n<script>${js}</script>`);
html = html.replace('<title>Nightbound</title>', '<title>Nightbound</title>\n  <!-- Built file: everything is inlined. Source lives in public/. -->');
await writeFile(join(root, 'Nightbound.html'), html);
await writeFile(join(root, 'index.html'), html); // GitHub Pages entry point
console.log(`Nightbound.html written (${(html.length / 1024 / 1024).toFixed(2)} MB)`);

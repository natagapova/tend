import * as esbuild from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';
const ortDist = 'node_modules/onnxruntime-web/dist';

await rm(outdir, { recursive: true, force: true });
await mkdir(`${outdir}/wasm`, { recursive: true });

// Static files. The ONNX runtime .wasm binaries are shipped with the extension
// because MV3 forbids loading executable code from a CDN.
await Promise.all([
  cp('src/manifest.json', `${outdir}/manifest.json`),
  cp('src/popup/popup.html', `${outdir}/popup.html`),
  cp('src/popup/popup.css', `${outdir}/popup.css`),
  ...(await readdir(ortDist))
    .filter((f) => f.endsWith('.wasm'))
    .map((f) => cp(`${ortDist}/${f}`, `${outdir}/wasm/${f}`)),
]);

const shared = { outdir, bundle: true, platform: 'browser', target: 'chrome116', sourcemap: true, logLevel: 'info' };

// background.js (an MV3 module service worker) and popup.js (loaded via
// <script type="module">) are ES modules; content.js is a classic content
// script (manifest content_scripts don't support `type: "module"`), so it
// needs its own build in a format a plain <script> can run.
const builds = [
  { ...shared, format: 'esm', entryPoints: { background: 'src/background/index.js', popup: 'src/popup/popup.js' } },
  { ...shared, format: 'iife', entryPoints: { content: 'src/content/index.js' } },
];

if (watch) {
  const ctxs = await Promise.all(builds.map((o) => esbuild.context(o)));
  await Promise.all(ctxs.map((ctx) => ctx.watch()));
} else {
  await Promise.all(builds.map((o) => esbuild.build(o)));
}

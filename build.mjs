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

const options = {
  entryPoints: {
    background: 'src/background/index.js',
    popup: 'src/popup/popup.js',
  },
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome116',
  sourcemap: true,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}

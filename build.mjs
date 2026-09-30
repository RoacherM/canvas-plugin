// Bundle the browser half into DSH's module-loader format:
//   client.js          — the entry the page loads at boot (tab type, tab body shell, tool cards)
//   client.canvas.js   — the React Flow canvas, fetched with require.async when a canvas opens
// React and ReactDOM come from the page (PLATFORM_MODULES); everything else is bundled.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const PKG = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).name;
const EXTERNAL = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'];
const production = !process.argv.includes('--dev');

async function bundle(entry, outfile, chunk) {
  const result = await build({
    entryPoints: [entry], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
    jsx: 'automatic', external: EXTERNAL, loader: { '.css': 'text' }, minify: production, legalComments: 'none',
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
  });
  const code = result.outputFiles[0].text;
  const wrapped = `window.__ModuleLoader__.load({
  id: ${JSON.stringify(PKG)},${chunk ? `\n  chunk: ${JSON.stringify(chunk)},` : ''}
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var __dshRequire = require;
${code}
    return module.exports;
  },
});
`;
  writeFileSync(new URL(outfile, import.meta.url), wrapped);
  return wrapped.length;
}

const sizes = await Promise.all([
  bundle('src/client/entry.jsx', './client.js'),
  bundle('src/client/canvas/index.jsx', './client.canvas.js', 'client.canvas.js'),
]);
console.log(`client.js ${(sizes[0] / 1024).toFixed(1)} KB, client.canvas.js ${(sizes[1] / 1024).toFixed(1)} KB`);

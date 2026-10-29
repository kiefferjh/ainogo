import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

await build({ base: './', build: { outDir: 'dist-desktop/ui' }, plugins: [{
  name: 'desktop-content-security-policy',
  transformIndexHtml: { order: 'post', handler: () => [{ tag: 'meta', attrs: {
    'http-equiv': 'Content-Security-Policy',
    content: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
  }, injectTo: 'head-prepend' }] },
}] });
mkdirSync('dist-desktop', { recursive: true });
writeFileSync('dist-desktop/session.js', stripTypeScriptTypes(readFileSync('src/session.ts', 'utf8')));

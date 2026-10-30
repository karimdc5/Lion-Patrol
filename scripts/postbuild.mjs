// After `vite build`: SPA fallback for GitHub Pages and the legacy single-file app.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const dist = root + 'dist/';
copyFileSync(dist + 'index.html', dist + '404.html');
mkdirSync(dist + 'legacy', { recursive: true });
for (const f of ['index.html', 'admin.html', 'checkpoint-qr.html', 'logo.png']) {
  if (existsSync(root + 'public/legacy/' + f)) continue; // already copied by Vite from public/
  if (existsSync(root + f)) copyFileSync(root + f, dist + 'legacy/' + f);
}
console.log('postbuild: 404.html + legacy/ ready');

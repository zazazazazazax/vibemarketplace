import { mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
// Only this generated directory is replaced. Never copy the legacy public tree,
// source files, environment files, or Farcaster webhook manifest into a deploy.
await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
for (const name of ['index.html', 'styles.css']) {
  await copyFile(resolve(root, 'archive', name), resolve(output, name));
}
for (const name of ['miniapp-hero.png', 'miniapp-icon.png', 'pdb.png', 'pdp.png', 'original-homepage.png']) {
  await copyFile(resolve(root, 'public', name), resolve(output, 'assets', name));
}
await writeFile(resolve(output, 'gone.json'), JSON.stringify({ error: 'This marketplace and its APIs have retired.' }) + '\n');
await writeFile(resolve(output, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page retired · Poorly Drawn Binders</title><link rel="stylesheet" href="/styles.css"><main><h1>This page has retired.</h1><p>Visit <a href="/">the archive</a>.</p></main></html>');
console.log('Built static archive: HTML, CSS, five local images; no JavaScript or functions.');

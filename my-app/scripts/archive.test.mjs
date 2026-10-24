import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
test('deploy contains only the static archive allowlist', async () => {
  const files = (await readdir(new URL('dist/', root), { recursive: true })).filter(x => !['assets'].includes(x)).sort();
  assert.deepEqual(files, ['404.html', 'assets/miniapp-hero.png', 'assets/miniapp-icon.png', 'assets/pdb.png', 'assets/pdp.png', 'gone.json', 'index.html', 'styles.css'].sort());
  const html = await readFile(new URL('dist/index.html', root), 'utf8');
  assert.doesNotMatch(html, /<script|<iframe|<form|alchemy\.com|walletconnect|NEXT_PUBLIC_|https?:\/\/[^"\s]*\/api\//i);
  for (const match of html.matchAll(/(?:src|href)="(\/[^"#]*)"/g)) {
    if (match[1] !== '/') await readFile(new URL(`dist${match[1]}`, root));
  }
});
test('hosting retires every API path and all former transaction pages', async () => {
  const config = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  const api = config.routes.find(route => route.status === 410);
  for (const path of ['/api', '/api/', '/api/inventory', '/api/webhook-events', '/api/quests']) assert.match(path, new RegExp(`^${api.src}$`));
  const retired = config.routes.find(route => route.status === 308);
  for (const path of ['/inventory', '/binders', '/dex', '/claim', '/quests/']) assert.match(path, new RegExp(`^${retired.src}$`));
  assert.equal(retired.headers.Location, '/');
  assert.ok(config.routes.some(route => route.headers?.['Content-Security-Policy']?.includes("default-src 'none'")));
});

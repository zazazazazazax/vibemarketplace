# Poorly Drawn Binders — the archive

The original Base marketplace is retired. This project now builds a static
memorial page with local artwork and no JavaScript, wallet integration, APIs,
or runtime secrets.

```sh
npm ci --ignore-scripts
npm run build
npm test
python3 -m http.server 4173 --directory dist
```

Deploy `dist/` using the checked-in `vercel.json`. Legacy code and assets remain
for historical preservation only; they are excluded from the deployment.
See [RETIREMENT.md](RETIREMENT.md) for hosting and credential cleanup.

# Poorly Drawn Binders retirement

The production replacement is a dependency-free static archive. `npm run build`
copies only `archive/` HTML/CSS and four explicitly selected local images into
`dist/`. `npm test` checks that deployment boundary and retired routes.

The old Next.js source, original artwork, and collection name data remain in
the repository for preservation. They are not imported, compiled, or deployed.
Do not run `next build` or restore the old deployment to publish this archive.
No environment variables, wallet SDKs, database, API, or cron jobs are needed.

`vercel.json` explicitly overrides framework/build/install/output settings.
Former transaction pages redirect home; all `/api` routes return HTTP 410,
including webhook requests. The Farcaster manifest is excluded. A restrictive
content security policy permits local images/CSS and no scripts or connections.

## Hosting cleanup still required after publishing

- Verify the production domain serves the archive and old API GET/POST requests
  return 410. Check old preview/deployment URLs separately: a new production
  deployment does not disable older deployments.
- Disable or remove accessible legacy deployments after preserving needed data.
  Do not roll back to an old marketplace build.
- Revoke the exposed Alchemy key in Alchemy (or replace shared uses first), check
  usage/billing, and rotate Vibe keys that were written to legacy error logs.
  Removing Vercel environment variables does not revoke a provider credential.
- Remove project-specific unused environment variables and webhook subscriptions
  after confirming they are not shared with other active apps.
- Export any desired database records before stopping project-specific storage.
- Website retirement does not revoke on-chain approvals, cancel listings, pause
  contracts, or stop third parties from calling those contracts.

Never put provider credentials in this document or the static deployment.

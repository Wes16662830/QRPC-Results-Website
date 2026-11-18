# QRPC Results

Results and 5-bird championship site for the Queenstown Racing Pigeon Club. Data comes from
BENZING MyPigeons (read-only); hosted on Cloudflare Pages (free plan).

## Status

- [x] Phase 0: Benzing API mapped: [`docs/benzing-api.md`](docs/benzing-api.md)
- [x] Phase 1 plan: [`docs/phase-1-plan.md`](docs/phase-1-plan.md)
- [x] Result-page parser, 5-bird points engine and the Mooi River acceptance test
- [ ] D1 schema, sync worker, site, admin, live board

## Develop

```bash
npm install
npm test            # includes the Mooi River acceptance test
npm run coverage    # points engine must stay at 100 %
npm run typecheck
```

## Layout

| Path | What |
|---|---|
| `src/core/benzing/` | Benzing adapter: parsing and validation of Benzing pages (the only code that knows Benzing's format) |
| `src/core/scoring/` | 5-bird race and season engine (pure, fully tested) |
| `fixtures/benzing/` | Real Benzing responses captured for tests |
| `docs/` | API findings and the build plan |

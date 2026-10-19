# ecosystem/ — the shared layer of the FAN LIFE universe

Byte-identical in every repo (fanlife, Dubid, Offsides, The-Worker, FuckYou). Owned by the contract, not by any one app.

| path | what |
|---|---|
| `contract.json` | who owns what: apps, roles, schemas, prefixes, moments, rules |
| `sdk.ts` | the one client for schema `shared`: touch, handoff (leads), universe |
| `feed/` | the one football data-reading engine (provider adapters) |
| `sql/NNNN_*.sql` | shared SQL, applied once and in order to Football Master; `sql/test/shared.test.mjs` proves it on PGlite |

Change anything here → the same bytes in every repo, same round. Run the `ecosystem-sync` skill first.

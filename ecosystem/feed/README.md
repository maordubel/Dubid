# ecosystem/feed — the shared football data engine

One reading engine for the whole ecosystem (FAN LIFE · OFFSIDES · DUBID · THE WORKER).
Pure TypeScript, no dependencies, only relative sibling imports — runs unchanged in
Supabase Deno edge functions, Node (`--experimental-strip-types`) and Vite.

**Byte-identical in all four repos; owned by `ecosystem/contract.json`.** Edit it in one
place and mirror it; never fork a local copy.

## Files
- `types.ts` — the canonical contract (`Snapshot`, `Fixture`, …). No provider field names.
- `sofascore.ts` — primary adapter. `scores365.ts` — backup adapter.
- `reconcile.ts` — what happens when two sources disagree (alerts, never silent picks).
- `derive.ts` — derivations shared by every adapter.
- `index.ts` — re-exports everything.

## Rules
- A provider field name appears only inside its own adapter file.
- Both games (DUBID, OFFSIDES) and the hub (FAN LIFE) read providers through these
  adapters — no app writes its own scraper.
- The canonical writer will be `core.ingest_snapshot` (a later step). Today DUBID's
  `dubid-ingest` edge function bundles these files and writes through its existing RPC.

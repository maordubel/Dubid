---
name: ecosystem-sync
description: Run before any change in FAN LIFE, OFFSIDES, DUBID or THE WORKER that touches Supabase (tables, RPCs, migrations, edge functions, cron, auth), shared football data, cross-app links, domains or ecosystem/contract.json. Keeps the four apps from breaking each other.
---

# Ecosystem sync

Four apps, one Supabase project (`afxpjfxwpdjvlmuoawda`), each worked on separately.
The source of truth is `ecosystem/contract.json` in this repo (identical in all four).

## Before the change
1. Read `ecosystem/contract.json`. Identify which app this repo is, and which schemas/prefixes it owns.
2. Classify the change:
   - **Local**: only objects this app owns. Proceed.
   - **Shared**: `core`, `shared`, `hub`, auth settings, domains, or the contract itself. This is a four-repo change.
   - **Foreign**: an object another app owns. Stop. Do it in the owner's repo, or expose a view/RPC there.
3. For any DB object: read the live definition first (Supabase `list_tables`, `pg_get_functiondef`). Never recreate a live function from a repo file.
4. THE WORKER never adds `worker_*` migrations. They are written in FAN LIFE and mirrored byte-for-byte.

## While changing
- Name new objects with the owner's prefix (see `prefixes` in the contract).
- No triggers on `auth.users`. No change to the Auth Site URL. Sign-out stays local.
- Currencies never mix; cross-app value goes only through `shared.reward_grants`.

## After the change
- If it was Shared: update `contract.json` (bump `version`, `updated`) and apply the identical file to the other three repos in the same round.
- If a new cross-app link was added, record it under `crossAppLinks`.
- Report in the final message: which apps are affected and whether the others needed a change.

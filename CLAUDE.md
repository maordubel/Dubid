# DUBID — working rules

## Impact check (mandatory, every change)
Before a change is done, check whether it requires a matching change elsewhere, and make it in the same round:
- **Admin panel** (`src/components/Admin*.tsx`, `AdminPanel.tsx`): every new table, rule, league, format or automatic process gets its admin view/control (status, kill switch, audit). Admin is always league-aware (IL / GR / EN / ES).
- **Every league**: a change for one league is checked against all four (prefixes `gw-` `gr-` `en-` `es-`, timezones, team codes, copy in he/en/el).
- **Both modes**: DUBID 5 and DUBID 11.
- **Server ↔ client**: new RPC → grants + test in `db/tests`; changed payload → every reader (`liveData.ts`, `store.ts`, screens).
- **Copy**: every new string in `src/lib/i18n/*` in he/en/el (tests fail otherwise).
- **Docs**: `docs/LAUNCH-RUNBOOK.md` for anything operational; `scripts/build-all-sql.mjs` + `db/RUN-ALL.sql` for every migration.
- Run `npm test`, `npx tsc --noEmit -p .`, `scripts/test-sql.sh` before merge.

## Delivery
- Do every step yourself (migrations, edge deploys, PR merge) — no manual steps for the owner.
- App UI copy defaults to English; mobile first; original design.

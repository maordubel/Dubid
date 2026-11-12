# DUBID — working notes for Claude

DUBID is the before-the-round companion of the FAN LIFE universe: a gameweek fantasy game in two modes, DUBID 5 and DUBID 11, across four leagues (IL, GR, EN, ES), at `dubid.dubelteam.com`. Vite, React 19, TypeScript, Supabase (Football Master) with SQL in `db/` and edge functions. It is a standalone product that must stand on its own, and it shares one identical data-reading engine with OFFSIDES.

## Working with the owner

Maor Harel owns every app here and works alone, with Claude as the whole engineering team. These are his standing decisions; each has a reason, and the reason tells you what to do in a case the line does not name.

- **Every action is done the most efficient and correct way, without his involvement.** Choose the best route for the job (CLI, API, connector, script, browser) and carry it through yourself: branch, pull request, CI, merge, migration, deploy, check on production. He authorised Claude to merge. Never hand him a step you can do, and never pick a slower route because it is the one a person would click through. Only what truly needs him (an approval, a secret only he holds, a login) reaches him, reduced to the shortest possible step and listed at the end of the report.
- **No ZIP when you can merge.** Deliver through the repository.
- **Reports are short and businesslike**, outcome first, no tour of the steps. He writes in Hebrew, so answer in Hebrew. Product copy, marketing and code are English unless this file says otherwise.
- **Free tiers only.** Say so before a limit is near; never adopt a paid service without his yes.
- **Anything that cannot be undone waits for his yes**: deleting data, dropping objects, the Auth Site URL, domains, a new kind of public posting. Prepare everything, then ask one question.
- **Every schedule is Europe/Athens time.** Nothing personal about the owner appears in a product, in content or in marketing; public accounts are business accounts only.
- **Design is original and built for the phone first.** Each product has its own identity (never a template), mobile and desktop are two designs, touch targets are at least 44px, and the Dubel Team credit stays in the footer.
- **Say what you noticed.** If you see an upgrade, a reuse or a risk beyond the task, give it one line at the end of the report. He asked for this.

## How to work a task

The order matters more than any single step: most past failures here came from acting on a remembered picture of the code or the database instead of the current one.

1. **Read before you reason.** Start from `origin/main` as it is now, the live database object (`pg_get_functiondef`, `list_tables`) and the page on production. Several sessions change these repositories every day, so what an earlier session knew is a hypothesis to check, not a fact.
2. **Load what the task touches, not everything.** `docs/` holds the operating knowledge (`LAUNCH-RUNBOOK.md`, `INGEST.md`, `AUTH.md`, `SHARED-SUPABASE.md`, `OFFSIDES-SYNC.md`): read the one your change touches. Then the contract and the capability list if the change crosses an app boundary.
3. **Run the universe check** (next section) before you design, and write its four answers in the pull request description.
4. **Find the cause before you fix.** Reproduce or measure first, then change one thing. A guard that goes red after a data change is read, not muted: it is usually right.
5. **Prove the result.** A claim is established by the script, test or screenshot that shows it. In the report, separate what you verified from what you did not. "Should work" is not a state.
6. **Work wide in parallel.** Send independent reads and searches in one batch. Use a subagent for a sweep across many files or across the other repositories, and keep the decisions in the main thread.
7. **Finish whole.** Tests, green CI, merge, the production check, then the record: the `ecosystem/capabilities.json` row if you built something reusable, the runbook line if anything operational changed, and the status line in the Football Master project doc if a planned connection moved.
8. **Keep this file small.** It is loaded into every session, so every paragraph here is paid for on every task. Operating detail belongs in `docs/`, not here.

## The universe check

This app is one of five that share one account, one database and one map. The map is `ecosystem/contract.json` (who owns what) and `ecosystem/capabilities.json` (every engine that already exists, where it lives and who could use it). Both are the same bytes in every repository. The house skill `dubel-universe` runs this check; `ecosystem-sync` runs before anything that touches Supabase, auth, domains or `ecosystem/`.

| App | Role | Moment it owns |
|---|---|---|
| FAN LIFE · `maordubel/fanlife` | the hub: every journey starts here and comes back here | sends `before_round`, `kickoff_live`, `go_deeper`, `derby_only` |
| DUBID · `maordubel/Dubid` | companion before the round (fantasy picks) | `next_moment` to OFFSIDES, `back_to_story` to the hub |
| OFFSIDES · `maordubel/Offsides` | companion at kick-off and live (prediction arenas) | `next_moment` to DUBID, `back_to_story` to the hub |
| THE WORKER · `maordubel/The-Worker` | the premium club edition (Hapoel Tel Aviv) | `bring_depth_back` to the hub |
| FUCK YOU · `maordubel/FuckYou` | a derby-days-only side experience | `back_to_story` to the hub |

A companion is "a smart companion, never a replacement": it sends the supporter back to the hub as readily as the hub sends them out.

Answer these four in one line each, before building:

1. **Does this engine already exist?** Look it up in `ecosystem/capabilities.json`. If it does, reuse it through its owner (a shared view or RPC, a route, a handoff). Copying source between repositories is a fork, and forks are how three shirt engines came to exist.
2. **Which moment does it fire?** A link to another app is built with `createHandoff` from `ecosystem/sdk.ts` and carries its moment; the target reports `shared.handoff_outcome`. A bare URL with UTM is invisible to the funnel, and an invisible link cannot be improved.
3. **Who else gains from it?** Name the app, the marketing slot or the page that could consume what you are building. Record it as `couldUse` in the capability row. If nobody, say so.
4. **What does it cost on the free tier?** Football Master is capped at 500MB and was at 469MB on 9.11.2026: a table that grows per minute or per match ships with its retention job in the same pull request. No new paid service. Vercel Hobby is non-commercial.

Lines that do not bend, because another app breaks when they do:

- An app writes only what it owns. DUBID owns schema `game`, the ingest into `core` (until the data engine takes it over), edge functions and cron jobs named `dubid-*`, and migrations `db/NN_<name>.sql`. Everything else is read through views and RPCs in `shared` and `core`, never by reading another app's tables.
- Value crosses apps only through `shared.grant_reward`. Currencies never mix.
- Before changing a database object, read the live one. Never rebuild a live function from a file in the repository.
- No trigger on `auth.users`, no change to the Auth Site URL, sign-out stays local.
- `ecosystem/` is byte-identical in all five repositories. A change there, or to `core`, `shared` or the contract, is a five-repository change in the same round with the contract version bumped.
- One crest library (`ecosystem/crests`, sourced from OFFSIDES). One provider reader (`ecosystem/feed`). No second copy of either.

## DUBID in the universe

- **DUBID owns the hours before the lock.** The hub shows the countdown to the round lock and sends supporters here (`before_round`). After a supporter submits, the next step is not a dead end: OFFSIDES for the live match (`next_moment`) or the club's story in FAN LIFE (`back_to_story`), each through `createHandoff` in `src/lib/ecosystem.ts`.
- **Report the outcome.** A visit that arrived by handoff reports what it did (`reportOutcome`). Without it the hub cannot tell a lead that played from one that bounced.
- **DUBID holds the current season of the universe.** `core.*` (players, squads, match statistics) is what FAN LIFE needs for "this season" modes and what marketing needs for round posts. Keep it clean and resolvable: every team and player maps to `core` through `core.external_refs`, linked by provider id, never by name.
- **Never parse a provider here.** Football data is read through `ecosystem/feed` only, the same reader OFFSIDES uses. A fix to parsing is a fix in `ecosystem/feed`, shipped to every repository.
- **Guests are DUBID's own.** An anonymous player keeps playing as a guest; when a real account arrives the guest's progress merges into it (`issue_merge_token → claim_pass`). Anonymous sessions are never shared across apps.
- **Reuse before drawing.** Crests come from `ecosystem/crests`. The canonical shirt engine is FAN LIFE's `lib/kit`; `src/components/Jersey.tsx` should converge on it rather than grow. Round announcements (`scripts/announce`) and `GameweekStory` are sources for the hub's marketing machine, not a second publisher.
- **Rewards.** Value granted for something done in another app, or by DUBID for another app, goes through `shared.grant_reward` and nothing else.

## Impact check (every change)

Before a change is done, check whether it needs a matching change elsewhere, and make it in the same round:

- **Admin panel** (`src/components/Admin*.tsx`, `AdminPanel.tsx`): every new table, rule, league, format or automatic process gets its admin view and control (status, kill switch, audit). Admin is always league-aware.
- **Every league**: a change for one league is checked against all four (prefixes `gw-` `gr-` `en-` `es-`, time zones, team codes, copy in he/en/el).
- **Both modes**: DUBID 5 and DUBID 11.
- **Server and client**: a new RPC gets grants and a test in `db/tests`; a changed payload reaches every reader (`liveData.ts`, `store.ts`, the screens).
- **Copy**: every new string in `src/lib/i18n/*` in he/en/el. Tests fail otherwise.
- **Docs**: `docs/LAUNCH-RUNBOOK.md` for anything operational; `scripts/build-all-sql.mjs` regenerates `db/RUN-ALL.sql` for every migration.
- **Edge**: after changing shared edge code run `npm run bundle:edge`; CI fails on a stale bundle.

## Commands

```
npm run typecheck · npm test · npm run build
node scripts/build-all-sql.mjs      # db/RUN-ALL.sql must match db/NN_*.sql
bash scripts/test-sql.sh            # fresh Postgres, migrations twice, then the suites
npm run bundle:edge                 # edge bundles must be up to date
```

Server authority lives in Postgres (SECURITY DEFINER RPC, RLS, idempotent migrations that run twice cleanly).

## Skills that apply

`dubel-universe` and `ecosystem-sync` first. Then `football-data`, `supabase-server-authority`, `frontend-standards`, `brand-concept`, `responsive-qa`, `measure-before-you-fix`, `dubel-credit`. Check the installed skills before starting any task.

## When this file and the code disagree

The code and the live database are the truth; this file is the map. Fix the map in the same pull request, and keep the fix as short as the thing it corrects.

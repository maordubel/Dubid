-- ═══════════════════════════════════════════════════════════════════════════
-- ecosystem/sql/0001_shared_identity.sql
--
-- OWNER: the ecosystem contract (ecosystem/contract.json), not any one app.
-- This file is byte-identical in fanlife, Offsides, Dubid and The-Worker.
-- Change it in one repo => the same bytes in the other three, same round.
--
-- What it adds to schema `shared` (Supabase project afxpjfxwpdjvlmuoawda):
--   0. shared.schema_migrations  — one registry of what ran, per owner
--   1. reward_grants             — widened from 2 apps to all 4
--   2. shared.person             — one person per auth user (no auth trigger)
--   3. shared.app_membership     — which apps a person uses, first-touch source
--   4. shared.handoff            — a signed link from one app to another (leads)
--   5. RPCs                      — the only write path; every failure is a value
--   6. shared.v_handoff_funnel   — created → opened → claimed, server-side only
--
-- Rules it keeps: no trigger on auth.*; tables carry NO grants (read through
-- RPCs); every RPC is SECURITY DEFINER with an empty search_path; idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists shared;

-- 0 · registry ───────────────────────────────────────────────────────────────
create table if not exists shared.schema_migrations (
  app        text        not null check (app in ('ecosystem','fanlife','theworker','dubid','offsides')),
  version    text        not null check (char_length(version) between 1 and 40),
  name       text        not null check (char_length(name) between 1 and 120),
  applied_at timestamptz not null default now(),
  primary key (app, version)
);
alter table shared.schema_migrations enable row level security;
revoke all on shared.schema_migrations from public, anon, authenticated;

-- 1 · the reward ledger serves all four apps ─────────────────────────────────
alter table shared.reward_grants drop constraint if exists reward_grants_source_app_check;
alter table shared.reward_grants add  constraint reward_grants_source_app_check
  check (source_app in ('fanlife','theworker','dubid','offsides'));
alter table shared.reward_grants drop constraint if exists reward_grants_target_app_check;
alter table shared.reward_grants add  constraint reward_grants_target_app_check
  check (target_app in ('fanlife','theworker','dubid','offsides'));

-- 2 · person ─────────────────────────────────────────────────────────────────
create table if not exists shared.person (
  auth_id        uuid        primary key references auth.users(id) on delete cascade,
  display_name   text        check (display_name is null or char_length(btrim(display_name)) between 1 and 40),
  favourite_club text        check (favourite_club is null or favourite_club ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  locale         text        check (locale is null or locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  is_anonymous   boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table shared.person enable row level security;
revoke all on shared.person from public, anon, authenticated;

-- 3 · membership ─────────────────────────────────────────────────────────────
create table if not exists shared.app_membership (
  auth_id     uuid        not null references auth.users(id) on delete cascade,
  app         text        not null check (app in ('fanlife','theworker','dubid','offsides')),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  visits      integer     not null default 1 check (visits > 0),
  source_app  text        check (source_app is null or source_app in ('fanlife','theworker','dubid','offsides')),
  campaign    text        check (campaign is null or campaign ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  club        text        check (club is null or club ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  handoff_id  uuid,
  primary key (auth_id, app)
);
create index if not exists app_membership_app_idx on shared.app_membership (app, first_seen);
alter table shared.app_membership enable row level security;
revoke all on shared.app_membership from public, anon, authenticated;

-- 4 · handoff (a lead) ───────────────────────────────────────────────────────
create table if not exists shared.handoff (
  id          uuid        primary key default gen_random_uuid(),
  token_hash  text        not null unique,
  source_app  text        not null check (source_app in ('fanlife','theworker','dubid','offsides')),
  target_app  text        not null check (target_app in ('fanlife','theworker','dubid','offsides')),
  club        text        check (club is null or club ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  campaign    text        check (campaign is null or campaign ~ '^[a-z0-9][a-z0-9_-]{0,59}$'),
  created_by  uuid        references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  opened_at   timestamptz,
  claimed_by  uuid        references auth.users(id) on delete set null,
  claimed_at  timestamptz,
  constraint handoff_two_apps check (source_app <> target_app)
);
create index if not exists handoff_route_idx   on shared.handoff (source_app, target_app, created_at);
create index if not exists handoff_creator_idx on shared.handoff (created_by, created_at) where created_by is not null;
alter table shared.handoff enable row level security;
revoke all on shared.handoff from public, anon, authenticated;

-- 5 · RPCs ───────────────────────────────────────────────────────────────────

-- caller's auth id, and whether the session is anonymous
create or replace function shared._caller_is_anon()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;
revoke all on function shared._caller_is_anon() from public, anon, authenticated;

create or replace function shared._ensure_person(p_uid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into shared.person (auth_id, is_anonymous)
  values (p_uid, shared._caller_is_anon())
  on conflict (auth_id) do update
    set is_anonymous = excluded.is_anonymous,
        updated_at   = case when shared.person.is_anonymous is distinct from excluded.is_anonymous
                            then now() else shared.person.updated_at end;
end $$;
revoke all on function shared._ensure_person(uuid) from public, anon, authenticated;

-- person_ensure: lazily create my row (replaces any auth trigger)
create or replace function shared.person_ensure()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  perform shared._ensure_person(v_uid);
  return jsonb_build_object('ok', true);
end $$;

-- person_update: null = keep the current value
create or replace function shared.person_update(p_display_name text, p_favourite_club text, p_locale text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if p_display_name is not null and char_length(btrim(p_display_name)) not between 1 and 40 then
    return jsonb_build_object('ok', false, 'error', 'bad_display_name'); end if;
  if p_favourite_club is not null and p_favourite_club !~ '^[a-z0-9][a-z0-9-]{1,59}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_club'); end if;
  if p_locale is not null and p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$' then
    return jsonb_build_object('ok', false, 'error', 'bad_locale'); end if;
  perform shared._ensure_person(v_uid);
  update shared.person
     set display_name   = coalesce(btrim(p_display_name), display_name),
         favourite_club = coalesce(p_favourite_club, favourite_club),
         locale         = coalesce(p_locale, locale),
         updated_at     = now()
   where auth_id = v_uid;
  return jsonb_build_object('ok', true);
end $$;

-- app_touch: "I am using this app". A visit counts once per 30 minutes.
create or replace function shared.app_touch(p_app text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_first boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if p_app is null or p_app not in ('fanlife','theworker','dubid','offsides') then
    return jsonb_build_object('ok', false, 'error', 'bad_app'); end if;
  perform shared._ensure_person(v_uid);
  insert into shared.app_membership as m (auth_id, app)
  values (v_uid, p_app)
  on conflict (auth_id, app) do update
    set visits    = m.visits + case when m.last_seen < now() - interval '30 minutes' then 1 else 0 end,
        last_seen = now()
  returning (xmax = 0) into v_first;
  return jsonb_build_object('ok', true, 'first', v_first);
end $$;

-- handoff_create: a signed link to another app. Token is returned once; only
-- its sha256 is stored. Signed-in callers: 30 per hour, then a plain refusal.
create or replace function shared.handoff_create(p_source text, p_target text, p_club text, p_campaign text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_token text; v_exp timestamptz;
begin
  if p_source is null or p_source not in ('fanlife','theworker','dubid','offsides')
     or p_target is null or p_target not in ('fanlife','theworker','dubid','offsides')
     or p_source = p_target then
    return jsonb_build_object('ok', false, 'error', 'bad_route'); end if;
  if p_club is not null and p_club !~ '^[a-z0-9][a-z0-9-]{1,59}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_club'); end if;
  if p_campaign is not null and p_campaign !~ '^[a-z0-9][a-z0-9_-]{0,59}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_campaign'); end if;
  if v_uid is null and coalesce(auth.role(), '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if v_uid is not null and (select count(*) from shared.handoff
                             where created_by = v_uid and created_at > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('ok', false, 'error', 'unavailable'); end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into shared.handoff (token_hash, source_app, target_app, club, campaign, created_by)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_source, p_target, p_club, p_campaign, v_uid)
  returning expires_at into v_exp;
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp);
end $$;

-- handoff_open: the link was followed (no session needed). Funnel count only.
create or replace function shared.handoff_open(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_found boolean;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update shared.handoff set opened_at = coalesce(opened_at, now())
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and expires_at > now()
  returning true into v_found;
  if v_found then return jsonb_build_object('ok', true); end if;
  return jsonb_build_object('ok', false, 'error', 'not_found');
end $$;

-- handoff_claim: the person arrived in p_app with a session. First touch wins:
-- a membership that already has a source keeps it.
create or replace function shared.handoff_claim(p_token text, p_app text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_h shared.handoff; v_hash text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if p_app is null or p_app not in ('fanlife','theworker','dubid','offsides') then
    return jsonb_build_object('ok', false, 'error', 'bad_app'); end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  update shared.handoff
     set claimed_by = v_uid, claimed_at = now(), opened_at = coalesce(opened_at, now())
   where token_hash = v_hash and target_app = p_app and expires_at > now() and claimed_by is null
  returning * into v_h;

  if v_h.id is null then
    select * into v_h from shared.handoff where token_hash = v_hash and target_app = p_app and claimed_by = v_uid;
    if v_h.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    return jsonb_build_object('ok', true, 'again', true, 'source_app', v_h.source_app, 'club', v_h.club, 'campaign', v_h.campaign);
  end if;

  perform shared._ensure_person(v_uid);
  insert into shared.app_membership as m (auth_id, app, source_app, campaign, club, handoff_id)
  values (v_uid, p_app, v_h.source_app, v_h.campaign, v_h.club, v_h.id)
  on conflict (auth_id, app) do update
    set source_app = coalesce(m.source_app, excluded.source_app),
        campaign   = case when m.source_app is null then excluded.campaign   else m.campaign   end,
        club       = case when m.source_app is null then excluded.club       else m.club       end,
        handoff_id = case when m.source_app is null then excluded.handoff_id else m.handoff_id end,
        last_seen  = now();
  return jsonb_build_object('ok', true, 'again', false, 'source_app', v_h.source_app, 'club', v_h.club, 'campaign', v_h.campaign);
end $$;

-- me: my person row and the apps I use
create or replace function shared.me()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  return jsonb_build_object(
    'ok', true,
    'person', (select to_jsonb(p) - 'auth_id' from shared.person p where p.auth_id = v_uid),
    'apps',   coalesce((select jsonb_agg(jsonb_build_object('app', m.app, 'first_seen', m.first_seen,
                                  'last_seen', m.last_seen, 'source_app', m.source_app) order by m.first_seen)
                        from shared.app_membership m where m.auth_id = v_uid), '[]'::jsonb));
end $$;

-- grants: functions only, to exactly who needs them
revoke all on function shared.person_ensure()                          from public;
revoke all on function shared.person_update(text, text, text)          from public;
revoke all on function shared.app_touch(text)                          from public;
revoke all on function shared.handoff_create(text, text, text, text)   from public;
revoke all on function shared.handoff_open(text)                       from public;
revoke all on function shared.handoff_claim(text, text)                from public;
revoke all on function shared.me()                                     from public;
grant execute on function shared.person_ensure()                        to authenticated;
grant execute on function shared.person_update(text, text, text)        to authenticated;
grant execute on function shared.app_touch(text)                        to authenticated;
grant execute on function shared.handoff_create(text, text, text, text) to authenticated, service_role;
grant execute on function shared.handoff_open(text)                     to anon, authenticated;
grant execute on function shared.handoff_claim(text, text)              to authenticated;
grant execute on function shared.me()                                   to authenticated;

-- 6 · the hub's funnel — server-side (service role) only ─────────────────────
create or replace view shared.v_handoff_funnel as
  select source_app, target_app, club, campaign,
         date_trunc('day', created_at)::date as day,
         count(*)                            as created,
         count(opened_at)                    as opened,
         count(claimed_at)                   as claimed
    from shared.handoff
   group by 1, 2, 3, 4, 5;
revoke all on shared.v_handoff_funnel from public, anon, authenticated;

create or replace view shared.v_app_reach as
  select app, count(*) as people, count(source_app) as attributed,
         count(*) filter (where first_seen > now() - interval '30 days') as new_30d
    from shared.app_membership
   group by app;
revoke all on shared.v_app_reach from public, anon, authenticated;

insert into shared.schema_migrations (app, version, name)
values ('ecosystem', '0001', 'shared_identity')
on conflict (app, version) do nothing;

-- check line
select (select count(*) from information_schema.tables where table_schema = 'shared' and table_type = 'BASE TABLE') as shared_tables,
       (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'auth' and not t.tgisinternal and t.tgname not like 'RI_%')                                  as auth_triggers;

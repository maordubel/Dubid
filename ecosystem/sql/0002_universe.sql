-- ═══════════════════════════════════════════════════════════════════════════
-- ecosystem/sql/0002_universe.sql — FAN LIFE UNIVERSE (owner's vision, 19.10.2026)
--
-- OWNER: the ecosystem contract. Byte-identical in every repo of the universe.
--
-- The vision as data, so every app reads the same map instead of hard-coding it:
--   shared.apps         who is in the universe and what role each plays
--                       (hub · companion · club-edition · side-experience)
--   shared.app_moments  the named moments that connect two apps
--                       ("before the round", "kickoff / live", "go deeper", …)
--
-- Every app list that 0001 wrote as a CHECK becomes a foreign key to
-- shared.apps — adding an app to the universe is one row, never a migration
-- that hunts for string lists. A handoff now records its moment.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1 · the apps ───────────────────────────────────────────────────────────────
create table if not exists shared.apps (
  id       text primary key check (id ~ '^[a-z][a-z0-9]{1,30}$'),
  role     text not null check (role in ('hub','companion','club-edition','side-experience')),
  name     text not null check (char_length(name) between 1 and 40),
  url      text not null check (url ~ '^https://[a-z0-9.-]+$'),
  promise  text not null check (char_length(promise) between 1 and 120),
  status   text not null default 'live' check (status in ('live','planned','paused')),
  sort     integer not null default 0
);
alter table shared.apps enable row level security;
revoke all on shared.apps from public, anon, authenticated;

insert into shared.apps (id, role, name, url, promise, sort) values
  ('fanlife',   'hub',             'FAN LIFE',   'https://fanlife.dubelteam.com',   'The main supporter hub — history, play, identity and matchday in one universe.', 0),
  ('dubid',     'companion',       'DUBID',      'https://dubid.dubelteam.com',     'Fantasy squad building, weekly competition, pre-match mindset.',                 10),
  ('offsides',  'companion',       'OFFSIDES',   'https://offsides.dubelteam.com',  'Live prediction play, real-time excitement, kickoff moments.',                    20),
  ('theworker', 'club-edition',    'THE WORKER', 'https://theworker.dubelteam.com', 'Premium club edition — deeper club story, advanced experience.',                 30),
  ('fuckyou',   'side-experience', 'FUCK YOU',   'https://fuckyou.dubelteam.com',   'Derby-only underground side experience.',                                        40)
on conflict (id) do nothing;

-- 2 · the moments between them ───────────────────────────────────────────────
create table if not exists shared.app_moments (
  from_app text not null references shared.apps(id),
  to_app   text not null references shared.apps(id),
  moment   text not null check (moment ~ '^[a-z][a-z_]{2,30}$'),
  label    text not null check (char_length(label) between 1 and 60),
  primary key (from_app, to_app, moment),
  constraint app_moments_two_apps check (from_app <> to_app)
);
alter table shared.app_moments enable row level security;
revoke all on shared.app_moments from public, anon, authenticated;

insert into shared.app_moments (from_app, to_app, moment, label) values
  ('fanlife',   'dubid',     'before_round',      'Before the round'),
  ('dubid',     'fanlife',   'back_to_story',     'Back to club story'),
  ('dubid',     'offsides',  'next_moment',       'From the round to the live moment'),
  ('offsides',  'dubid',     'next_moment',       'From the live moment to the next round'),
  ('fanlife',   'offsides',  'kickoff_live',      'Kickoff / live moment'),
  ('offsides',  'fanlife',   'back_to_story',     'Return to archive, memories and club story'),
  ('fanlife',   'theworker', 'go_deeper',         'Go deeper'),
  ('theworker', 'fanlife',   'bring_depth_back',  'Brings depth back'),
  ('fanlife',   'fuckyou',   'derby_only',        'Derby mode only'),
  ('fuckyou',   'fanlife',   'back_to_story',     'Back to club story')
on conflict (from_app, to_app, moment) do nothing;

-- 3 · app lists become foreign keys ──────────────────────────────────────────
do $$
declare r record;
begin
  for r in select * from (values
      ('app_membership', 'app_membership_app_check'),
      ('app_membership', 'app_membership_source_app_check'),
      ('handoff',        'handoff_source_app_check'),
      ('handoff',        'handoff_target_app_check'),
      ('reward_grants',  'reward_grants_source_app_check'),
      ('reward_grants',  'reward_grants_target_app_check')) as t(tbl, con)
  loop
    execute format('alter table shared.%I drop constraint if exists %I', r.tbl, r.con);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
      ('app_membership', 'app',        'app_membership_app_fk'),
      ('app_membership', 'source_app', 'app_membership_source_app_fk'),
      ('handoff',        'source_app', 'handoff_source_app_fk'),
      ('handoff',        'target_app', 'handoff_target_app_fk'),
      ('reward_grants',  'source_app', 'reward_grants_source_app_fk'),
      ('reward_grants',  'target_app', 'reward_grants_target_app_fk')) as t(tbl, col, con)
  loop
    if not exists (select 1 from pg_constraint where conname = r.con) then
      execute format('alter table shared.%I add constraint %I foreign key (%I) references shared.apps(id)', r.tbl, r.con, r.col);
    end if;
  end loop;
end $$;

alter table shared.schema_migrations drop constraint if exists schema_migrations_app_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'schema_migrations_owner_check') then
    alter table shared.schema_migrations add constraint schema_migrations_owner_check
      check (app ~ '^[a-z][a-z0-9]{1,30}$');
  end if;
end $$;

-- 4 · a handoff knows its moment ─────────────────────────────────────────────
alter table shared.handoff add column if not exists moment text;
create index if not exists handoff_moment_idx on shared.handoff (moment, created_at) where moment is not null;

create or replace function shared._is_app(p_app text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_app is not null and exists (select 1 from shared.apps a where a.id = p_app and a.status <> 'paused')
$$;
revoke all on function shared._is_app(text) from public, anon, authenticated;

create or replace function shared.app_touch(p_app text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_first boolean;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if not shared._is_app(p_app) then return jsonb_build_object('ok', false, 'error', 'bad_app'); end if;
  perform shared._ensure_person(v_uid);
  insert into shared.app_membership as m (auth_id, app)
  values (v_uid, p_app)
  on conflict (auth_id, app) do update
    set visits    = m.visits + case when m.last_seen < now() - interval '30 minutes' then 1 else 0 end,
        last_seen = now()
  returning (xmax = 0) into v_first;
  return jsonb_build_object('ok', true, 'first', v_first);
end $$;

-- campaign "<moment>" or "<moment>-<anything>" names the moment of that route
create or replace function shared.handoff_create(p_source text, p_target text, p_club text, p_campaign text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_token text; v_exp timestamptz; v_moment text;
begin
  if not shared._is_app(p_source) or not shared._is_app(p_target) or p_source = p_target then
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

  select m.moment into v_moment from shared.app_moments m
   where m.from_app = p_source and m.to_app = p_target
     and (p_campaign = m.moment or p_campaign like m.moment || '-%')
   limit 1;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into shared.handoff (token_hash, source_app, target_app, club, campaign, moment, created_by)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), p_source, p_target, p_club, p_campaign, v_moment, v_uid)
  returning expires_at into v_exp;
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_exp, 'moment', v_moment);
end $$;

create or replace function shared.handoff_claim(p_token text, p_app text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_h shared.handoff; v_hash text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if not shared._is_app(p_app) then return jsonb_build_object('ok', false, 'error', 'bad_app'); end if;
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
    return jsonb_build_object('ok', true, 'again', true, 'source_app', v_h.source_app, 'club', v_h.club,
                              'campaign', v_h.campaign, 'moment', v_h.moment);
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
  return jsonb_build_object('ok', true, 'again', false, 'source_app', v_h.source_app, 'club', v_h.club,
                            'campaign', v_h.campaign, 'moment', v_h.moment);
end $$;

-- 5 · the universe, readable by anyone (it is the public map) ────────────────
create or replace function shared.universe()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ok', true,
    'apps',    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'role', role, 'name', name, 'url', url,
                                  'promise', promise, 'status', status) order by sort) from shared.apps), '[]'::jsonb),
    'moments', coalesce((select jsonb_agg(jsonb_build_object('from', from_app, 'to', to_app, 'moment', moment, 'label', label)
                                  order by from_app, to_app, moment) from shared.app_moments), '[]'::jsonb))
$$;
revoke all on function shared.universe() from public;
grant execute on function shared.universe() to anon, authenticated, service_role;

revoke all on function shared.app_touch(text)                        from public;
revoke all on function shared.handoff_create(text, text, text, text) from public;
revoke all on function shared.handoff_claim(text, text)              from public;
grant execute on function shared.app_touch(text)                        to authenticated;
grant execute on function shared.handoff_create(text, text, text, text) to authenticated, service_role;
grant execute on function shared.handoff_claim(text, text)              to authenticated;

-- 6 · the funnel, by moment ──────────────────────────────────────────────────
create or replace view shared.v_moment_funnel as
  select h.source_app, h.target_app, coalesce(h.moment, '(none)') as moment,
         date_trunc('day', h.created_at)::date as day,
         count(*) as created, count(h.opened_at) as opened, count(h.claimed_at) as claimed
    from shared.handoff h
   group by 1, 2, 3, 4;
revoke all on shared.v_moment_funnel from public, anon, authenticated;

insert into shared.schema_migrations (app, version, name)
values ('ecosystem', '0002', 'universe')
on conflict (app, version) do nothing;

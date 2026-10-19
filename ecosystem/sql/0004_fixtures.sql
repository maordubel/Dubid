-- ═══════════════════════════════════════════════════════════════════════════
-- ecosystem/sql/0004_fixtures.sql — the neutral fixture list every app reads
--
-- OWNER: the ecosystem contract. Byte-identical in every repo of the universe.
--
-- core.weekly_matches is DUBID's gameweek schedule (it carries a gameweek FK).
-- core.fixtures is the same matches WITHOUT any game concept: league, season,
-- teams, kickoff, status, score. Ids are shared (a fixture id IS the match id
-- every external_ref of entity_type 'match' already points at).
--
-- Writers: any game publishes into core.fixtures through core.publish_fixture()
-- (service-side, never the browser). DUBID publishes from its own trigger in
-- db/49_publish_fixtures.sql. Nothing here reads a game schema.
--
-- Every change that matters (new fixture, kickoff moved, status, score) appends
-- one row to core.fixture_signals. Games react by pulling signals with their own
-- cursor — no app ever writes into another app's schema.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists core.fixtures (
  id            uuid primary key,
  league_id     uuid references core.leagues(id),
  season_id     uuid references core.seasons(id),
  home_team_id  uuid not null references core.teams(id),
  away_team_id  uuid not null references core.teams(id),
  kickoff_at    timestamptz,
  venue         text,
  status        text not null default 'scheduled'
                check (status in ('scheduled','live','finished','postponed','cancelled')),
  home_goals    smallint,
  away_goals    smallint,
  updated_at    timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index if not exists fixtures_kickoff_idx on core.fixtures (kickoff_at);
create index if not exists fixtures_home_idx on core.fixtures (home_team_id, kickoff_at);
create index if not exists fixtures_away_idx on core.fixtures (away_team_id, kickoff_at);
alter table core.fixtures enable row level security;
revoke all on core.fixtures from public, anon, authenticated;

create table if not exists core.fixture_signals (
  id          bigserial primary key,
  fixture_id  uuid not null,
  kind        text not null check (kind in ('created','kickoff_moved','status','score','removed')),
  payload     jsonb not null default '{}'::jsonb,
  at          timestamptz not null default now()
);
create index if not exists fixture_signals_fixture_idx on core.fixture_signals (fixture_id, id);
alter table core.fixture_signals enable row level security;
revoke all on core.fixture_signals from public, anon, authenticated;

create or replace function core.fixture_signals_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'core.fixture_signals is append-only'; end $$;
create or replace trigger fixture_signals_append_only before update or delete on core.fixture_signals
  for each row execute function core.fixture_signals_append_only();

-- one signal per meaningful change
create or replace function core.fixture_signal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into core.fixture_signals (fixture_id, kind, payload)
    values (new.id, 'created', jsonb_build_object('kickoff_at', new.kickoff_at, 'status', new.status));
    return new;
  elsif tg_op = 'DELETE' then
    insert into core.fixture_signals (fixture_id, kind) values (old.id, 'removed');
    return old;
  end if;
  if new.kickoff_at is distinct from old.kickoff_at then
    insert into core.fixture_signals (fixture_id, kind, payload)
    values (new.id, 'kickoff_moved', jsonb_build_object('from', old.kickoff_at, 'to', new.kickoff_at));
  end if;
  if new.status is distinct from old.status then
    insert into core.fixture_signals (fixture_id, kind, payload)
    values (new.id, 'status', jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if (new.home_goals, new.away_goals) is distinct from (old.home_goals, old.away_goals) then
    insert into core.fixture_signals (fixture_id, kind, payload)
    values (new.id, 'score', jsonb_build_object('home', new.home_goals, 'away', new.away_goals));
  end if;
  return new;
end $$;
-- AFTER: an INSERT … ON CONFLICT that changes nothing fires nothing (a BEFORE INSERT trigger would).
create or replace trigger fixture_signal after insert or update or delete on core.fixtures
  for each row execute function core.fixture_signal();

create or replace function core.fixture_touch() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;
create or replace trigger fixture_touch before update on core.fixtures
  for each row execute function core.fixture_touch();

-- the one write path (service side): upsert or remove a fixture
create or replace function core.publish_fixture(
  p_id uuid, p_league uuid, p_season uuid, p_home uuid, p_away uuid,
  p_kickoff timestamptz, p_venue text, p_status text, p_home_goals smallint, p_away_goals smallint
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into core.fixtures (id, league_id, season_id, home_team_id, away_team_id, kickoff_at, venue, status, home_goals, away_goals)
  values (p_id, p_league, p_season, p_home, p_away, p_kickoff, p_venue,
          case when p_status in ('scheduled','live','finished','postponed','cancelled') then p_status else 'scheduled' end,
          p_home_goals, p_away_goals)
  on conflict (id) do update set
    league_id = excluded.league_id, season_id = excluded.season_id,
    home_team_id = excluded.home_team_id, away_team_id = excluded.away_team_id,
    kickoff_at = excluded.kickoff_at, venue = excluded.venue, status = excluded.status,
    home_goals = excluded.home_goals, away_goals = excluded.away_goals
  where (core.fixtures.league_id, core.fixtures.season_id, core.fixtures.home_team_id, core.fixtures.away_team_id,
         core.fixtures.kickoff_at, core.fixtures.venue, core.fixtures.status, core.fixtures.home_goals, core.fixtures.away_goals)
     is distinct from
        (excluded.league_id, excluded.season_id, excluded.home_team_id, excluded.away_team_id,
         excluded.kickoff_at, excluded.venue, excluded.status, excluded.home_goals, excluded.away_goals);
end $$;
create or replace function core.unpublish_fixture(p_id uuid) returns void
language sql security definer set search_path = '' as $$ delete from core.fixtures where id = p_id $$;
-- Supabase's default privileges grant EXECUTE to anon/authenticated on every new function: take it back by name.
revoke all on function core.publish_fixture(uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,smallint,smallint) from public, anon, authenticated;
revoke all on function core.unpublish_fixture(uuid) from public, anon, authenticated;
revoke all on function core.fixture_signal() from public, anon, authenticated;
revoke all on function core.fixture_touch() from public, anon, authenticated;
revoke all on function core.fixture_signals_append_only() from public, anon, authenticated;
revoke all on sequence core.fixture_signals_id_seq from public, anon, authenticated;
grant execute on function core.publish_fixture(uuid,uuid,uuid,uuid,uuid,timestamptz,text,text,smallint,smallint) to service_role;
grant execute on function core.unpublish_fixture(uuid) to service_role;

-- read model: public fixtures, optionally for one FAN LIFE club (by slug)
create or replace function shared.fixtures(p_club text default null, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_team uuid; v_from timestamptz := coalesce(p_from, now() - interval '2 days');
        v_to timestamptz := coalesce(p_to, now() + interval '14 days');
begin
  if v_to < v_from or v_to - v_from > interval '120 days' then
    return jsonb_build_object('ok', false, 'error', 'bad_window'); end if;
  if p_club is not null then
    if p_club !~ '^[a-z0-9][a-z0-9-]{1,59}$' then return jsonb_build_object('ok', false, 'error', 'bad_club'); end if;
    select entity_id into v_team from core.external_refs
     where provider = 'fanlife' and entity_type = 'team' and external_id = p_club;
    if v_team is null then return jsonb_build_object('ok', true, 'fixtures', '[]'::jsonb); end if;
  end if;
  return jsonb_build_object('ok', true, 'fixtures', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id, 'kickoff_at', f.kickoff_at, 'status', f.status, 'venue', f.venue,
             'home', jsonb_build_object('team_id', h.id, 'name_en', h.name_en, 'name_he', h.name_he,
                       'club', (select r.external_id from core.external_refs r where r.provider='fanlife' and r.entity_type='team' and r.entity_id=h.id limit 1)),
             'away', jsonb_build_object('team_id', a.id, 'name_en', a.name_en, 'name_he', a.name_he,
                       'club', (select r.external_id from core.external_refs r where r.provider='fanlife' and r.entity_type='team' and r.entity_id=a.id limit 1)),
             'score', case when f.home_goals is null then null else jsonb_build_array(f.home_goals, f.away_goals) end)
           order by f.kickoff_at)
      from core.fixtures f
      join core.teams h on h.id = f.home_team_id
      join core.teams a on a.id = f.away_team_id
     where f.kickoff_at between v_from and v_to
       and (v_team is null or v_team in (f.home_team_id, f.away_team_id))), '[]'::jsonb));
end $$;
revoke all on function shared.fixtures(text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function shared.fixtures(text,timestamptz,timestamptz) to anon, authenticated, service_role;

-- games pull what changed after their own cursor (service side)
create or replace function shared.fixture_signals_since(p_cursor bigint, p_limit int default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'signals', coalesce(jsonb_agg(s order by s.id), '[]'::jsonb),
                            'cursor', coalesce(max(s.id), p_cursor))
    from (select id, fixture_id, kind, payload, at from core.fixture_signals
           where id > coalesce(p_cursor, 0) order by id limit least(greatest(coalesce(p_limit, 200), 1), 1000)) s
$$;
revoke all on function shared.fixture_signals_since(bigint,int) from public, anon, authenticated;
grant execute on function shared.fixture_signals_since(bigint,int) to service_role;

insert into shared.schema_migrations (app, version, name)
values ('ecosystem', '0004', 'fixtures')
on conflict (app, version) do nothing;

-- ═══════════════════════════════════════════════════════════════════════════
-- ecosystem/sql/0005_feed_cache.sql — one shared read-through cache and one shared
-- rate budget for every free football source the universe reads.
--
-- OWNER: the ecosystem contract. Byte-identical in every repo of the universe.
--
-- DUBID (dubid-ingest) and OFFSIDES (offsides-hyper-responder, offsides-feed-link)
-- read the same free hosts (365scores today, ESPN next). Through ecosystem/feed/cache.ts
-- they now:
--   * fetch a given request ONCE per TTL and share the copy (core.feed_cache)
--   * let ONE caller refresh a key at a time (claimed_until, 8 s)
--   * stay together under ONE per-host requests/minute budget (core.feed_budget)
--   * fall back to the last good copy when the host fails or the budget is spent
-- Service side only: the browser never reads or writes these.
-- Idempotent, additive.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists core.feed_cache (
  key            text primary key,           -- canonical request (host/path?sorted-params, no time zone)
  source         text not null,              -- host
  payload        jsonb,
  fetched_at     timestamptz,
  ttl_s          int not null default 60,
  claimed_until  timestamptz,
  claimed_by     text,
  last_app       text,
  hits           bigint not null default 0,  -- reads served from the copy
  fetches        bigint not null default 0   -- real requests to the source
);
create index if not exists feed_cache_fetched_idx on core.feed_cache (fetched_at);
alter table core.feed_cache enable row level security;
revoke all on core.feed_cache from public, anon, authenticated;

create table if not exists core.feed_budget (
  host    text not null,
  minute  timestamptz not null,
  used    int not null default 0,
  denied  int not null default 0,
  primary key (host, minute)
);
alter table core.feed_budget enable row level security;
revoke all on core.feed_budget from public, anon, authenticated;

-- read: the copy, its age, and whether it is still fresh (counts a hit when fresh)
create or replace function shared.feed_cache_read(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r core.feed_cache;
begin
  select * into r from core.feed_cache where key = p_key;
  if r.key is null or r.payload is null or r.fetched_at is null then return null; end if;
  if r.fetched_at + make_interval(secs => r.ttl_s) > now() then
    update core.feed_cache set hits = hits + 1 where key = p_key;
    return jsonb_build_object('payload', r.payload, 'age_s', extract(epoch from now() - r.fetched_at)::int, 'fresh', true);
  end if;
  return jsonb_build_object('payload', r.payload, 'age_s', extract(epoch from now() - r.fetched_at)::int, 'fresh', false);
end $$;

-- begin a refresh: 'fetch' (you own it), 'wait' (someone else is fetching it now),
-- 'over_budget' (the host's shared minute budget is spent)
create or replace function shared.feed_cache_begin(p_key text, p_host text, p_per_minute int, p_app text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_key text; v_used int;
begin
  insert into core.feed_cache as c (key, source, claimed_until, claimed_by)
  values (p_key, p_host, now() + interval '8 seconds', p_app)
  on conflict (key) do update
     set claimed_until = now() + interval '8 seconds', claimed_by = excluded.claimed_by
   where c.claimed_until is null or c.claimed_until < now()
  returning key into v_key;
  if v_key is null then return 'wait'; end if;

  insert into core.feed_budget as b (host, minute, used)
  values (p_host, date_trunc('minute', now()), 1)
  on conflict (host, minute) do update set used = b.used + 1
  returning used into v_used;
  if v_used > greatest(coalesce(p_per_minute, 30), 1) then
    update core.feed_budget set used = used - 1, denied = denied + 1
     where host = p_host and minute = date_trunc('minute', now());
    update core.feed_cache set claimed_until = null where key = p_key;
    return 'over_budget';
  end if;

  if random() < 0.02 then   -- light housekeeping, no extra cron
    delete from core.feed_budget where minute < now() - interval '2 days';
    delete from core.feed_cache where coalesce(fetched_at, now() - interval '1 day') < now() - interval '3 days';
  end if;
  return 'fetch';
end $$;

-- store a fresh copy and release the claim
create or replace function shared.feed_cache_write(p_key text, p_source text, p_payload jsonb, p_ttl_s int, p_app text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into core.feed_cache as c (key, source, payload, fetched_at, ttl_s, last_app, fetches)
  values (p_key, p_source, p_payload, now(), greatest(coalesce(p_ttl_s, 60), 5), p_app, 1)
  on conflict (key) do update
     set payload = excluded.payload, fetched_at = now(), ttl_s = excluded.ttl_s,
         source = excluded.source, last_app = excluded.last_app,
         claimed_until = null, claimed_by = null, fetches = c.fetches + 1;
end $$;

-- how much the sharing saves, per host (service side; for the admin/health views)
create or replace view shared.v_feed_cache_health as
  select source as host, count(*) as keys, sum(fetches) as fetches, sum(hits) as hits,
         round(100.0 * sum(hits) / nullif(sum(hits) + sum(fetches), 0), 1) as saved_pct,
         max(fetched_at) as last_fetch,
         (select coalesce(sum(b.used), 0) from core.feed_budget b
           where b.host = c.source and b.minute > now() - interval '1 hour') as requests_last_hour,
         (select coalesce(sum(b.denied), 0) from core.feed_budget b
           where b.host = c.source and b.minute > now() - interval '1 hour') as denied_last_hour
    from core.feed_cache c group by source;
revoke all on shared.v_feed_cache_health from public, anon, authenticated;
grant select on shared.v_feed_cache_health to service_role;

revoke all on function shared.feed_cache_read(text) from public, anon, authenticated;
revoke all on function shared.feed_cache_begin(text,text,int,text) from public, anon, authenticated;
revoke all on function shared.feed_cache_write(text,text,jsonb,int,text) from public, anon, authenticated;
grant execute on function shared.feed_cache_read(text) to service_role;
grant execute on function shared.feed_cache_begin(text,text,int,text) to service_role;
grant execute on function shared.feed_cache_write(text,text,jsonb,int,text) to service_role;

insert into shared.schema_migrations (app, version, name)
values ('ecosystem', '0005', 'feed_cache')
on conflict (app, version) do nothing;

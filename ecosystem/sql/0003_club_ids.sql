-- ═══════════════════════════════════════════════════════════════════════════
-- ecosystem/sql/0003_club_ids.sql — one exact id per club, across the universe
--
-- OWNER: the ecosystem contract. Byte-identical in every repo of the universe.
--
-- FAN LIFE names a club by its slug ('hapoel-tel-aviv'); DUBID and the feed name
-- it by a core.teams uuid and provider ids. This file links the two through
-- core.external_refs (provider 'fanlife', entity_type 'team') — the same table
-- every other provider id already lives in. The link is made through the
-- club's scores365 id (a stable provider id), never through a name.
--
-- A FAN LIFE club that core does not hold yet simply has no row; it gets one
-- the day the feed ingests that club (and this file is re-run or extended).
-- ═══════════════════════════════════════════════════════════════════════════

insert into core.external_refs (provider, entity_type, external_id, entity_id)
select 'fanlife', 'team', m.slug, r.entity_id
  from (values
    ('hapoel-tel-aviv',    '567'),
    ('hapoel-petah-tikva', '571'),
    ('maccabi-haifa',      '562'),
    ('aek-athens',         '1024'),
    ('olympiacos',         '1023'),
    ('panathinaikos',      '1022'),
    ('paok',               '1029')
  ) as m(slug, s365)
  join core.external_refs r
    on r.provider = 'scores365' and r.entity_type = 'team' and r.external_id = m.s365
on conflict (provider, entity_type, external_id) do nothing;

-- club_identity: the one answer to "which team is this club, everywhere"
create or replace function shared.club_identity(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_team uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,59}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_club'); end if;
  select entity_id into v_team from core.external_refs
   where provider = 'fanlife' and entity_type = 'team' and external_id = p_slug;
  if v_team is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object(
    'ok', true,
    'club', p_slug,
    'team_id', v_team,
    'name_en', (select t.name_en from core.teams t where t.id = v_team),
    'name_he', (select t.name_he from core.teams t where t.id = v_team),
    'refs', coalesce((select jsonb_object_agg(r.provider, r.external_id)
                        from core.external_refs r
                       where r.entity_type = 'team' and r.entity_id = v_team), '{}'::jsonb));
end $$;
revoke all on function shared.club_identity(text) from public;
grant execute on function shared.club_identity(text) to anon, authenticated, service_role;

insert into shared.schema_migrations (app, version, name)
values ('ecosystem', '0003', 'club_ids')
on conflict (app, version) do nothing;

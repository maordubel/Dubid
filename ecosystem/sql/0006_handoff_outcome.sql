-- ecosystem 0006 · handoff outcome (contract v9, 27.10.2026)
-- A handoff already proves arrival (claimed_at). It never said whether the visit did what the card promised:
-- a DUBID line-up submitted, an OFFSIDES arena joined or created. The target app reports that ONCE, for the
-- newest handoff it claimed for this person in the last 24 hours. Nothing else is recorded: no score, no money,
-- no detail of the line-up — only the name of the outcome and when.
-- Idempotent: safe to run again.

alter table shared.handoff add column if not exists outcome text;
alter table shared.handoff add column if not exists outcome_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'handoff_outcome_check') then
    alter table shared.handoff add constraint handoff_outcome_check
      check (outcome is null or outcome ~ '^[a-z][a-z0-9_]{1,40}$');
  end if;
end $$;
create index if not exists handoff_outcome_idx on shared.handoff (target_app, outcome_at) where outcome is not null;

create or replace function shared.handoff_outcome(p_app text, p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  if not shared._is_app(p_app) then return jsonb_build_object('ok', false, 'error', 'bad_app'); end if;
  if p_outcome is null or p_outcome !~ '^[a-z][a-z0-9_]{1,40}$' then
    return jsonb_build_object('ok', false, 'error', 'bad_outcome'); end if;
  select h.id into v_id from shared.handoff h
   where h.claimed_by = v_uid and h.target_app = p_app and h.claimed_at > now() - interval '24 hours'
   order by h.claimed_at desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'no_handoff'); end if;
  update shared.handoff set outcome = p_outcome, outcome_at = now() where id = v_id and outcome is null;
  return jsonb_build_object('ok', true, 'recorded', found);
end $$;
revoke all on function shared.handoff_outcome(text, text) from public, anon;
grant execute on function shared.handoff_outcome(text, text) to authenticated;

-- what a visit did, per route and moment (service side; shared.v_moment_funnel stays the arrival view)
create or replace view shared.v_handoff_outcome as
  select source_app, target_app, coalesce(moment, '(none)') as moment, coalesce(outcome, '(none)') as outcome,
         (date_trunc('day', created_at))::date as day, count(*) as created, count(claimed_at) as claimed,
         count(outcome_at) as completed
    from shared.handoff group by 1, 2, 3, 4, 5;
revoke all on shared.v_handoff_outcome from public, anon, authenticated;
grant select on shared.v_handoff_outcome to service_role;

insert into shared.schema_migrations (app, version, name)
values ('ecosystem', '0006', 'handoff_outcome')
on conflict (app, version) do nothing;

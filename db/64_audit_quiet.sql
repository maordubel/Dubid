/* =====================================================================
 * 64 · The audit log records changes, not heartbeats (27.10.2026)
 *
 * The ingest rewrites every player_match_stats and weekly_matches row it
 * reads, every few minutes, with the same values (only updated_at moves).
 * game.audit_row wrote a full before/after copy of each: 512,776 rows and
 * 874 MB in ten days, 99% of them identical apart from the timestamp, and
 * the shared project's disk was about to run out.
 *
 * Now:
 *  · an UPDATE whose row is the same apart from updated_at is not logged —
 *    a change made by anyone (an admin, the SQL Editor, the ingest) still is;
 *  · the rows of that kind already written are removed (run once, idempotent);
 *  · pg_cron keeps 7 days of its own run history (cron.job_run_details grew
 *    without limit too). Every app's jobs still run; only their old receipts go.
 *
 * Idempotent: safe to run again.
 * ===================================================================== */

CREATE OR REPLACE FUNCTION game.audit_row()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = game, public
AS $$
BEGIN
  -- a row rewritten with the same values is not a change: nothing to record
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
    RETURN NEW;
  END IF;
  -- ★ כישלון ברישום לא מבטל את הפעולה. אדמין שלא יכול לפרסם
  --   תוצאות כי היומן נכשל הוא תקלה גרועה יותר משורה חסרה.
  BEGIN
    INSERT INTO game.audit_logs (actor, entity, entity_id, action, old_value, new_value)
    VALUES (
      COALESCE(auth.uid()::TEXT, 'system'),
      TG_TABLE_NAME,
      CASE
        WHEN TG_OP = 'DELETE' THEN COALESCE(to_jsonb(OLD)->>'id', to_jsonb(OLD)->>'key')
        ELSE COALESCE(to_jsonb(NEW)->>'id', to_jsonb(NEW)->>'key')
      END,
      lower(TG_OP),
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
      CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- the heartbeats already written: an update whose before and after differ only in updated_at
DELETE FROM game.audit_logs
 WHERE action = 'update'
   AND old_value IS NOT NULL AND new_value IS NOT NULL
   AND (old_value - 'updated_at') = (new_value - 'updated_at');

-- pg_cron's own receipts: seven days are enough to see what ran and what failed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ecosystem:cron-history';
    PERFORM cron.schedule('ecosystem:cron-history', '17 3 * * *',
      $q$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$q$);
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
  END IF;
END $$;

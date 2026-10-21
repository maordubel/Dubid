/**
 * PostgREST אינו מוצא יחסים בין סכימות: db { schema: 'game' } + select('seasons(...)')
 * החזיר PGRST200 ← 404 gameweek_not_found בכל ניקוד אוטומטי (20.10.2026).
 * הבדיקה הזו נועלת את המחלקה: אין embed לטבלאות core בפונקציות הקצה.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const f of [
  'supabase/functions/dubid-score-gameweek/_src/index.ts',
  'supabase/functions/dubid-ingest/_src/handler.ts',
]) {
  test(`${f}: אין embed לטבלאות core (seasons/leagues/teams/players)`, () => {
    const src = readFileSync(f, 'utf8');
    const bad = src.match(/\.select\(\s*['"`][^'"`]*\b(seasons|leagues|teams|players|squads)\s*\(/g);
    assert.equal(bad, null, String(bad));
  });
}

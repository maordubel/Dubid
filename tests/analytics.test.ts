import test from 'node:test';
import assert from 'node:assert/strict';
import { track, sanitizeParams, _resetAnalyticsForTests, ANALYTICS_EVENTS } from '../src/lib/analytics.ts';

test('D15: שדות לא מורשים נזרקים (אימייל, שם, קוד הזמנה, טקסט חופשי)', () => {
  const p = sanitizeParams('lineup_submitted', {
    league_code: 'GR_SUPER', mode: 'five', gameweek_code: 'gr-8',
    email: 'a@b.c', invite_code: 'ABCD1234', display_name: 'Maor Harel',
  } as never);
  assert.deepEqual(p, { league_code: 'GR_SUPER', mode: 'five', gameweek_code: 'gr-8' });
});

test('D15: ערכים עם רווחים/תווים חשודים נדחים; מספרים מעוגלים', () => {
  const p = sanitizeParams('lineup_ready', { mode: 'full', elapsed_seconds: 42.7 });
  assert.deepEqual(p, { mode: 'full', elapsed_seconds: 43 });
  assert.deepEqual(sanitizeParams('lineup_submit_failed', { mode: 'full', error_code: 'Bad <script> value' }), { mode: 'full' });
});

test('D15: track — no-op בלי gtag, dedupe, ולא זורק', () => {
  _resetAnalyticsForTests();
  const calls: unknown[][] = [];
  (globalThis as any).gtag = undefined;
  assert.doesNotThrow(() => track('league_selected', { league_code: 'EN_PL' }));
  (globalThis as any).gtag = (...a: unknown[]) => calls.push(a);
  track('league_selected', { league_code: 'EN_PL', source: 'gate' }, 'k1');
  track('league_selected', { league_code: 'EN_PL', source: 'gate' }, 'k1');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['event', 'league_selected', { league_code: 'EN_PL', source: 'gate' }]);
  (globalThis as any).gtag = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => track('recap_viewed', {}));
  delete (globalThis as any).gtag;
});

test('D15: כל האירועים הנדרשים במפרט קיימים; אין share_delivered', () => {
  for (const e of ['league_selected','mode_selected','lineup_started','lineup_ready','lineup_submit_attempted',
    'lineup_submitted','lineup_submit_failed','arena_joined','recap_viewed','share_started',
    'share_api_resolved','share_downloaded','next_round_submitted']) assert.ok(e in ANALYTICS_EVENTS, e);
  assert.ok(!('share_delivered' in ANALYTICS_EVENTS));
});

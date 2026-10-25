import test from 'node:test';
import assert from 'node:assert/strict';
import { leagueTimezone, setLeagueTimezone } from '../src/lib/leagueTz.ts';

test('D14: אזור זמן ליגה — ברירת מחדל ירושלים, תקין מתקבל, שגוי נדחה', () => {
  assert.equal(leagueTimezone(), 'Asia/Jerusalem');
  setLeagueTimezone('Europe/Athens');
  assert.equal(leagueTimezone(), 'Europe/Athens');
  setLeagueTimezone('Not/AZone');
  assert.equal(leagueTimezone(), 'Europe/Athens');
  setLeagueTimezone(null);
  assert.equal(leagueTimezone(), 'Europe/Athens');
  setLeagueTimezone('Asia/Jerusalem');
});

test('D14: אותו רגע מוחלט, תצוגה לפי אזור זמן הליגה (לא המכשיר)', () => {
  const iso = '2026-10-31T13:00:00Z';
  const f = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  assert.equal(f('Europe/Athens'), '15:00');
  assert.equal(f('Europe/London'), '13:00');
  assert.equal(Date.parse(iso), Date.parse('2026-10-31T15:00:00+02:00'));
});

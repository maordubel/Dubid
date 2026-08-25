/**
 * tests/nudge.test.ts — מתי מציעים להירשם.
 *
 * הכלל היחיד שנבדק כאן הוא גם הכלל היחיד שיש: **מציעים רק
 * למי שיש לו מה לאבד.** כל היתר נגזר ממנו.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNudge, type NudgeContext } from '../src/lib/nudge.ts';

const base: NudgeContext = {
  isGuest: true,
  hasSubmitted: false,
  published: false,
  gameweekNumber: 2,
  dismissedForGameweek: null,
};

test('אורח שעוד לא הגיש — לא מציעים לו כלום', () => {
  assert.equal(shouldNudge(base), false);
});

test('אורח שהגיש הרכב — עכשיו כן', () => {
  assert.equal(shouldNudge({ ...base, hasSubmitted: true }), true);
});

test('אורח אחרי פרסום תוצאות — גם בלי הגשה יש דירוג לאבד', () => {
  assert.equal(shouldNudge({ ...base, published: true }), true);
});

test('משתמש רשום — אף פעם', () => {
  assert.equal(shouldNudge({ ...base, isGuest: false, hasSubmitted: true }), false);
  assert.equal(shouldNudge({ ...base, isGuest: false, published: true }), false);
});

test('סגר את ההצעה — שקט למחזור כולו', () => {
  assert.equal(
    shouldNudge({ ...base, hasSubmitted: true, dismissedForGameweek: 2 }),
    false,
  );
});

test('★ סגירה תקפה למחזור אחד בלבד — מחזור חדש, הצעה חדשה', () => {
  // אחרת ההצעה נעלמת לנצח אחרי לחיצה אחת, וזה לא "שקט" אלא ביטול.
  assert.equal(
    shouldNudge({ ...base, hasSubmitted: true, gameweekNumber: 3, dismissedForGameweek: 2 }),
    true,
  );
});

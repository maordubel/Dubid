import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore plain ESM
import {textFor, cardHtml, wantsCard, scoreOf} from '../scripts/announce/format.mjs'

const matches = [
  {home: 'הפועל תל אביב', away: 'מכבי חיפה', kickoff: '2026-10-17T16:00:00Z', status: 'finished', homeGoals: 2, awayGoals: 1},
  {home: 'בית"ר ירושלים', away: 'הפועל ב"ש', kickoff: '2026-10-17T18:30:00Z', status: 'postponed', homeGoals: null, awayGoals: null},
]
const published = {kind: 'published', gw_code: 'gw-5', payload: {number: 5, matches, round: [{rank: 1, name: 'אלון <b>', points: 61.5}], season: [{name: 'אלון <b>', points: 140, rounds: 3}], players: 1}}

test('score only for a finished match with goals', () => {
  assert.equal(scoreOf(matches[0]), '2–1')
  assert.equal(scoreOf(matches[1]), null)
})
test('published text lists results, shows no score for an unplayed match, and escapes names', () => {
  const t = textFor(published)
  assert.match(t, /מחזור 5 – סיכום/)
  assert.match(t, /2–1/)
  assert.match(t, /ללא תוצאה/)
  assert.ok(!t.includes('אלון <b>'))
  assert.match(t, /61\.5/)
})
test('only opened and published get a picture card', () => {
  assert.deepEqual(['opened', 'reminder', 'locked', 'published', 'alert', 'stuck'].filter(wantsCard), ['opened', 'published'])
})
test('card is RTL, 1080x1350 and carries the tables', () => {
  const h = cardHtml(published)
  assert.match(h, /dir="rtl"/); assert.match(h, /width:1080px;height:1350px/)
  assert.match(h, /טבלת המחזור/); assert.match(h, /הטבלה המצטברת/)
})
test('opened text states the lock time and every fixture', () => {
  const t = textFor({kind: 'opened', gw_code: 'gw-5', payload: {number: 5, lockAt: '2026-10-17T15:00:00Z', matches}})
  assert.match(t, /מחזור 5 נפתח/); assert.match(t, /מכבי חיפה/); assert.match(t, /ההגשות נסגרות/)
})

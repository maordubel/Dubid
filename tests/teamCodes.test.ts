import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeCandidates, uniqueShorts } from '../src/lib/teamCodes.ts';

const IL = ['Beitar Jerusalem', 'Bnei Sakhnin', 'Hapoel Beer Sheva', 'Hapoel Haifa', 'Hapoel Jerusalem',
  'Hapoel Petah Tikva', 'Hapoel Ramat Gan', 'Hapoel Tel Aviv', 'Ironi Kiryat Shmona', 'Ironi Tiberias',
  'Maccabi Haifa', 'Maccabi Netanya', 'Maccabi Petah Tikva', 'Maccabi Tel Aviv'];

test('U02: Israeli clubs get distinct 3-letter codes in English', () => {
  const rows = IL.map((n) => ({ short: codeCandidates(n)[0], nameHe: n, nameEn: n }));
  uniqueShorts(rows, 'en');
  const codes = rows.map((r) => r.short);
  assert.equal(new Set(codes).size, codes.length, codes.join(','));
  assert.equal(rows.find((r) => r.nameEn === 'Hapoel Tel Aviv')!.short, 'HTA');
  assert.equal(rows.find((r) => r.nameEn === 'Maccabi Haifa')!.short, 'MHA');
  assert.ok(codes.every((c) => /^[A-Z]{3}$/.test(c)));
});

test('U02: collisions are resolved, Hebrew untouched', () => {
  const rows = [{ short: 'HHA', nameHe: 'a', nameEn: 'Hapoel Haifa' }, { short: 'HHA', nameHe: 'b', nameEn: 'Hapoel Hadera' }];
  uniqueShorts(rows, 'en');
  assert.notEqual(rows[0].short, rows[1].short);
  const he = [{ short: 'x', nameHe: 'x' }, { short: 'x', nameHe: 'y' }];
  uniqueShorts(he, 'he');
  assert.equal(he[1].short, 'x');
});

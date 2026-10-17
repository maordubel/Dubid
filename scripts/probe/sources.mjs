import { writeFileSync } from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = async (u) => (await fetch(u, { headers: { 'user-agent': UA } })).json();
const out = [];
let url = 'https://webws.365scores.com/web/games/results/?appTypeId=5&langId=2&timezoneName=Asia/Jerusalem&competitions=42';
for (let i = 0; i < 5; i++) {
  const j = await get(url);
  out.push({ url, paging: j.paging, rounds: (j.games || []).map((g) => [g.id, g.roundNum, g.statusGroup, g.homeCompetitor?.name, g.awayCompetitor?.name]) });
  if (!j.paging?.previousPage) break;
  url = 'https://webws.365scores.com' + j.paging.previousPage;
}
const fx = await get('https://webws.365scores.com/web/games/fixtures/?appTypeId=5&langId=2&timezoneName=Asia/Jerusalem&competitions=42');
out.push({ fixtures: (fx.games || []).map((g) => [g.id, g.roundNum, g.statusGroup, g.startTime]), paging: fx.paging });
writeFileSync('probe-paging.json', JSON.stringify(out, null, 1));

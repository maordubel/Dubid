// One-off network probe: which football data sources answer from this runner, and with what shape.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
async function probe(name, url, headers = {}, peek = 300) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*', ...headers }, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    console.log(`\n### ${name}\n${r.status} ${r.headers.get('content-type')} len=${t.length}\n${url}\n${t.slice(0, peek).replace(/\s+/g, ' ')}`);
    return { status: r.status, text: t };
  } catch (e) { console.log(`\n### ${name}\nERR ${e}\n${url}`); return null; }
}
const b365 = 'https://webws.365scores.com/web';
const q = 'appTypeId=5&langId=1&timezoneName=Asia/Jerusalem';
for (const host of ['api.sofascore.com', 'api.sofascore.app', 'www.sofascore.com']) {
  await probe(`sofascore ${host} round`, `https://${host}/api/v1/unique-tournament/328/season/96740/events/round/5`, {}, 200);
}
const res = await probe('365 results comp=42', `${b365}/games/results/?${q}&competitions=42`, {}, 200);
let gid;
try {
  const j = JSON.parse(res.text);
  const g = (j.games || []).find((x) => x.statusGroup === 4);
  console.log('365 games', (j.games || []).length, 'sample', JSON.stringify(g && { id: g.id, round: g.roundNum, h: g.homeCompetitor?.name, a: g.awayCompetitor?.name }));
  gid = g?.id;
} catch (e) { console.log('parse fail', e.message); }
if (gid) {
  const d = await probe('365 game detail', `${b365}/game/?${q}&gameId=${gid}`, {}, 100);
  try {
    const j = JSON.parse(d.text); const game = j.game;
    console.log('game keys', Object.keys(game || {}).join(','));
    console.log('members?', Object.keys(game?.members || {}), 'chartEvents', !!game?.chartEvents, 'events', (game?.events || []).length);
    const c = game?.homeCompetitor; console.log('homeComp keys', Object.keys(c || {}).join(','));
    console.log('lineups', JSON.stringify(c?.lineups || null).slice(0, 1500));
    console.log('events sample', JSON.stringify((game?.events || []).slice(0, 3)));
    console.log('members sample', JSON.stringify((game?.members || []).slice(0, 2)).slice(0, 1200));
    console.log('stats sample', JSON.stringify((game?.statistics || []).slice(0, 2)).slice(0, 400));
  } catch (e) { console.log('detail parse fail', e.message); }
  await probe('365 game stats-tab', `${b365}/game/stats/?${q}&games=${gid}`, {}, 600);
}
await probe('fotmob league', 'https://www.fotmob.com/api/leagues?id=127&ccode3=ISR', {}, 200);
await probe('espn scoreboard', 'https://site.api.espn.com/apis/site/v2/sports/soccer/isr.1/scoreboard', {}, 200);
await probe('thesportsdb league', 'https://www.thesportsdb.com/api/v1/json/3/eventsround.php?id=4644&r=5&s=2026-2027', {}, 200);
await probe('one.co.il', 'https://www.one.co.il/Soccer/', {}, 120);
await probe('sport5', 'https://www.sport5.co.il/', {}, 120);
await probe('football.org.il', 'https://www.football.org.il/', {}, 120);
// run

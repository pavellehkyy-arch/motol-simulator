// E2E online sprint 1v1: 2 okna Chromia, skutečné WebRTC (loopback), atrapa Supabase. Spuštění: node tests/e2e-sprint.js (WS=1 = přes server)
// Vykreslování je vypnuté (softwarový GL by zdržoval smyčku o sekundy); RENDER=1 ho zapne.
// Spuštění: node tests/e2e-race.js   (THREE_PATH=... přepíše cestu k three.min.js)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const THREE = process.env.THREE_PATH || '/tmp/claude-0/-home-user/0c140e3c-98ee-5cfe-87c0-d751f6694415/scratchpad/three/package/build/three.min.js';
const UIDS = ['a', 'b', 'c'].map((d) => d.repeat(8) + '-' + d.repeat(4) + '-' + d.repeat(4) + '-' + d.repeat(4) + '-' + d.repeat(12));
const NICK = ['Alfa', 'Beta', 'Gama'];
const res = []; let fails = 0;
const ok = (n, c, info = '') => { res.push((c ? 'OK   ' : 'FAIL ') + n + (info ? ' ' + info : '')); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(100); } }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => b64({ alg: 'none' }) + '.' + b64({ sub, exp: 4102444800, role: 'authenticated' }) + '.x';

// ---- statický server
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = http.createServer((q, s) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});

// ---- atrapa Realtime (Phoenix): presence + broadcast mezi všemi sockety na topicu
const subs = [];
function rtHandle(page, ws) {
  const me = { ws, topic: null, key: null, meta: null };
  const out = (s, m) => { try { s.ws.send(JSON.stringify(m)); } catch (e) {} };
  const on = (topic) => subs.filter((s) => s.topic === topic);
  const leave = () => { const i = subs.indexOf(me); if (i < 0) return; subs.splice(i, 1);
    if (me.meta) on(me.topic).forEach((s) => out(s, { topic: me.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [me.key]: { metas: [me.meta] } } } })); };
  ws.onMessage((raw) => {
    const m = JSON.parse(raw);
    if (m.topic === 'phoenix') return out(me, { topic: 'phoenix', event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } });
    if (m.event === 'phx_join') {
      me.topic = m.topic; me.key = m.payload.config.presence.key; subs.push(me);
      out(me, { topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } });
      const st = {}; on(m.topic).forEach((s) => { if (s.meta) st[s.key] = { metas: [s.meta] }; });
      out(me, { topic: m.topic, event: 'presence_state', payload: st });
    } else if (m.event === 'presence' && m.payload.event === 'track') {
      const old = me.meta; me.meta = Object.assign({}, m.payload.payload, { phx_ref: Math.random().toString(36).slice(2) });
      const d = { joins: { [me.key]: { metas: [me.meta] } }, leaves: old ? { [me.key]: { metas: [old] } } : {} };
      on(me.topic).forEach((s) => out(s, { topic: me.topic, event: 'presence_diff', payload: d }));
    } else if (m.event === 'broadcast') on(m.topic).forEach((s) => { if (s !== me) out(s, { topic: m.topic, event: 'broadcast', payload: m.payload }); });
    else if (m.event === 'phx_leave') leave();
  });
  ws.onClose(leave);
}

async function mkPlayer(browser, i, errs) {   // každé okno vlastní proces Chromia (jinak sdílí renderer a hladoví)
  const ctx = await browser.newContext({ viewport: { width: 320, height: 160 } });
  const page = await ctx.newPage();
  if (process.env.DBG) page.on('request', (q) => console.log('REQ', q.url().slice(0, 100)));
  page.on('pageerror', (e) => errs[i].push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errs[i].push('console: ' + m.text()); });
  const sess = { access: jwt(UIDS[i]), refresh: 'r' + i, exp: 4102444800, email: NICK[i] + '@test.cz' };
  await page.addInitScript((s) => { localStorage.setItem('motol_session', JSON.stringify(s)); }, sess);
  // WS=1: přímé WebRTC se nikdy nespojí (zahodí ICE kandidáty) → závod musí jet přes zálohu Supabase Realtime
  if (process.env.WS) await page.addInitScript(() => { const P = window.RTCPeerConnection; window.RTCPeerConnection = function (c) { const pc = new P(c); Object.defineProperty(pc, 'onicecandidate', { set() {}, get() { return null; } }); return pc; }; });
  if (!process.env.RENDER) await page.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => setTimeout(() => raf(f), 60); });   // ~15 fps, ať smyčky nehladoví
  await page.route(/three\.min\.js/, (r) => r.fulfill({ body: fs.readFileSync(THREE, 'utf8') + (process.env.RENDER ? '' : '\n;(function(){var W=THREE.WebGLRenderer;THREE.WebGLRenderer=function(o){W.call(this,o);this.render=function(){};};THREE.WebGLRenderer.prototype=W.prototype;})();'), contentType: 'application/javascript' }));
  await page.route(/supabase\.co\//, (r) => {
    const u = r.request().url(), j = (d, st = 200) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(d) });
    if (/\/rest\/v1\/profiles/.test(u)) return j([{ nickname: NICK[i], nickname_status: 'approved', money: 0, imported: true, coach: null }]);
    if (/\/rest\/v1\/purchases/.test(u)) return j([]);
    if (/get_public_names/.test(u)) return j(UIDS.map((id, k) => ({ id, nickname: NICK[k], badge: null })));
    if (/turn-credentials/.test(u)) return j({ error: 'x' }, 500);   // -> záložní STUN
    if (/\/auth\//.test(u)) return j({ error: 'x' }, 400);
    return j({});
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => { if (/supabase\.co|three\.min/.test(r.request().url())) return r.fallback(); return r.abort(); });
  await page.routeWebSocket(/realtime\/v1\/websocket/, (ws) => rtHandle(page, ws));
  await page.goto('http://127.0.0.1:' + srv.address().port + '/index.html#debug', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__G && window.RaceNet && window.Online && window.NETR, null, { timeout: 60000 });
  await page.evaluate(() => { window.__lag = 0; let t = performance.now(); setInterval(() => { const n = performance.now(); window.__lag = Math.max(window.__lag, n - t - 100); t = n; }, 100); });
  return { ctx, page };
}

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const LA = { args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-features=WebRtcHideLocalIpsWithMdns', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] };
  const browsers = [];
  const errs = [[], []]; let P = [];
  try {
    for (let i = 0; i < 2; i++) { const b = await chromium.launch(LA); browsers.push(b); P.push(await mkPlayer(b, i, errs)); }
    const ev = (i, f, a) => P[i].page.evaluate(f, a);
    const both = (f) => Promise.all([0, 1].map((i) => ev(i, f)));
    for (let i = 0; i < 2; i++) {
      await ev(i, () => document.getElementById('btnNetSprint').click());
      await until(() => ev(i, () => RaceNet.status === 'lobby'), 20000, 'lobby ' + i);
      await sleep(300);
    }
    ok('čekárna sprintu: titulek', (await ev(1, () => document.getElementById('netTitle').textContent)).includes('Sprint'));
    await until(() => both(() => RaceNet.members().length === 2 && RaceNet.members().filter((k) => k !== RaceNet.me).every((k) => RaceNet.linkState(k) === 'open')).then((a) => a.every(Boolean)), 60000, 'linky open');
    ok('oba v jedné místnosti, spojení open', true, JSON.stringify(await both(() => RaceNet.mode + ':' + RaceNet.room)));
    await ev(0, () => document.getElementById('netGoBtn').click());
    await until(() => both(() => NETR.on).then((a) => a.every(Boolean)), 15000, 'NETR.on');
    const st = await both(() => { const S = __net.sp(); return { mode: __G().mode, opp: S.opp.name, rem: S.opp.remote, dp: S.drawP, vis: __R.filter((r) => r.model.g.visible).length }; });
    ok('start: mode sprint u obou', st.every((s) => s.mode === 'sprint'), JSON.stringify(st));
    ok('soupeř = druhý člověk (remote, jméno)', st[0].opp === 'Beta' && st[1].opp === 'Alfa' && st.every((s) => s.rem), JSON.stringify(st));
    ok('los: pozice 1 a 2 se doplňují', st[0].dp + st[1].dp === 3);
    ok('na dráze jen 2 jezdci', st.every((s) => s.vis === 2));
    if (process.env.DBG2) for (let t = 0; t < 12; t++) { console.log(JSON.stringify(await both(() => { const S = __net.sp(), O = S.opp, k = O.netKey, Pp = RaceNet.peers[k]; return { ph: __G().phase, ct: +(window.__ct ? 0 : 0), st: O.netStale, c: O.crashed, buf: Pp && Pp.buf ? Pp.buf.length : -1, dec: S.cur && S.cur.decided, ps: +__pl.s.toFixed(1), os: +O.s.toFixed(1) }; }))); await sleep(1500); }
    await until(() => both(() => __G().phase === 'race').then((a) => a.every(Boolean)), 30000, 'race');
    // jízda: oba naplno; pozice 1 o chlup slabší, ať je výsledek jasný
    await both(() => { __eff(__net.sp().drawP === 1 ? 0.97 : 1); });
    await sleep(6000);
    const pos = await Promise.all([ev(0, () => ({ me: __pl.s, opp: __net.sp().opp.s })), ev(1, () => ({ me: __pl.s, opp: __net.sp().opp.s }))]);
    ok('hák: B u A je tam, kde B opravdu je (rozdíl < 3 m)', Math.abs(pos[0].opp - pos[1].me) < 3, 'A vidí ' + pos[0].opp.toFixed(1) + ', B má ' + pos[1].me.toFixed(1));
    ok('hák: A u B je tam, kde A opravdu je (rozdíl < 3 m)', Math.abs(pos[1].opp - pos[0].me) < 3, 'B vidí ' + pos[1].opp.toFixed(1) + ', A má ' + pos[0].me.toFixed(1));
    const d1 = await until(async () => { const a = await both(() => { const S = __net.sp(); return S.cur && S.cur.decided ? { n: S.cur.n, sc: S.score.join(':') } : null; }); return a.every(Boolean) ? a : false; }, 240000, 'rozhodnutí 1. rozjížďky');
    ok('1. rozjížďka rozhodnutá u obou, stejný stav (zrcadlově)', d1[0].sc === d1[1].sc.split(':').reverse().join(':'), JSON.stringify(d1));
    const h2 = await until(async () => { const a = await both(() => { const S = __net.sp(); return S.heat === 2 && __G().phase === 'race' ? { dp: S.drawP } : null; }); return a.every(Boolean) ? a : false; }, 30000, '2. rozjížďka');
    ok('2. rozjížďka začala u obou, pozice prohozené', h2[0].dp + h2[1].dp === 3 && h2[0].dp !== st[0].dp, JSON.stringify(h2));
    // B spadne → zápas pro A
    await sleep(3000);
    await ev(1, () => __WALK().crash());
    const end = await until(async () => { const a = await both(() => { const S = __net.sp(); return S.over ? { w: S.winner === __pl ? 'me' : 'opp', sc: S.score.join(':'), ph: __G().phase } : null; }); return a.every(Boolean) ? a : false; }, 30000, 'konec zápasu');
    ok('pád B: zápas vyhrál A u obou', end[0].w === 'me' && end[1].w === 'opp', JSON.stringify(end));
    await until(() => both(() => __G().phase === 'ceremony').then((a) => a.every(Boolean)), 20000, 'vyhlášení').catch(() => {});
    const cer = await both(() => __G().phase);
    ok('vyhlášení u obou (i u spadlého)', cer.every((p) => p === 'ceremony'), JSON.stringify(cer));
    const ord = await both(() => __net.order());
    ok('netOrder: vítěz A první u obou', ord.every((o) => o[0] && o[0][0] === 'a' && o[1] && o[1][0] === 'b'), JSON.stringify(ord));
    for (let i = 0; i < 2; i++) ok('bez chyb v konzoli, okno ' + NICK[i], errs[i].length === 0, errs[i].slice(0, 3).join(' | '));
  } catch (e) {
    ok('scénář doběhl', false, e.message);
    for (let i = 0; i < P.length; i++) { try { res.push('  stav ' + i + ': ' + JSON.stringify(await P[i].page.evaluate(() => { const S = __net.sp(); return { st: RaceNet.status, host: RaceNet.isHost(), ph: __G().phase, rt: +__G().raceTime.toFixed(1), ps: +__pl.s.toFixed(1), fin: __pl.finished, S: S && { heat: S.heat, sc: S.score, dec: S.cur && S.cur.decided, over: S.over, opp: S.opp && +S.opp.s.toFixed(1) } }; }))); } catch (x) {} }
    for (let i = 0; i < 2; i++) if (errs[i].length) res.push('  chyby okna ' + i + ': ' + errs[i].slice(0, 4).join(' | '));
  } finally {
    console.log(res.join('\n')); for (const b of browsers) await b.close().catch(() => {}); srv.close(); process.exit(fails ? 1 : 0);
  }
})();

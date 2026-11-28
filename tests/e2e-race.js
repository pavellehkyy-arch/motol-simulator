// E2E online závod (scratch): 3 okna Chromia, skutečné WebRTC (loopback), atrapa Supabase (REST + Realtime WS).
// Vykreslování je vypnuté (softwarový GL by zdržoval smyčku o sekundy); RENDER=1 ho zapne.
// Spuštění: node tests/e2e-race.js   (THREE_PATH=... přepíše cestu k three.min.js)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const THREE = process.env.THREE_PATH || '/tmp/claude-0/-home-user-motol-simulator/c53007ac-07e1-50e4-baf1-e7c7a40f5ad0/scratchpad/three/package/build/three.min.js';
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
  const errs = [[], [], []]; let P = [];
  try {
    for (let i = 0; i < 3; i++) { const b = await chromium.launch(LA); browsers.push(b); P.push(await mkPlayer(b, i, errs)); }
    const ev = (i, f, a) => P[i].page.evaluate(f, a);
    // host = nejstarší presence -> připojuj postupně
    // A jede v časovkářské helmě na discích jako Albi: ostatní ho tak musí vidět
    await ev(0, () => { const f = RaceNet.setLook; RaceNet.setLook = (o) => f(Object.assign({}, o, { hk: 'tt', wh: ['disc', 'disc'], al: 1, bk: 2 })); });
    for (let i = 0; i < 3; i++) {
      await ev(i, () => document.getElementById('btnNetRace').click());
      await until(() => ev(i, () => RaceNet.status === 'lobby'), 20000, 'lobby ' + i);
      await sleep(300);
    }
    ok('lobby: všichni 3 ve stavu lobby', true);
    await until(() => Promise.all([0, 1, 2].map((i) => ev(i, () => RaceNet.members().length === 3 && RaceNet.members().filter((k) => k !== RaceNet.me).every((k) => RaceNet.linkState(k) === 'open')))).then((a) => a.every(Boolean)), 60000, 'WebRTC linky open');
    ok(process.env.WS ? 'záloha: všechny linky open přes server' : 'WebRTC: všechny linky open (loopback)', !process.env.WS || (await ev(0, () => RaceNet.members().filter((k) => k !== RaceNet.me).every((k) => RaceNet.viaServer(k)))));
    const hosts = await Promise.all([0, 1, 2].map((i) => ev(i, () => RaceNet.isHost())));
    if (!hosts[0] || hosts.filter(Boolean).length !== 1) res.push('  hostK/order: ' + JSON.stringify(await Promise.all([0, 1, 2].map((i) => ev(i, () => ({ me: RaceNet.me.slice(0, 2), h: String(RaceNet.host).slice(0, 2), o: RaceNet.members().map((k) => k.slice(0, 2)), ep: RaceNet.epoch }))))));
    ok('právě jeden hostitel (první připojený)', hosts.filter(Boolean).length === 1 && hosts[0], JSON.stringify(hosts));
    const names = await ev(1, () => RaceNet.members().filter((k) => k !== RaceNet.me).map((k) => (RaceNet.name(k) || {}).nick));
    ok('jména v lobby z get_public_names', names.every(Boolean) && !names.includes('Hráč'), JSON.stringify(names));
    if (process.env.DBG) { await Promise.all([0, 1, 2].map((i) => ev(i, () => { window.__lag = 0; }))); await sleep(5000); console.log('idle lag', await Promise.all([0, 1, 2].map((i) => ev(i, () => Math.round(window.__lag)))), await ev(0, () => ({ fps: window.__fps, ph: __G().phase }))); }
    const lag0 = await Promise.all([0, 1, 2].map((i) => ev(i, () => { const l = Math.round(window.__lag); window.__lag = 0; return l; })));
    res.push('  info: max zpoždění smyčky do startu (ms) ' + JSON.stringify(lag0));
    await ev(0, () => document.getElementById('netGoBtn').click());
    await until(() => Promise.all([0, 1, 2].map((i) => ev(i, () => NETR.on))).then((a) => a.every(Boolean)), 15000, 'NETR.on');
    ok('start: NETR.on u všech', true);
    const st = await Promise.all([0, 1, 2].map((i) => ev(i, () => ({ mode: __G().mode, host: NETR.host, keys: NETR.keys.length, me: RaceNet.me,
      remotes: Object.keys(NETR.map).filter((k) => k !== RaceNet.me && k.indexOf('b:') !== 0).map((k) => ({ k, rem: NETR.map[k].remote, nm: NETR.map[k].name })) }))));
    ok('mode scratch u všech', st.every((s) => s.mode === 'scratch'), JSON.stringify(st.map((s) => s.mode)));
    ok('NETR.map: každý vidí 2 cizí hráče jako remote se jménem', st.every((s) => s.remotes.length === 2 && s.remotes.every((r) => r.rem && NICK.includes(r.nm))), JSON.stringify(st.map((s) => s.remotes.map((r) => r.nm))));
    await until(() => ev(1, () => NETR.tags && Object.keys(NETR.tags).length === 2), 5000, 'jmenovky').catch(() => {});
    const lk = await ev(1, () => { const k = Object.keys(NETR.map).find((k) => k.startsWith('aaaaaaaa')), R = NETR.map[k], M = R.model, T = NETR.tags && NETR.tags[k];
      return { helm: M.helmKind, gear: M.gear, albi: !!M.ph, swapped: !!R.model0, vis: M.g.visible, oldVis: R.model0 && R.model0.g.visible, tag: T && T.visible, nick: T && T.nick }; });
    ok('vzhled A u B: helma, disky, Albi, vlastní model místo bota', lk.helm === 'tt' && lk.gear && lk.gear.join() === 'disc,disc' && lk.albi && lk.swapped && lk.vis && !lk.oldVis, JSON.stringify(lk));
    ok('jmenovka nad A u B', lk.tag && lk.nick === 'Alfa', JSON.stringify(lk));
    const sameRiders = await Promise.all([0, 1, 2].map((i) => ev(i, () => NETR.keys.map((k) => NETR.map[k] === __pl ? 'me' : NETR.map[k].name).join())));
    ok('mapování cizích hráčů na jezdce různá, žádný hráč není dvakrát', st.every((s, i) => new Set(s.remotes.map((r) => r.nm)).size === 2));
    await sleep(4000);
    const h2 = await Promise.all([0, 1, 2].map((i) => ev(i, () => ({ h: RaceNet.isHost(), hk: String(RaceNet.host).slice(0, 2), ep: RaceNet.epoch }))));
    ok('hostitel stabilní během odpočtu (jeden, shodný u všech)', h2.filter((x) => x.h).length === 1 && new Set(h2.map((x) => x.hk)).size === 1, JSON.stringify(h2) + ' lag ms ' + JSON.stringify(await Promise.all([0, 1, 2].map((i) => ev(i, () => Math.round(window.__lag))))));
    if (h2.filter((x) => x.h).length !== 1) {   // split-brain: zkus, jestli se sám srovná (dead[] v race-net.js se nuluje jen při odchodu z presence)
      await sleep(10000);
      const h3 = await Promise.all([0, 1, 2].map((i) => ev(i, () => ({ h: RaceNet.isHost(), hk: String(RaceNet.host).slice(0, 2), ep: RaceNet.epoch }))));
      ok('split-brain se po 10 s sám srovná', h3.filter((x) => x.h).length === 1, JSON.stringify(h3));
    }
    // výstřel
    await until(() => Promise.all([0, 1, 2].map((i) => ev(i, () => NETR.goAt > 0))).then((a) => a.every(Boolean)), 120000, 'goAt');
    ok('výstřel: NETR.goAt > 0 u všech', true);
    const go = await Promise.all([0, 1, 2].map((i) => ev(i, () => NETR.goAt)));
    ok('goAt stejné (hodiny hostitele) u všech', Math.max(...go) - Math.min(...go) < 1, JSON.stringify(go.map((g) => g - go[0])));
    // pohyb: ať hráč 1 jede
    await ev(1, () => { __eff(0.9); });
    await sleep(5000);
    const sA = await ev(0, () => { const R = NETR.map[Object.keys(NETR.map).find((k) => k.startsWith('bbbbbbbb'))]; return { s: R.s, v: R.v, ps: __G().raceTime }; });
    const sB = await ev(1, () => ({ s: __pl.s, v: __pl.v }));
    ok('poloha hráče B u A se mění a odpovídá (rozdíl < 6 m)', Math.abs(sA.s - sB.s) < 6 && sB.v > 1, 'A vidí s=' + sA.s.toFixed(1) + ' B má s=' + sB.s.toFixed(1) + ' v=' + sB.v.toFixed(1));
    const pre = await ev(2, () => { const R = NETR.map[Object.keys(NETR.map).find((k) => k.startsWith('bbbbbbbb'))]; return R.s; });
    await sleep(2000);
    const post = await ev(2, () => { const R = NETR.map[Object.keys(NETR.map).find((k) => k.startsWith('bbbbbbbb'))]; return R.s; });
    ok('C vidí B, jak ujíždí (s roste)', post > pre, pre.toFixed(1) + ' -> ' + post.toFixed(1));
    ok('boti u nehostitele jsou remote, u hostitele ne', await ev(1, () => __R.filter((R) => !R.player && !R.partner).filter((R) => R.netKey && R.netKey.startsWith('b:') && !R.netOff).every((R) => R.remote)) && await ev(0, () => __R.filter((R) => !R.player && !R.partner).filter((R) => R.netKey && R.netKey.startsWith('b:') && !R.netOff).every((R) => !R.remote)));
    const sn = await ev(1, () => __R.filter((R) => !R.player && !R.partner).filter((R) => R.netKey && R.netKey.startsWith('b:') && R.netT).length);
    ok('snapshoty botů dorazily k nehostiteli', sn > 0, 'boti se snapshotem: ' + sn);
    // převzetí hostitele
    await P[0].ctx.close();
    const nh = await until(async () => { const a = await Promise.all([1, 2].map((i) => ev(i, () => ({ h: RaceNet.isHost(), n: NETR.host })))); return a.some((x) => x.h) ? a : false; }, 30000, 'převzetí');
    ok('převzetí: nový hostitel RaceNet.isHost() i NETR.host', nh.filter((x) => x.h && x.n).length === 1 && nh.every((x) => x.h === x.n), JSON.stringify(nh));
    const hi = nh[0].h ? 1 : 2, oi = hi === 1 ? 2 : 1;
    await sleep(500);
    ok('nový hostitel: boti už nejsou remote', await ev(hi, () => __R.filter((R) => !R.player && !R.partner).filter((R) => R.netKey && R.netKey.startsWith('b:') && !R.netOff).every((R) => !R.remote)));
    const mv = await ev(hi, () => { const b = __R.filter((R) => !R.player && !R.partner).find((R) => R.netKey && R.netKey.startsWith('b:') && !R.crashed); const s0 = b.s; return new Promise((r) => setTimeout(() => r([s0, b.s]), 2000)); });
    ok('boti u nového hostitele jedou dál (s roste)', mv[1] > mv[0], mv.map((x) => x.toFixed(1)).join(' -> '));
    const gone = await ev(oi, () => { const k = Object.keys(NETR.map).find((k) => k.startsWith('aaaaaaaa')); return k ? { c: NETR.map[k].crashed, vis: NETR.map[k].model.g.visible } : null; });
    await sleep(6000);
    const gone2 = await ev(oi, () => { const k = Object.keys(NETR.map).find((k) => k.startsWith('aaaaaaaa')); return k ? { c: NETR.map[k].crashed, vis: NETR.map[k].model.g.visible } : null; });
    ok('odpadlý hráč A zmizí u zbylých z dráhy (skrytý, mimo pořadí) do ~6 s', gone2 && !gone2.vis, JSON.stringify([gone, gone2]));
    // pád: C spadne, u B zůstane ležet na dráze (nezmizí)
    await ev(2, () => __WALK().crash());
    await sleep(3000);
    const cr = await ev(1, () => { const k = Object.keys(NETR.map).find((k) => k.startsWith('cccccccc')), R = NETR.map[k]; return R ? { c: R.crashed, vis: R.model.g.visible, crash: !!R.crash, slip: R.crash && R.crash.slip, tag: NETR.tags[k] && NETR.tags[k].visible } : null; });
    ok('spadlý hráč C u B leží na dráze (pád, viditelný, se jmenovkou)', cr && cr.c && cr.vis && cr.crash && cr.slip && cr.tag, JSON.stringify(cr));
    // dojezd: oba zbylí do cíle, stejné pořadí
    for (const i of [1, 2]) await ev(i, () => { __eff(1); });
    const fin = await until(async () => { const a = await Promise.all([1, 2].map((i) => ev(i, () => ({ f: __pl.finished, c: __pl.crashed && __G().phase === 'ceremony', o: NETR.on })))); return a.every((x) => x.f || x.c) ? a : false; }, 240000, 'dojezd').catch((e) => null);
    if (!fin) {
      const dbg = await Promise.all([1, 2].map((i) => ev(i, () => ({ s: __pl.s, v: __pl.v, t: __G().raceTime, phase: __G().phase }))));
      ok('dojezd: oba hráči dojeli', false, JSON.stringify(dbg));
    } else {
      ok('dojezd: oba hráči dojeli (nebo spadli – DNF)', true, JSON.stringify(fin));
      await sleep(2500);
      const ord = await Promise.all([1, 2].map((i) => ev(i, () => __net.order())));
      // kdo spadl, poslal pořadí dřív (nedojetí = null): porovnej jen místa, která znají oba
      const both = ord[0].map((x, j) => [x, ord[1][j]]).filter(([a, b]) => a && b);
      ok('pořadí netOrder() se u obou shoduje (kde oba znají cíl)', both.every(([a, b]) => a === b) && ord.every((o) => o.filter(Boolean).length === new Set(o.filter(Boolean)).size), JSON.stringify(ord.map((o) => o.map((x) => x ? x[0] : '-').join(''))));
    }
    for (let i = 0; i < 3; i++) ok('bez chyb v konzoli, okno ' + NICK[i], errs[i].length === 0, errs[i].slice(0, 3).join(' | '));
  } catch (e) {
    ok('scénář doběhl', false, e.message);
    for (let i = 0; i < P.length; i++) { try { res.push('  stav ' + i + ': ' + JSON.stringify(await P[i].page.evaluate(() => ({ st: RaceNet.status, host: RaceNet.isHost(), m: RaceNet.members().length, l: RaceNet.members().filter((k) => k !== RaceNet.me).map((k) => RaceNet.linkState(k)), stats: RaceNet.stats, me: RaceNet.me.slice(0, 2), hostK: String(RaceNet.host).slice(0, 2), order: RaceNet.members().map((k) => k.slice(0, 2)), ep: RaceNet.epoch, ph: __G().phase, rt: +__G().raceTime.toFixed(1), ps: +__pl.s.toFixed(1), S0: +__G().START_S.toFixed(1), neu: __G().neu })))); } catch (x) {} }
    for (let i = 0; i < 3; i++) if (errs[i].length) res.push('  chyby okna ' + i + ': ' + errs[i].slice(0, 4).join(' | '));
  } finally {
    console.log(res.join('\n')); for (const b of browsers) await b.close().catch(() => {}); srv.close(); process.exit(fails ? 1 : 0);
  }
})();

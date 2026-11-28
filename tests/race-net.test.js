// Zkouška síťové vrstvy online závodu (race-net.js): atrapa Realtime serveru sdílená mezi hráči
// a atrapa RTCPeerConnection, která propojí dvojice v paměti. Bez sítě.
// Každý hráč má vlastní kopii race-net.js v odděleném kontextu (vm).
// Spuštění: node --test tests/race-net.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { webcrypto } = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'race-net.js'), 'utf8');
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const plain = (x) => JSON.parse(JSON.stringify(x));
async function until(fn, ms = 3000, msg = 'podmínka') {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('nesplněno: ' + msg); await tick(5); }
}
const U = (d) => d.repeat(8) + '-' + d.repeat(4) + '-' + d.repeat(4) + '-' + d.repeat(4) + '-' + d.repeat(12);

/* ---------- atrapa Supabase Realtime (Phoenix) ---------- */
function makeServer() {
  const S = { subs: [], log: [], seeds: {}, deny: false };
  const deliver = (ws, m) => setTimeout(() => { if (ws.readyState === 1 && ws.onmessage) ws.onmessage({ data: JSON.stringify(m) }); }, 0);
  const topicSubs = (topic) => S.subs.filter((s) => s.topic === topic);
  S.seed = (topic, key, meta) => { (S.seeds[topic] = S.seeds[topic] || {})[key] = meta; };
  S.state = (topic) => {
    const o = {};
    for (const [k, m] of Object.entries(S.seeds[topic] || {})) o[k] = { metas: [m] };
    topicSubs(topic).forEach((s) => { if (s.meta) o[s.key] = { metas: [s.meta] }; });
    return o;
  };
  const leaveSub = (sub) => {
    S.subs = S.subs.filter((s) => s !== sub);
    if (sub.meta) topicSubs(sub.topic).forEach((s) => deliver(s.ws, { topic: sub.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [sub.key]: { metas: [sub.meta] } } } }));
  };
  S.sigs = () => S.log.filter((x) => x.event === 'sig').map((x) => x.payload);
  S.WS = class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.out = []; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
    send(str) {
      const m = JSON.parse(str); this.out.push(m);
      if (m.topic === 'phoenix') { deliver(this, { topic: 'phoenix', event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } }); return; }
      const sub = S.subs.find((s) => s.ws === this && s.topic === m.topic);
      if (m.event === 'phx_join') {
        if (S.deny) { deliver(this, { topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'error', response: { reason: 'Unauthorized' } } }); return; }
        S.subs.push({ ws: this, topic: m.topic, key: m.payload.config.presence.key, meta: null });
        deliver(this, { topic: m.topic, event: 'phx_reply', ref: m.ref, payload: { status: 'ok', response: {} } });
        deliver(this, { topic: m.topic, event: 'presence_state', payload: S.state(m.topic) });
        return;
      }
      if (!sub) return;
      if (m.event === 'presence' && m.payload.event === 'track') {
        const old = sub.meta; sub.meta = Object.assign({}, m.payload.payload, { phx_ref: Math.random().toString(36).slice(2) });
        const diff = { joins: { [sub.key]: { metas: [sub.meta] } }, leaves: old ? { [sub.key]: { metas: [old] } } : {} };
        topicSubs(sub.topic).forEach((s) => deliver(s.ws, { topic: sub.topic, event: 'presence_diff', payload: diff }));
      } else if (m.event === 'broadcast') {
        S.log.push({ topic: m.topic, event: m.payload.event, payload: m.payload.payload });
        topicSubs(m.topic).forEach((s) => { if (s.ws !== this) deliver(s.ws, { topic: m.topic, event: 'broadcast', payload: m.payload }); });
      } else if (m.event === 'phx_leave') leaveSub(sub);
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; S.subs.filter((s) => s.ws === this).forEach(leaveSub); this.onclose && this.onclose(); }
  };
  // podvržená zpráva od serveru do kanálu (jako by ji poslal jiný klient)
  S.inject = (topic, event, payload) => topicSubs(topic).forEach((s) => deliver(s.ws, { topic, event: 'broadcast', payload: { type: 'broadcast', event, payload } }));
  return S;
}

/* ---------- atrapa WebRTC: spojí dvojice v paměti ---------- */
function makeNet() {
  const net = { n: 0, pcs: {} };
  class FakeDC {
    constructor(pc, label, o) { this.pc = pc; this.label = label; this.id = o.id; this.opts = o; this.readyState = 'connecting'; this.binaryType = 'blob'; this.peer = null; }
    send(d) {
      if (this.readyState !== 'open') throw new Error('kanál není otevřený');
      const p = this.peer, data = typeof d === 'string' ? d : d.slice(0);
      setTimeout(() => { if (p.readyState === 'open' && p.onmessage) p.onmessage({ data }); }, 1);
    }
    close() {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed'; const p = this.peer;
      setTimeout(() => { this.onclose && this.onclose(); if (p && p.readyState !== 'closed') { p.readyState = 'closed'; p.onclose && p.onclose(); } }, 1);
    }
  }
  net.make = (opts = {}) => class FakePC {
    constructor(cfg) { this.cfg = cfg; this.id = ++net.n; net.pcs[this.id] = this; this.ch = []; this.localDescription = null; this.remoteDescription = null; this.connectionState = 'new'; this.noConnect = !!opts.noConnect; this.relay = !!opts.relay; this.ice = 0; }
    createDataChannel(label, o) { const c = new FakeDC(this, label, o); this.ch.push(c); return c; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0 pc' + this.id }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'v=0 pc' + this.id }); }
    setLocalDescription(d) {
      this.localDescription = { type: d.type, sdp: d.sdp };
      setTimeout(() => { if (this.closed || !this.onicecandidate) return; this.onicecandidate({ candidate: { candidate: 'candidate:' + this.id + ' 1 udp 1 10.0.0.1 9 typ host', sdpMid: '0', sdpMLineIndex: 0 } }); this.onicecandidate({ candidate: null }); }, 0);
      this.tryConnect(); return Promise.resolve();
    }
    setRemoteDescription(d) { this.remoteDescription = { type: d.type, sdp: d.sdp }; this.remote = net.pcs[+/pc(\d+)/.exec(d.sdp)[1]]; this.tryConnect(); return Promise.resolve(); }
    addIceCandidate() { this.ice++; return Promise.resolve(); }
    tryConnect() {
      const o = this.remote;
      if (!o || o.remote !== this || !this.localDescription || !o.localDescription || this.connected || this.noConnect || o.noConnect || this.closed || o.closed) return;
      this.connected = o.connected = true;
      setTimeout(() => {
        [this, o].forEach((p) => { p.connectionState = 'connected'; p.onconnectionstatechange && p.onconnectionstatechange(); });
        this.ch.forEach((c) => { const d = o.ch.find((x) => x.id === c.id); if (d) { c.peer = d; d.peer = c; } });
        [...this.ch, ...o.ch].forEach((c) => { if (c.peer) { c.readyState = 'open'; c.onopen && c.onopen(); } });
      }, 2);
    }
    getStats() {
      return Promise.resolve(new Map([
        ['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'CP' }],
        ['CP', { id: 'CP', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'RC', state: 'succeeded' }],
        ['L', { id: 'L', type: 'local-candidate', candidateType: this.relay ? 'relay' : 'host' }],
        ['RC', { id: 'RC', type: 'remote-candidate', candidateType: 'srflx' }]
      ]));
    }
    close() { if (this.closed) return; this.closed = true; this.connectionState = 'closed'; this.ch.forEach((c) => c.close()); }
  };
  return net;
}

/* jeden hráč = vlastní kontext s race-net.js */
function player(S, net, o = {}) {
  const uid = o.uid || webcrypto.randomUUID();
  const sb = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, crypto: webcrypto,
    Online: {
      loggedIn: () => o.logged !== false, accessToken: () => Promise.resolve('TOKEN'), uid: () => uid,
      config: () => ({ url: 'https://x.supabase.co', key: 'pk' }),
      iceServers: o.ice || (() => Promise.resolve([{ urls: 'stun:test.local' }])),
      names: (ids) => Promise.resolve(ids.map((i) => ({ id: i, nickname: 'N-' + i.slice(0, 4), badge: null })))
    }
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'race-net.js' });
  const R = sb.RaceNet;
  R._WS = S.WS; R._RTC = net.make(o); if (o.now) R._now = o.now;
  R.hosts = []; R.onHost = (me, e) => R.hosts.push([me, e]);
  return R;
}
const allOpen = (ps) => ps.every((a) => ps.every((b) => a === b || a.linkState(b.me) === 'open'));
const kill = (...ps) => ps.forEach((p) => p.leave());

test('nepřihlášený se nepřipojí, odmítnutý join = denied', async () => {
  const S = makeServer(), net = makeNet();
  const A = player(S, net, { logged: false });
  A.join('scratch'); await tick();
  assert.strictEqual(A.status, 'denied');
  S.deny = true;
  const B = player(S, net);
  B.join('scratch');
  await until(() => B.status === 'denied');
  assert.strictEqual(B.join('Špatný režim!'), false);
  kill(A, B);
});

test('výběr místnosti: plná → další, běžící závod → další, vše obsazené → full', async () => {
  const S = makeServer(), net = makeNet();
  for (let i = 0; i < 8; i++) S.seed('realtime:zavod:scratch:1', 'p' + i + ':x', { t: 100 + i, st: 'wait' });
  S.seed('realtime:zavod:scratch:2', 'h:x', { t: 50, st: 'race' });
  S.seed('realtime:zavod:scratch:2', 'g:x', { t: 60, st: 'wait' });
  S.seed('realtime:zavod:scratch:3', 'q:x', { t: 70, st: 'wait' });
  S.seed('realtime:zavod:scratch:3', 'r:x', { t: 40, st: 'race' });   // r není hostitel? je: nejmenší t → závod jede
  S.seed('realtime:zavod:scratch:4', 'z:x', { t: 90, st: 'wait' });
  S.seed('realtime:zavod:scratch:4', 'y:x', { t: 95, st: 'race' });   // jen člen (ne hostitel) v závodě: vstoupí
  const A = player(S, net);
  A.join('scratch');
  await until(() => A.status === 'lobby');
  assert.strictEqual(A.room, 4);
  const meta = S.subs.find((s) => s.key === A.me).meta;
  assert.strictEqual(meta.st, 'wait');
  assert.ok(Number.isFinite(meta.t));
  assert.strictEqual(S.subs.find((s) => s.key === A.me).topic, 'realtime:zavod:scratch:4');
  assert.strictEqual(A.host, 'z:x');
  assert.deepStrictEqual(plain(A.members()), ['z:x', 'y:x', A.me]);
  kill(A);
  // všech 20 místností plných
  const S2 = makeServer();
  for (let r = 1; r <= 20; r++) for (let i = 0; i < 8; i++) S2.seed('realtime:zavod:keirin:' + r, 'k' + i + ':x', { t: i, st: 'wait' });
  const B = player(S2, net);
  B.join('keirin');
  await until(() => B.status === 'full');
  assert.strictEqual(S2.subs.length, 0);
  kill(B);
});

test('volba hostitele: nejmenší t, při shodě menší klíč; nabídku posílá menší klíč', async () => {
  const S = makeServer(), net = makeNet();
  const t = () => 1000;   // stejný čas připojení u obou
  const A = player(S, net, { uid: U('2'), now: t });
  const B = player(S, net, { uid: U('1'), now: t });
  A.join('sprint'); await until(() => A.status === 'lobby');
  B.join('sprint'); await until(() => B.status === 'lobby');
  await until(() => allOpen([A, B]), 3000, 'spojení A–B');
  assert.strictEqual(A.host, B.me);   // shoda t → menší klíč (účet 1111…)
  assert.strictEqual(B.host, B.me);
  assert.ok(B.isHost() && !A.isHost());
  const offers = S.sigs().filter((s) => s.ty === 'offer');
  assert.strictEqual(offers.length, 1);
  assert.strictEqual(offers[0].f, B.me);
  assert.ok(S.sigs().every((s) => s.ty !== 'answer' || s.f === A.me));
  assert.ok(S.sigs().some((s) => s.ty === 'ice'));
  // datové kanály: negotiated id 0 'u' bez záruky, id 1 'r' spolehlivý, arraybuffer, iceServers z Online
  const pc = Object.values(net.pcs)[0];
  assert.deepStrictEqual(plain(pc.cfg.iceServers), [{ urls: 'stun:test.local' }]);
  const [u, r] = pc.ch;
  assert.deepStrictEqual([u.label, u.id, u.opts.negotiated, u.opts.ordered, u.opts.maxRetransmits, u.binaryType], ['u', 0, true, false, 0, 'arraybuffer']);
  assert.deepStrictEqual([r.label, r.id, r.opts.negotiated, r.opts.ordered], ['r', 1, true, true]);
  await until(() => A.epoch === 1 && B.epoch === 1);
  assert.deepStrictEqual(plain(B.hosts), [[true, 1]]);
  assert.deepStrictEqual(plain(A.hosts.pop()), [false, 1]);
  assert.strictEqual(A.relayed(B.me), false);
  kill(A, B);
});

test('mesh 3 hráčů, jména, relay a selhání iceServers', async () => {
  const S = makeServer(), net = makeNet();
  const A = player(S, net, { ice: () => Promise.reject(new Error('x')) });
  const B = player(S, net, { relay: true });
  const C = player(S, net);
  A.join('points'); await until(() => A.status === 'lobby'); await tick(5);
  B.join('points'); await until(() => B.status === 'lobby'); await tick(5);
  C.join('points'); await until(() => C.status === 'lobby');
  await until(() => allOpen([A, B, C]), 3000, 'mesh');
  for (const p of [A, B, C]) {
    assert.strictEqual(p.host, A.me);
    assert.strictEqual(p.members().length, 3);
    assert.deepStrictEqual(plain(p.members()), plain(A.members()));
    assert.strictEqual(p.members()[0], A.me);
  }
  await until(() => B.epoch === 1 && C.epoch === 1);
  assert.strictEqual(Object.keys(net.pcs).length, 6);   // 3 dvojice × 2 strany
  assert.deepStrictEqual(plain(Object.values(net.pcs).find((p) => p.cfg.iceServers[0].urls.startsWith('stun:stun.l.google')).cfg.iceServers), [{ urls: 'stun:stun.l.google.com:19302' }]);
  await until(() => B.relayed(A.me) && B.relayed(C.me));
  assert.strictEqual(A.relayed(B.me), false);
  await until(() => A.name(B.me) !== null);
  assert.strictEqual(A.name(B.me).nick, 'N-' + B.me.slice(0, 4));
  // stav jezdce dojde všem
  assert.strictEqual(B.send({ s: 10, w: 1, v: 15, e: 0.8, f: 0.5, l: 1, fl: 3 }), 2);
  await until(() => A.peers[B.me].buf.length && C.peers[B.me].buf.length);
  assert.ok(Math.abs(A.peers[B.me].buf[0].s - 10) < 1e-5);
  // spolehlivá událost
  const got = []; C.onEvent = (f, k, d, h) => got.push([f, k, plain(d), h]);
  assert.strictEqual(B.event('ahoj', { x: 1 }), 2);
  assert.strictEqual(A.event('pad', { r: 2 }), 2);
  await until(() => got.length === 2);
  assert.deepStrictEqual(got.find((g) => g[1] === 'ahoj'), [B.me, 'ahoj', { x: 1 }, false]);
  assert.deepStrictEqual(got.find((g) => g[1] === 'pad'), [A.me, 'pad', { r: 2 }, true]);
  kill(A, B, C);
});

test('binární kódování stavu: 32 B, tam a zpět, nesmysly zamítnout', () => {
  const S = makeServer(), net = makeNet();
  const A = player(S, net);
  const b = A._enc({ s: 152.25, w: 2.5, v: 17.3, e: 0.42, f: 1, l: 7, fl: 0x1234 }, 65535, 1234567.5);
  assert.strictEqual(b.byteLength, 32);
  const d = A._dec(b);
  assert.strictEqual(d.seq, 65535);
  assert.strictEqual(d.t, 1234567.5);
  assert.ok(Math.abs(d.s - 152.25) < 1e-4 && Math.abs(d.w - 2.5) < 1e-6 && Math.abs(d.v - 17.3) < 1e-5);
  assert.ok(Math.abs(d.e - 0.42) < 1e-4 && d.f === 1);
  assert.strictEqual(d.l, 7); assert.strictEqual(d.fl, 0x1234);
  assert.strictEqual(A._enc({ s: NaN, w: 0, v: 0 }, 1, 0), null);
  assert.strictEqual(A._enc({ s: 1, w: 0, v: Infinity }, 1, 0), null);
  assert.strictEqual(A._dec(new ArrayBuffer(31)), null);
  const x = A._enc({ s: 1, w: 0, v: 1, e: 2, f: -1 }, 1, 5);
  assert.strictEqual(A._dec(x).e, 1); assert.strictEqual(A._dec(x).f, 0);   // ořez na 0–1
  new DataView(x).setFloat32(12, NaN, true);
  assert.strictEqual(A._dec(x), null);
  const y = A._enc({ s: 1, w: 0, v: 1 }, 1, 5); new Uint8Array(y)[0] = 9;
  assert.strictEqual(A._dec(y), null);
  kill(A);
});

async function pair(o1 = {}, o2 = {}) {
  const S = makeServer(), net = makeNet();
  const A = player(S, net, Object.assign({ uid: U('1') }, o1));
  const B = player(S, net, Object.assign({ uid: U('2') }, o2));
  A.join('scratch'); await until(() => A.status === 'lobby'); await tick(5);
  B.join('scratch'); await until(() => B.status === 'lobby');
  await until(() => allOpen([A, B]), 3000, 'spojení');
  await until(() => B.epoch === 1);
  return { S, net, A, B };
}

test('zahazování starších sekvencí včetně přetečení Uint16', async () => {
  const { A, B } = await pair();
  const st = (s) => ({ s, w: 0, v: 10, e: 1, f: 0, l: 0, fl: 0 });
  const t = A.hostNow();
  B._in(A.me, 'u', A._enc(st(1), 65534, t));
  B._in(A.me, 'u', A._enc(st(2), 65535, t + 10));
  B._in(A.me, 'u', A._enc(st(3), 0, t + 20));       // přetečení: novější
  B._in(A.me, 'u', A._enc(st(9), 65535, t + 30));   // starší: zahodit
  B._in(A.me, 'u', A._enc(st(9), 0, t + 30));       // stejná: zahodit
  B._in(A.me, 'u', A._enc(st(4), 1, t + 40));
  B._in(A.me, 'u', A._enc(st(9), 40000, t + 50));   // o víc než půl rozsahu zpátky = starší
  const buf = B.peers[A.me].buf;
  assert.deepStrictEqual(plain(buf.map((x) => Math.round(x.s))), [1, 2, 3, 4]);
  assert.strictEqual(B.stats.old, 3);
  for (let i = 2; i < 40; i++) B._in(A.me, 'u', A._enc(st(i), i, t + 50));
  assert.strictEqual(buf.length, 20);   // drží posledních 20 vzorků
  assert.ok(buf.every((x) => x.t <= Date.now() + 1));   // čas přepočtený na lokální hodiny, ne v budoucnosti
  kill(A, B);
});

test('interpolace, přetečení kola, extrapolace s limitem 0,5 s', () => {
  const S = makeServer(), net = makeNet();
  const A = player(S, net);
  const LAP = A.LAP;
  assert.strictEqual(LAP, 153.846);
  assert.strictEqual(A.sample('nikdo', 0), null);
  const smp = (t, s, l, v = 15, extra = {}) => Object.assign({ t, s, w: 1, v, e: 0.5, f: 0.5, l, fl: 0 }, extra);
  A.peers.k = { buf: [] };
  assert.strictEqual(A.sample('k', 1000), null);
  A.peers.k.buf.push(smp(1000, 10, 0, 10, { w: 0, e: 1 }), smp(1100, 11, 0, 10, { w: 2, e: 0 }));
  // now − 150 ms = 1100 − 50 = 1050 → polovina
  let r = A.sample('k', 1200);
  assert.ok(Math.abs(r.s - 10.5) < 1e-9 && Math.abs(r.w - 1) < 1e-9 && Math.abs(r.e - 0.5) < 1e-9 && r.l === 0);
  // před prvním vzorkem: první vzorek
  assert.strictEqual(A.sample('k', 1000).s, 10);
  // extrapolace: 200 ms za posledním vzorkem → +2 m (v = 10 m/s)
  r = A.sample('k', 1450);
  assert.ok(Math.abs(r.s - 13) < 1e-9);
  // limit 0,5 s
  r = A.sample('k', 5000);
  assert.ok(Math.abs(r.s - 16) < 1e-9);
  // přes cíl: 153,0 (kolo 2) → 1,0 (kolo 3)
  A.peers.k.buf = [smp(0, 153.0, 2, 20), smp(100, 1.0, 3, 20)];
  r = A.sample('k', 150 + 25);   // 25 % cesty: 153 + 0,25·1,846 = 153,46
  assert.ok(Math.abs(r.s - (153 + 0.25 * (LAP - 153 + 1))) < 1e-9 && r.l === 2);
  r = A.sample('k', 150 + 75);   // 75 %: přetekl přes LAP → kolo 3
  assert.ok(Math.abs(r.s - (153 + 0.75 * (LAP - 153 + 1) - LAP)) < 1e-9 && r.l === 3);
  // extrapolace přes cíl
  A.peers.k.buf = [smp(0, 150, 4, 20), smp(100, 152, 4, 20)];
  r = A.sample('k', 100 + 150 + 300);   // +6 m → 158 − LAP
  assert.ok(Math.abs(r.s - (158 - LAP)) < 1e-6 && r.l === 5);
  kill(A);
});

test('start závodu: čas hostitele převedený na místní hodiny, presence st:race, další hráč jde jinam', async () => {
  const skew = 5000;   // hodiny B jdou o 5 s napřed
  const { S, net, A, B } = await pair({}, { now: () => Date.now() + skew });
  assert.ok(A.isHost());
  await until(() => B.peers[A.me] && Object.keys(B.peers).length && Math.abs(B.hostNow() - Date.now()) < 50, 3000, 'synchronizace hodin');
  assert.ok(Math.abs(B.toLocal(Date.now()) - (Date.now() + skew)) < 50);
  assert.strictEqual(A.hostNow(), A.toLocal(A.hostNow()));   // hostitel má offset 0
  const sa = [], sb = [];
  A.onStart = (x) => sa.push(plain(x)); B.onStart = (x) => sb.push(plain(x));
  assert.strictEqual(B.startRace(3000, {}), null);   // jen hostitel
  const id = A.startRace(3000, { laps: 4 });
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(A.status, 'race');
  await until(() => sb.length === 1);
  assert.strictEqual(sa.length, 1);
  assert.strictEqual(sb[0].race, id); assert.strictEqual(sb[0].host, A.me);
  assert.deepStrictEqual(sb[0].info, { laps: 4 });
  assert.ok(Math.abs(sa[0].atLocal - (Date.now() + 3000)) < 100);
  assert.ok(Math.abs(sb[0].atLocal - (Date.now() + skew + 3000)) < 100);   // v hodinách B
  assert.strictEqual(B.status, 'race');
  await until(() => S.subs.every((s) => s.meta && s.meta.st === 'race'));
  // nový hráč do běžícího závodu nevstoupí
  const C = player(S, net);
  C.join('scratch');
  await until(() => C.status === 'lobby');
  assert.strictEqual(C.room, 2);
  // opakovaný start se stejným id se ignoruje
  B._in(A.me, 'r', JSON.stringify({ k: 'start', e: 1, at: 1, race: id, info: null }));
  assert.strictEqual(sb.length, 1);
  // snímek od hostitele
  const snaps = []; B.onSnap = (o, f) => snaps.push([plain(o), f]);
  assert.strictEqual(B.snap({ a: 1 }), 0);   // ne-hostitel nesmí
  assert.strictEqual(A.snap({ order: [1, 2] }), 1);
  await until(() => snaps.length === 1);
  assert.deepStrictEqual(snaps[0], [{ order: [1, 2] }, A.me]);
  assert.deepStrictEqual(plain(B.lastSnap), { order: [1, 2] });
  kill(A, B, C);
});

test('převzetí hostitele po odchodu: epocha +1 u všech, zprávy starého hostitele a ne-hostitelů se zahodí', async () => {
  const S = makeServer(), net = makeNet();
  const ps = [U('4'), U('3'), U('2'), U('1')].map((u) => player(S, net, { uid: u }));
  for (const p of ps) { p.join('madison'); await until(() => p.status === 'lobby'); await tick(5); }
  const [A, B, C, D] = ps;
  await until(() => allOpen(ps), 4000, 'mesh 4');
  await until(() => ps.every((p) => p.host === A.me && p.epoch === 1));
  // B a C dostanou snímek od A
  A.snap({ n: 1 });
  await until(() => C.lastSnap && C.lastSnap.n === 1);
  A.leave();
  await until(() => [B, C, D].every((p) => p.host === B.me && p.epoch === 2 && !p.peers[A.me]), 3000, 'převzetí');
  assert.ok(B.isHost());
  assert.deepStrictEqual(plain(B.hosts.pop()), [true, 2]);
  assert.deepStrictEqual(plain(C.members()), [B.me, C.me, D.me]);
  assert.deepStrictEqual(plain(C.lastSnap), { n: 1 });   // poslední snímek zůstal pro převzetí
  const ev = []; C.onEvent = (f, k) => ev.push(k);
  const drop0 = C.stats.drop;
  // zpráva hostitele se starou epochou (od nového hostitele) – zahodit
  C._in(B.me, 'r', JSON.stringify({ k: 'ev', n: 'stara', d: null, h: 1, e: 1 }));
  // hostitelská zpráva od ne-hostitele D – zahodit
  C._in(D.me, 'r', JSON.stringify({ k: 'start', e: 2, at: 1, race: 'x', info: null }));
  C._in(D.me, 'u', JSON.stringify({ k: 'snap', e: 5, d: { fake: 1 } }));
  C._in(D.me, 'r', JSON.stringify({ k: 'host', e: 9 }));
  assert.strictEqual(C.stats.drop - drop0, 4);
  assert.strictEqual(C.status, 'lobby');
  assert.deepStrictEqual(plain(C.lastSnap), { n: 1 });
  assert.strictEqual(C.epoch, 2);
  // starý hostitel už není v místnosti: jeho zprávy jsou od neznámého
  const bad0 = C.stats.bad;
  C._in(A.me, 'r', JSON.stringify({ k: 'snap', e: 3, d: {} }));
  assert.strictEqual(C.stats.bad - bad0, 1);
  // nový hostitel funguje
  B.event('go', 1);
  await until(() => ev.includes('go'));
  assert.ok(!ev.includes('stara'));
  B.startRace(1000, null);
  await until(() => C.status === 'race' && D.status === 'race');
  kill(B, C, D);
});

test('převzetí po 2 s ticha od hostitele', async () => {
  let jump = 0;
  const { A, B } = await pair({}, { now: () => Date.now() + jump });
  assert.strictEqual(B.host, A.me);
  jump = 2500; B._tick();
  assert.strictEqual(B.host, B.me);
  assert.strictEqual(B.epoch, 2);
  assert.deepStrictEqual(plain(B.hosts.pop()), [true, 2]);
  kill(A, B);
});

test('ICE se nespojí do 10 s: jeden restart, pak záloha přes Supabase Realtime', async () => {
  let t = 1;
  const S = makeServer(), net = makeNet();
  const A = player(S, net, { uid: U('1'), now: () => t, noConnect: true });
  const B = player(S, net, { uid: U('2'), now: () => t });
  const links = []; A.onLink = (k, s) => links.push(s);
  A.join('scratch'); await until(() => A.status === 'lobby'); t = 10;
  B.join('scratch'); await until(() => B.status === 'lobby');
  await until(() => S.sigs().some((s) => s.ty === 'answer'));
  await tick(20);
  assert.strictEqual(A.linkState(B.me), 'connecting');
  t += 15100; A._tick(); B._tick();
  await until(() => S.sigs().some((s) => s.ty === 'offer' && s.n === 1), 2000, 'nová nabídka');
  assert.strictEqual(A.linkState(B.me), 'connecting');
  t += 15100; A._tick(); B._tick();
  assert.strictEqual(A.linkState(B.me), 'open');
  assert.ok(A.viaServer(B.me) && A.relayed(B.me));
  assert.strictEqual(links[links.length - 1], 'open');
  assert.strictEqual(S.sigs().filter((s) => s.ty === 'offer').length, 2);
  // data jdou přes server: stav (binárně v base64) i spolehlivé události; druhá strana se přidá sama
  const evs = []; B.onEvent = (f, k, d) => evs.push([f, k, d]);
  t += 300; A.send({ s: 12.5, w: 1, v: 10, e: 0.9, f: 0.5, l: 0, fl: 0 }); A.event('ahoj', { x: 1 });
  await until(() => B.peers[A.me] && B.peers[A.me].buf.length > 0 && evs.length > 0, 2000, 'data přes server');
  assert.ok(B.viaServer(A.me));
  assert.strictEqual(B.linkState(A.me), 'open');
  assert.ok(Math.abs(B.peers[A.me].buf[0].s - 12.5) < 1e-3);
  assert.deepStrictEqual(plain(evs[0].slice(1)), ['ahoj', { x: 1 }]);
  // přes server nejvýš 5× za s
  const tx0 = A.stats.tx; A.send({ s: 13, w: 1, v: 10, e: 0.9, f: 0.5, l: 0, fl: 0 });
  await tick(5); assert.strictEqual(A.stats.tx, tx0);
  kill(A, B);
});

test('neplatné zprávy: neznámí odesílatelé, špatné typy a velikosti → stats.bad', async () => {
  let jump = 0;
  const { S, A, B } = await pair({}, { now: () => Date.now() + jump });
  const topic = 'realtime:zavod:scratch:1';
  const b0 = B.stats.bad;
  S.inject(topic, 'sig', { f: A.me, to: B.me, ty: 'hack', d: {} });                       // špatný typ
  S.inject(topic, 'sig', { f: A.me, to: B.me, ty: 'offer', d: { type: 'offer', sdp: 5 } });   // špatná data
  S.inject(topic, 'sig', { f: A.me, to: B.me, ty: 'ice', d: { candidate: 'x'.repeat(3000) } });   // moc velké
  S.inject(topic, 'sig', { f: B.me.replace(/.$/, '#'), to: B.me, ty: 'answer', d: { type: 'answer', sdp: 'v=0 pc1' } });   // B je odpovídající, ale A mu odpověď poslat nesmí… a tenhle klíč neexistuje
  S.inject(topic, 'sig', { f: 'cizi:1', to: A.me, ty: 'ice', d: null });                  // není pro B: ignorovat
  S.inject(topic, 'sig', 'nesmysl');
  await tick(20);
  assert.strictEqual(B.stats.bad - b0, 4);   // neznámý klíč zatím čeká (presence může přijít později)
  // B (větší klíč) nesmí dostat odpověď, A nesmí dostat nabídku
  const a0 = A.stats.bad;
  S.inject(topic, 'sig', { f: B.me, to: A.me, ty: 'offer', d: { type: 'offer', sdp: 'v=0 pc9' } });
  await tick(20);
  assert.strictEqual(A.stats.bad - a0, 1);
  // datové kanály
  const c0 = B.stats.bad;
  B._in(A.me, 'r', '{nejde');
  B._in(A.me, 'r', JSON.stringify([1, 2]));
  B._in(A.me, 'r', JSON.stringify({ k: 'neznamy' }));
  B._in(A.me, 'r', JSON.stringify({ k: 'ev', n: 'špatné jméno!' }));
  B._in(A.me, 'r', 'x'.repeat(20000));
  B._in(A.me, 'r', JSON.stringify({ k: 'start', e: 1, at: 'zitra', race: 'r' }));
  B._in(A.me, 'r', JSON.stringify({ k: 'host', e: -1 }));
  B._in(A.me, 'r', JSON.stringify({ k: 'pong', a: 12345, b: 1 }));   // na tenhle ping se B neptal
  B._in(A.me, 'u', new ArrayBuffer(10));
  B._in(A.me, 'u', JSON.stringify({ k: 'ev', n: 'x' }));            // na 'u' jen snímek
  B._in(A.me, 'u', JSON.stringify({ k: 'snap', e: 1, d: 'text' }));
  B._in('nikdo:1', 'r', JSON.stringify({ k: 'ev', n: 'x' }));
  assert.strictEqual(B.stats.bad - c0, 12);
  assert.strictEqual(B.status, 'lobby');
  // nic z toho nezměnilo stav a spojení drží
  assert.strictEqual(B.epoch, 1);
  assert.strictEqual(B.linkState(A.me), 'open');
  assert.strictEqual(B.event('x/y', 1), 0);
  const p0 = B.stats.bad;
  jump = 3500; B._tick();   // čekající zpráva od neznámého klíče propadne
  assert.strictEqual(B.stats.bad - p0, 1);
  kill(A, B);
});

test('odchod: leave zavře spojení i kanál, status off', async () => {
  const { S, net, A, B } = await pair();
  A.leave();
  assert.strictEqual(A.status, 'off');
  assert.deepStrictEqual(plain(A.members()), []);
  assert.ok(Object.values(net.pcs).some((p) => p.closed));
  await until(() => B.members().length === 1 && B.isHost());
  assert.strictEqual(S.subs.length, 1);
  B._reset();
  assert.strictEqual(B.status, 'off');
  assert.strictEqual(S.subs.length, 0);
});

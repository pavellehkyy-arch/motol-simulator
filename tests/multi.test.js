// Zkouška plochy online (multi.js) na atrapě realtime serveru, bez sítě.
// Spuštění: node --test tests/multi.test.js
const test = require('node:test');
const assert = require('node:assert');

const AID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', A = AID + ':dev1';
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
function setup(opts = {}) {
  const socks = [];
  class FakeWS {
    constructor(url) { this.url = url; this.readyState = 0; this.out = []; socks.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
    send(s) { const m = JSON.parse(s); this.out.push(m); if (opts.onSend) opts.onSend(this, m); }
    close() { this.readyState = 3; this.onclose && this.onclose(); }
    push(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
  }
  global.window = undefined;
  globalThis.Online = {
    loggedIn: () => opts.logged !== false, accessToken: () => Promise.resolve('TOKEN'), uid: () => '11111111-1111-1111-1111-111111111111',
    config: () => ({ url: 'https://x.supabase.co', key: 'pk' }),
    names: (ids) => Promise.resolve(ids.filter((i) => i === AID).map((i) => ({ id: i, nickname: 'Anna', badge: 'gold' })))
  };
  delete require.cache[require.resolve('../multi.js')];
  require('../multi.js');
  const M = globalThis.Multi;
  M._WS = FakeWS;
  return { M, socks };
}
const joins = (ws) => ws.out.filter((m) => m.event === 'phx_join');
function okJoin(ws, state) {
  const j = joins(ws).pop();
  ws.push({ topic: j.topic, event: 'phx_reply', ref: j.ref, payload: { status: 'ok', response: {} } });
  ws.push({ topic: j.topic, event: 'presence_state', payload: state || {} });
  return j;
}

test('nepřihlášený se nepřipojí', async () => {
  const { M, socks } = setup({ logged: false });
  M.start(); await tick();
  assert.strictEqual(socks.length, 0);
  assert.strictEqual(M.status, 'denied');
});

test('připojení: soukromý kanál plocha:1 s tokenem, presence a příjem poloh', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0];
  assert.match(ws.url, /^wss:\/\/x\.supabase\.co\/realtime\/v1\/websocket\?apikey=pk/);
  const j = okJoin(ws, { [A]: { metas: [{}] } });
  assert.strictEqual(j.topic, 'realtime:plocha:1');
  assert.strictEqual(j.payload.config.private, true);
  assert.strictEqual(j.payload.access_token, 'TOKEN');
  assert.strictEqual(M.status, 'on');
  assert.ok(ws.out.some((m) => m.event === 'presence' && m.payload.event === 'track'));
  assert.strictEqual(M.count(), 2);
  assert.strictEqual(M.others(), 1);
  await tick();
  assert.deepStrictEqual(M.name(A), { nick: 'Anna', gold: true });
  // poloha od hráče v místnosti se uloží, od cizího (není v presence) ani nesmysl ne
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: A, x: 1, y: 2, z: 3, h: 0.5, v: 1.2, st: 0 } } });
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: 'zz', x: 1, y: 2, z: 3, h: 0 } } });
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: A, x: 'NaN', y: 2, z: 3, h: 0 } } });
  assert.deepStrictEqual(Object.keys(M.peers), [A]);
  assert.strictEqual(M.peers[A].x, 1);
  assert.strictEqual(M.peers[A].r, null);
  // záchranka po pádu ze žebříku: r = [x, z, natočení, fáze 0–4, čas]; nesmysl se zahodí
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: A, x: 1, y: 2, z: 3, h: 0, st: 3, r: [4, 5, 0.5, 2, 1.25] } } });
  assert.deepStrictEqual(M.peers[A].r, [4, 5, 0.5, 2, 1.25]);
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: A, x: 1, y: 2, z: 3, h: 0, st: 3, r: [4, 'x', 0.5, 2, 1] } } });
  assert.strictEqual(M.peers[A].r, null);
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: A, x: 1, y: 2, z: 3, h: 0, st: 3, r: [4, 5, 0.5, 9, 1] } } });
  assert.strictEqual(M.peers[A].r, null);
  // odeslání vlastní polohy
  assert.ok(M.send({ x: 5, y: 0, z: 1, h: 0, v: 0, st: 0 }));
  const b = ws.out.filter((m) => m.event === 'broadcast').pop();
  assert.match(b.payload.payload.u, /^11111111-1111-1111-1111-111111111111:\w+$/);
  // odchod hráče
  ws.push({ topic: j.topic, event: 'presence_diff', payload: { joins: {}, leaves: { [A]: { metas: [{}] } } } });
  assert.deepStrictEqual(Object.keys(M.peers), []);
  assert.strictEqual(M.count(), 1);
  M.stop();
  assert.strictEqual(M.status, 'off');
  assert.ok(ws.out.some((m) => m.event === 'phx_leave'));
});

test('plná místnost (8 hráčů): přejde do plocha:2', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0];
  const full = {}; for (let i = 0; i < 8; i++) full['p' + i] = { metas: [{}] };
  okJoin(ws, full);
  await tick();
  const j2 = joins(ws).pop();
  assert.strictEqual(j2.topic, 'realtime:plocha:2');
  okJoin(ws, {});
  assert.strictEqual(M.status, 'on');
  assert.strictEqual(M.room, 2);
  M.stop();
});

test('server odmítne (bez přezdívky): stav denied, žádné opakování', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0], j = joins(ws).pop();
  ws.push({ topic: j.topic, event: 'phx_reply', ref: j.ref, payload: { status: 'error', response: { reason: 'Unauthorized' } } });
  await tick(30);
  assert.strictEqual(M.status, 'denied');
  assert.strictEqual(socks.length, 1);
});

test('výpadek spojení: zkusí se připojit znovu', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  okJoin(socks[0], {});
  socks[0].close();
  assert.strictEqual(M.status, 'error');
  await tick(2100);
  assert.strictEqual(socks.length, 2);
  M.stop();
});

test('stejný účet na dvou zařízeních: druhé zařízení je vidět', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0], other = '11111111-1111-1111-1111-111111111111:jinezarizeni';
  const j = okJoin(ws, { [other]: { metas: [{}] } });
  const key = j.payload.config.presence.key;
  assert.notStrictEqual(key, other);
  assert.strictEqual(M.others(), 0);   // můj vlastní účet se do ostatních hráčů nepočítá
  assert.strictEqual(M.count(), 1);
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'p', payload: { u: other, x: 1, y: 0, z: 0, h: 0 } } });
  assert.deepStrictEqual(Object.keys(M.peers), [other]);
  M.stop();
});

test('sám na ploše: počítadlo ukáže jen mě, i když server poslal můj vlastní klíč', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0];
  const j = okJoin(ws, {});
  const key = j.payload.config.presence.key;
  ws.push({ topic: j.topic, event: 'presence_diff', payload: { joins: { [key]: { metas: [{}] } }, leaves: {} } });
  assert.strictEqual(M.others(), 0);
  assert.strictEqual(M.count(), 1);
  M.stop();
});

test('unikátní hráči: jeden cizí účet na dvou zařízeních je jeden hráč', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0];
  okJoin(ws, { [A]: { metas: [{}] }, [AID + ':dev2']: { metas: [{}, {}] } });
  assert.strictEqual(M.others(), 1);
  assert.strictEqual(M.count(), 2);
  M.stop();
});

test('jen jeden Realtime kanál: opakovaný start ani návrat z výpadku neotevře druhý', async () => {
  const { M, socks } = setup();
  M.start(); M.start(); await tick();
  assert.strictEqual(socks.length, 1);
  assert.strictEqual(joins(socks[0]).length, 1);
  okJoin(socks[0], {});
  assert.strictEqual(M.channels(), 1);
  socks[0].close(); await tick(2100);
  assert.strictEqual(socks.length, 2);
  assert.strictEqual(socks[0].readyState, 3);
  assert.strictEqual(joins(socks[1]).length, 1);
  M.stop();
  assert.strictEqual(M.channels(), 0);
});

test('chat: odeslání, příjem, čištění textu a limit 1 zpráva za 2 s', async () => {
  const { M, socks } = setup();
  M.start(); await tick();
  const ws = socks[0], j = okJoin(ws, { [A]: { metas: [{}] } });
  const got = []; M.onChat = (c) => got.push(c);
  assert.strictEqual(M.say('  ahoj‮   všichni  '), true);
  const out = ws.out.filter((m) => m.event === 'broadcast' && m.payload.event === 'c');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].payload.payload.m, 'ahoj všichni');
  assert.strictEqual(M.say('hned znovu'), false);   // moc rychle
  assert.strictEqual(M.say('   '), false);
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'c', payload: { u: A, m: 'x'.repeat(300) } } });
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'c', payload: { u: A, m: 'spam' } } });   // hned po první: zahodit
  ws.push({ topic: j.topic, event: 'broadcast', payload: { type: 'broadcast', event: 'c', payload: { u: 'cizi:1', m: 'nejsem v místnosti' } } });
  assert.strictEqual(got.length, 2);
  assert.strictEqual(got[0].me, true);
  assert.strictEqual(got[1].u, A);
  assert.strictEqual(got[1].text.length, 120);
  assert.strictEqual(M.chat.length, 2);
  M.stop();
  assert.strictEqual(M.chat.length, 0);
  M._reset();
});

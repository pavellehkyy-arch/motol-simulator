// Testy online.js s atrapou serveru (bez sítě a bez prohlížeče).
// Spuštění: node --test tests/online.test.js
const test = require('node:test');
const assert = require('node:assert');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(10); }
  return fn();
}

/* ---------- atrapa localStorage a serveru ---------- */
function makeEnv() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const srv = {
    online: true, otpRate: false, code: '123456', email: null,
    profile: { nickname: null, nickname_status: 'pending', money: 0, imported: false },
    purchases: [], results: [], board: [], calls: []
  };
  const json = (status, data) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)) });
  const fetchMock = async (url, opt) => {
    if (!srv.online) throw new Error('offline');
    const path = url.replace('https://maiswaiilplgvewuurux.supabase.co', '');
    const body = opt.body ? JSON.parse(opt.body) : null;
    const authed = /^Bearer A/.test((opt.headers || {}).Authorization || '');
    srv.calls.push(path);
    if (path === '/auth/v1/otp') return srv.otpRate ? json(429, { error_code: 'over_email_send_rate_limit', msg: 'rate' }) : (srv.email = body.email, json(200, {}));
    if (path === '/auth/v1/verify') {
      return body.token === srv.code
        ? json(200, { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, user: { id: 'u1', email: body.email } })
        : json(403, { error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    }
    if (path.startsWith('/auth/v1/token')) return json(200, { access_token: 'A2', refresh_token: 'R2', expires_in: 3600, user: { id: 'u1', email: srv.email } });
    if (path === '/auth/v1/logout') return json(204);
    if (path.startsWith('/rest/v1/profiles')) return authed ? json(200, [srv.profile]) : json(401, { message: 'JWT' });
    if (path.startsWith('/rest/v1/purchases')) return json(200, srv.purchases.map((id) => ({ item_id: id })));
    if (path === '/rest/v1/rpc/get_leaderboard') return json(200, srv.board);
    if (!authed) return json(401, { message: 'not_authenticated' });
    if (path === '/rest/v1/rpc/import_local_progress') {
      if (!srv.profile.imported) { srv.profile.money += Math.min(Math.max(body.p_money, 0), 2000); srv.profile.imported = true; srv.purchases = body.p_owned.filter((x) => x === 'cap'); }
      return json(200, { imported: true, money: srv.profile.money });
    }
    if (path === '/rest/v1/rpc/submit_result') {
      if (srv.reject) return json(400, { code: 'P0001', message: 'invalid_time' });
      const w = Math.min(Math.max(body.p_reward, 0), 400);
      srv.profile.money += w; srv.results.push(body);
      return json(200, { reward: w, money: srv.profile.money });
    }
    if (path === '/rest/v1/rpc/set_nickname') {
      if (body.p_nickname.length < 3) return json(400, { code: 'P0001', message: 'invalid_nickname' });
      srv.profile.nickname = body.p_nickname; srv.profile.nickname_status = 'pending'; return json(200, 'pending');
    }
    if (path === '/rest/v1/rpc/buy_item') {
      if (srv.profile.money < 150) return json(400, { code: 'P0001', message: 'not_enough_money' });
      srv.profile.money -= 150; srv.purchases.push(body.p_item_id); return json(200, srv.profile.money);
    }
    return json(404, { message: 'nezname ' + path });
  };
  delete require.cache[require.resolve('../online.js')];
  const O = require('../online.js');
  O._fetch = fetchMock;
  return { O, srv, store };
}

test('kód: špatný e-mail, limit e-mailů, úspěch', async () => {
  const { O, srv } = makeEnv();
  assert.strictEqual((await O.sendCode('abc')).err, 'bad_email');
  srv.otpRate = true;
  assert.strictEqual((await O.sendCode('a@b.cz')).err, 'rate');
  srv.otpRate = false;
  assert.deepStrictEqual(await O.sendCode(' a@b.cz '), { ok: true });
  assert.strictEqual(srv.email, 'a@b.cz');
});

test('ověření: špatný kód selže, správný přihlásí a převede místní penízky jen jednou', async () => {
  const { O, srv, store } = makeEnv();
  store.motol_vk = '300'; store.motol_shop = JSON.stringify({ cap: 1 });
  assert.strictEqual((await O.verify('a@b.cz', '000000')).err, 'otp');
  assert.strictEqual(O.loggedIn(), false);
  assert.strictEqual(store.motol_vk, '300');                 // bez přihlášení se nic nemění
  assert.strictEqual((await O.verify('a@b.cz', '123 456')).ok, true);
  assert.strictEqual(O.loggedIn(), true);
  assert.strictEqual(srv.profile.imported, true);
  assert.strictEqual(store.motol_vk, '300');
  assert.deepStrictEqual(JSON.parse(store.motol_shop), { cap: 1 });
  store.motol_vk = '9999';                                   // podvod v telefonu
  await O.sync();
  assert.strictEqual(store.motol_vk, '300');                 // server vyhrává, podruhé se nepřevádí
  assert.strictEqual(srv.profile.money, 300);
});

test('převod je omezený na 2000', async () => {
  const { O, srv, store } = makeEnv();
  store.motol_vk = '50000';
  await O.verify('a@b.cz', '123456');
  assert.strictEqual(srv.profile.money, 2000);
  assert.strictEqual(store.motol_vk, '2000');
});

test('výsledek po závodě: odměna se omezí serverem, místní stav se srovná', async () => {
  const { O, srv, store } = makeEnv();
  await O.verify('a@b.cz', '123456');
  O.report({ mode: 'kilo', time: 65.4321, points: null, position: 3, reward: 999 });
  assert.ok(await until(() => srv.results.length === 1));
  const r = srv.results[0];
  assert.deepStrictEqual([r.p_mode, r.p_time_s, r.p_position, r.p_reward], ['kilometr', 65.432, 1, 400]);
  assert.ok(await until(() => store.motol_vk === '400'));
  assert.strictEqual(JSON.parse(store.motol_outbox).length, 0);
});

test('režimy a neplatné hodnoty se přeloží a oříznou', async () => {
  const { O, srv } = makeEnv();
  await O.verify('a@b.cz', '123456');
  O.report({ mode: 'points', time: 5, points: 31.6, position: 99, reward: -5 });
  assert.ok(await until(() => srv.results.length === 1));
  const r = srv.results[0];
  assert.deepStrictEqual([r.p_mode, r.p_time_s, r.p_points, r.p_position, r.p_reward], ['bodovacka', null, 32, null, 0]);
});

test('team sprint jde na server jako team_sprint s časem, omnium s body', async () => {
  const { O, srv } = makeEnv();
  await O.verify('a@b.cz', '123456');
  O.report({ mode: 'teamsprint', time: 55.8123, points: null, position: 2, reward: 100 });
  assert.ok(await until(() => srv.results.length === 1));
  const r = srv.results[0];
  assert.deepStrictEqual([r.p_mode, r.p_time_s, r.p_points, r.p_position], ['team_sprint', 55.812, null, 2]);
  O.report({ mode: 'omnium', time: null, points: 142, position: 1, reward: 200 });
  assert.ok(await until(() => srv.results.length === 2));
  const o = srv.results[1];
  assert.deepStrictEqual([o.p_mode, o.p_time_s, o.p_points, o.p_position], ['omnium', null, 142, 1]);
});

test('bez přihlášení se nic neposílá', async () => {
  const { O, srv } = makeEnv();
  O.report({ mode: 'kilo', time: 70, position: 1, reward: 100 });
  await wait(50);
  assert.strictEqual(srv.results.length, 0);
});

test('bez připojení výsledek čeká a po obnovení se odešle', async () => {
  const { O, srv, store } = makeEnv();
  await O.verify('a@b.cz', '123456');
  srv.online = false;
  O.report({ mode: 'scratch', position: 1, reward: 100 });
  await wait(60);
  assert.strictEqual(JSON.parse(store.motol_outbox).length, 1);
  assert.strictEqual(srv.results.length, 0);
  srv.online = true;
  O.flush();
  assert.ok(await until(() => srv.results.length === 1));
  assert.ok(await until(() => JSON.parse(store.motol_outbox).length === 0));
});

test('odmítnutý záznam se zahodí, nezasekne frontu', async () => {
  const { O, srv, store } = makeEnv();
  await O.verify('a@b.cz', '123456');
  srv.reject = true;
  O.report({ mode: 'scratch', position: 1, reward: 10 });
  assert.ok(await until(() => JSON.parse(store.motol_outbox).length === 0));
});

test('výsledek jiného účtu ve frontě se neodešle', async () => {
  const { O, srv, store } = makeEnv();
  await O.verify('a@b.cz', '123456');
  store.motol_outbox = JSON.stringify([{ m: 'scratch', t: null, p: null, r: 1, w: 100, e: 'jiny@b.cz' }]);
  O.flush();
  await wait(60);
  assert.strictEqual(srv.results.length, 0);
  assert.strictEqual(JSON.parse(store.motol_outbox).length, 0);
});

test('přezdívka: neplatná se odmítne, platná se uloží jako čekající', async () => {
  const { O, srv } = makeEnv();
  await O.verify('a@b.cz', '123456');
  assert.strictEqual((await O.setNickname('ab')).err, 'invalid_nickname');
  assert.deepStrictEqual(await O.setNickname('Pavel'), { ok: true });
  assert.strictEqual(O.profile().nickname_status, 'pending');
  assert.strictEqual(srv.profile.nickname, 'Pavel');
});

test('obchod: nákup přes server aktualizuje penízky a nákupy; bez peněz selže', async () => {
  const { O, srv, store } = makeEnv();
  store.motol_vk = '100';
  await O.verify('a@b.cz', '123456');
  assert.strictEqual((await O.buy('bidon')).err, 'not_enough_money');
  srv.profile.money = 500;
  assert.deepStrictEqual(await O.buy('bidon'), { ok: true });
  assert.strictEqual(store.motol_vk, '350');
  assert.deepStrictEqual(JSON.parse(store.motol_shop), { bidon: 1 });
});

test('žebříček je dostupný i bez přihlášení', async () => {
  const { O, srv } = makeEnv();
  srv.board = [{ place: 1, nickname: 'Jarda', best_time_s: '61.2', best_points: null, wins: 0 }];
  const r = await O.leaderboard('kilometr');
  assert.strictEqual(r.rows[0].nickname, 'Jarda');
});

test('platnost přihlášení se obnoví automaticky', async () => {
  const { O, srv, store } = makeEnv();
  await O.verify('a@b.cz', '123456');
  const s = JSON.parse(store.motol_session); s.exp = 1; store.motol_session = JSON.stringify(s);
  delete require.cache[require.resolve('../online.js')];
  const O2 = require('../online.js'); O2._fetch = O._fetch; O2.init();
  assert.ok(await until(() => srv.calls.includes('/auth/v1/token?grant_type=refresh_token')));
  assert.ok(await until(() => JSON.parse(store.motol_session).access === 'A2'));
  assert.strictEqual(O2.loggedIn(), true);
});

test('odhlášení vynuluje telefon a smaže frontu', async () => {
  const { O, store } = makeEnv();
  store.motol_vk = '120';
  await O.verify('a@b.cz', '123456');
  store.motol_outbox = '[{"m":"scratch"}]';
  O.signOut();
  assert.strictEqual(O.loggedIn(), false);
  assert.strictEqual(store.motol_vk, '0');
  assert.strictEqual(store.motol_session, undefined);
  assert.strictEqual(store.motol_outbox, undefined);
});

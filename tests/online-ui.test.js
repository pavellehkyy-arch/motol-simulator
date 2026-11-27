// Zkouška vykreslení oken online.js na jednoduché atrapě stránky (bez prohlížeče).
// Spuštění: node --test tests/online-ui.test.js
const test = require('node:test');
const assert = require('node:assert');

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = {}; this._t = ''; this.value = ''; }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { this._t = ''; this.children = []; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  insertBefore(n) { this.children.push(n); n.parent = this; return n; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; if (k === 'class') this.className = v; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  contains() { return true; }
  focus() {}
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach((c) => c.find && c.find(pred, out)); return out; }
  click() { (this.listeners.click || []).forEach((f) => f({})); }
}
function setup() {
  const store = {};
  global.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  const body = new El('body'), head = new El('head'), menu = new El('div'), vk = new El('div');
  menu.appendChild(vk);
  const byId = {};
  global.window = { addEventListener() {} };
  global.document = {
    readyState: 'complete', body, head,
    createElement: (t) => new El(t), createTextNode: (t) => { const e = new El('#t'); e._t = t; return e; },
    getElementById: (id) => byId[id] || null,
    querySelector: (q) => (q === '.vk' ? vk : null),
    addEventListener() {}
  };
  vk.parentNode = menu; menu.insertBefore = (n) => { menu.appendChild(n); byId[n.id] = n; return n; };
  delete require.cache[require.resolve('../online.js')];
  const O = require('../online.js');
  const ov = body.children.find((c) => c.id === 'onlineOv');
  return { O, ov, box: ov.children[0], menu, byId, store };
}
const texts = (el) => el.textContent;
const btn = (el, label) => el.find((e) => e.tag === 'button' && e.textContent.includes(label))[0];

test('lišta v menu má žebříček a přihlášení', () => {
  const { menu } = setup();
  const bar = menu.children.find((c) => c.id === 'onlineBar');
  assert.ok(bar, 'lišta chybí');
  assert.match(texts(bar), /Žebříček/);
  assert.match(texts(bar), /Přihlásit se/);
});

test('okno přihlášení: zadání e-mailu, špatný e-mail ukáže hlášku', async () => {
  const { O, box } = setup();
  O._ui.open('login');
  assert.match(texts(box), /Přihlášení/);
  const inp = box.find((e) => e.tag === 'input')[0];
  inp.value = 'blbost';
  btn(box, 'Poslat kód').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(texts(box), /platný e-mail/);
});

test('zásady: odkaz z přihlášení otevře text s kontaktem a Zpět vrátí přihlášení', () => {
  const { O, box } = setup();
  O._ui.open('login');
  btn(box, 'Jak nakládáme s údaji').click();
  assert.match(texts(box), /Jak nakládáme s údaji/);
  assert.match(texts(box), /pavellehkyy@gmail\.com/);
  assert.match(texts(box), /nepoužívá cookies/);
  btn(box, 'Zpět').click();
  assert.match(texts(box), /Přihlášení/);
});

test('všechna okna se vykreslí bez chyby', () => {
  const { O, box, ov } = setup();
  for (const v of ['login', 'code', 'nick', 'account']) { O._ui.open(v); assert.ok(texts(box).length > 10, v); }
  assert.strictEqual(ov.style.display, 'flex');
});

test('žebříček: načte řádky a zobrazí čas v sekundách', async () => {
  const { O, box } = setup();
  O._fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify([
    { place: 1, nickname: 'Jarda', best_time_s: '61.2', best_points: null, wins: 0 },
    { place: 2, nickname: '<b>x</b>', best_time_s: '70', best_points: null, wins: 0 }]) });
  O._ui.open('board');
  await new Promise((r) => setTimeout(r, 30));
  assert.match(texts(box), /Jarda/);
  assert.match(texts(box), /61,200 s/);
  assert.match(texts(box), /<b>x<\/b>/);        // přezdívka je jen text, nic se nespustí
  assert.ok(!box.find((e) => e.tag === 'b').length);
});

test('žebříček: chyba sítě ukáže hlášku, prázdný žebříček vyzve k účasti', async () => {
  const { O, box } = setup();
  O._fetch = async () => { throw new Error('x'); };
  O._ui.open('board');
  await new Promise((r) => setTimeout(r, 30));
  assert.match(texts(box), /Nejde se připojit/);
  O._fetch = async () => ({ ok: true, status: 200, text: async () => '[]' });
  btn(box, 'Scratch').click();
  await new Promise((r) => setTimeout(r, 30));
  assert.match(texts(box), /Buď první/);
});

test('žebříček: zlatá přezdívka dostane třídu gold, ostatní ne (a cizí hodnoty se ignorují)', async () => {
  const { O, box } = setup();
  O._fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify([
    { place: 1, nickname: 'Zlatý', best_time_s: '60', best_points: null, wins: 0, badge: 'gold' },
    { place: 2, nickname: 'Obyč', best_time_s: '61', best_points: null, wins: 0, badge: null },
    { place: 3, nickname: 'Hacker', best_time_s: '62', best_points: null, wins: 0, badge: 'x" onclick="y' }]) });
  O._ui.open('board');
  await new Promise((r) => setTimeout(r, 30));
  const gold = box.find((e) => e.tag === 'span' && e.className === 'gold');
  assert.strictEqual(gold.length, 1);
  assert.match(gold[0].textContent, /Zlatý/);
  const gb = box.find((e) => e.tag === 'span' && e.className === 'gb');
  assert.strictEqual(gb.length, 1);
  assert.strictEqual(gb[0].textContent, 'GOLD');
});

test('žebříček: přihlášený mimo první desítku vidí pod ní svůj řádek', async () => {
  const { O, box } = setup();
  const top = Array.from({ length: 10 }, (_, i) => ({ place: i + 1, nickname: 'J' + i, best_time_s: String(60 + i), wins: 0 }));
  const route = { '/rest/v1/rpc/get_leaderboard': top, '/rest/v1/rpc/get_my_rank': { place: 37, nickname: 'Já', best_time_s: 75.5, wins: 0 },
    '/auth/v1/verify': { access_token: 'A1', refresh_token: 'R1', expires_in: 3600, user: { id: 'u1', email: 'a@b.cz' } },
    '/rest/v1/rpc/import_local_progress': { imported: true, money: 0 } };
  O._fetch = async (url) => {
    const path = url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
    const d = path.startsWith('/rest/v1/profiles') ? [{ nickname: 'Já', nickname_status: 'approved', money: 0, imported: true }]
      : path.startsWith('/rest/v1/purchases') ? [] : route[path];
    return { ok: true, status: 200, text: async () => JSON.stringify(d === undefined ? {} : d) };
  };
  await O.verify('a@b.cz', '123456');
  O._ui.open('board');
  await new Promise((r) => setTimeout(r, 60));
  const rows = box.find((e) => e.tag === 'tr');
  assert.strictEqual(rows.length, 12);                 // 10 + „…“ + můj řádek
  assert.match(rows[10].textContent, /…/);
  assert.strictEqual(rows[11].attrs.class || rows[11].className, 'me');
  assert.match(rows[11].textContent, /37\.Já75,500 s/);
});

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

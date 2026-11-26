/* Motol Simulator – online účty, synchronizace a žebříček (Supabase).
   Samostatný soubor bez knihoven. Když se nenačte nebo selže, hra běží dál jako dřív (jen v telefonu).
   Hra pozná tři věci: Online.report(...) po závodě, Online.loggedIn() a Online.buy(id) v obchodě. */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var CFG = {
    url: 'https://maiswaiilplgvewuurux.supabase.co',
    key: 'sb_publishable_O9_eyeEuS4QHe4q2jYgRZg_mDnHKm-o'   // veřejný klíč, smí být v kódu
  };
  var MODE_MAP = { kilo: 'kilometr', points: 'bodovacka', elim: 'vylucovacka' };
  var MODES = [['kilometr', 'Kilometr'], ['sprint', 'Sprint'], ['keirin', 'Keirin'], ['scratch', 'Scratch'],
    ['bodovacka', 'Bodovačka'], ['madison', 'Madison'], ['vylucovacka', 'Vylučovačka']];
  var MSG = {
    network: 'Nejde se připojit. Zkontroluj internet a zkus to znovu.',
    rate: 'Moc pokusů za sebou. Zkus to za chvíli.',
    bad_email: 'Zadej platný e-mail.',
    otp: 'Kód nesedí nebo vypršel. Zkus ho opsat znovu, případně si pošli nový.',
    invalid_nickname: 'Přezdívka musí mít 3 až 16 znaků a nesmí obsahovat < > & " \' \\',
    nickname_taken: 'Tahle přezdívka je už obsazená.',
    fail: 'Něco se nepovedlo. Zkus to znovu.'
  };

  var O = {};
  G.Online = O;
  var S = null;        // přihlášení: {access, refresh, exp, email}
  var P = null;        // profil ze serveru: {nickname, nickname_status, money, imported}
  var ui = function () {};

  /* ---------- úložiště ---------- */
  var LS = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function now() { return Math.floor(Date.now() / 1000); }
  function localVK() { return parseInt(LS.get('motol_vk') || '0', 10) || 0; }
  function setLocalVK(n) {
    LS.set('motol_vk', String(Math.max(0, Math.floor(n) || 0)));
    if (typeof G.updateVKBadge === 'function') { try { G.updateVKBadge(); } catch (e) {} }
  }
  function localOwned() { try { return JSON.parse(LS.get('motol_shop') || '{}') || {}; } catch (e) { return {}; } }
  function setLocalOwned(o) { LS.set('motol_shop', JSON.stringify(o)); }
  function saveSess() { if (S) LS.set('motol_session', JSON.stringify(S)); else LS.del('motol_session'); }
  function loadSess() {
    try { S = JSON.parse(LS.get('motol_session') || 'null'); } catch (e) { S = null; }
    if (S && !(S.access && S.refresh)) S = null;
  }

  /* ---------- síť ---------- */
  function F() { return O._fetch || G.fetch.bind(G); }
  function http(path, body, opts) {
    opts = opts || {};
    var h = { apikey: CFG.key, 'Content-Type': 'application/json' };
    if (opts.token) h.Authorization = 'Bearer ' + opts.token;
    return F()(CFG.url + path, {
      method: opts.method || 'POST', headers: h,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : null; } catch (e) {}
        return { ok: r.ok, status: r.status, data: d };
      });
    }).catch(function () { return { ok: false, status: 0, data: null }; });
  }
  function errCode(r) {
    if (!r || r.status === 0) return 'network';
    var d = r.data || {}, m = String(d.message || d.msg || d.error_description || d.error || '');
    if (r.status === 429 || d.error_code === 'over_email_send_rate_limit' || /rate.?limit|too many/i.test(m)) return 'rate';
    return m || ('http_' + r.status);
  }
  function msgFor(code) { return MSG[code] || MSG.fail; }

  var refreshing = null;
  function setSess(d, email) {
    S = {
      access: d.access_token, refresh: d.refresh_token,
      exp: d.expires_at || (now() + (d.expires_in || 3600)),
      email: (d.user && d.user.email) || email || (S && S.email) || ''
    };
    saveSess();
  }
  function token() {
    if (!S) return Promise.resolve(null);
    if (S.exp - 60 > now()) return Promise.resolve(S.access);
    if (refreshing) return refreshing;
    refreshing = http('/auth/v1/token?grant_type=refresh_token', { refresh_token: S.refresh }).then(function (r) {
      refreshing = null;
      if (r.ok && r.data && r.data.access_token) { setSess(r.data); return S.access; }
      if (r.status === 400 || r.status === 401 || r.status === 403) { S = null; P = null; saveSess(); ui(); }
      return null;
    });
    return refreshing;
  }
  function rpc(name, args, authed) {
    return token().then(function (t) {
      if (authed && !t) return { ok: false, status: 401, data: null };
      return http('/rest/v1/rpc/' + name, args || {}, { token: t || undefined });
    });
  }
  function getTable(path, t) { return http('/rest/v1/' + path, undefined, { method: 'GET', token: t }); }

  /* ---------- přihlášení ---------- */
  O.loggedIn = function () { return !!S; };
  O.email = function () { return S ? S.email : ''; };
  O.profile = function () { return P; };

  O.sendCode = function (email) {
    email = String(email || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.resolve({ ok: false, err: 'bad_email' });
    return http('/auth/v1/otp', { email: email, create_user: true }).then(function (r) {
      return r.ok ? { ok: true } : { ok: false, err: errCode(r) };
    });
  };
  O.verify = function (email, code) {
    email = String(email || '').trim();
    code = String(code || '').replace(/\s+/g, '');
    return http('/auth/v1/verify', { type: 'email', email: email, token: code }).then(function (r) {
      if (r.ok && r.data && r.data.access_token) {
        setSess(r.data, email);
        return O.sync().then(function () { return { ok: true }; });
      }
      return { ok: false, err: r.status === 0 ? 'network' : r.status === 429 ? 'rate' : 'otp' };
    });
  };
  O.signOut = function () {
    var t = S && S.access;
    S = null; P = null; saveSess();
    LS.del('motol_outbox');
    setLocalVK(0); setLocalOwned({});
    if (t) http('/auth/v1/logout', {}, { token: t });
    ui();
  };

  /* ---------- synchronizace účtu s hrou ---------- */
  var syncing = null;
  function getProfile(t) {
    return getTable('profiles?select=nickname,nickname_status,money,imported', t).then(function (r) {
      return r.ok && Array.isArray(r.data) ? (r.data[0] || null) : undefined;   // undefined = chyba
    });
  }
  function doSync() {
    return token().then(function (t) {
      if (!t) return false;
      return getProfile(t).then(function (p) {
        if (p === undefined) return false;
        var step = (p && p.imported) ? Promise.resolve(p)
          : rpc('import_local_progress', { p_money: localVK(), p_owned: Object.keys(localOwned()) }, true)
              .then(function () { return getProfile(t); });
        return step.then(function (p2) {
          if (!p2 || !p2.imported) return false;      // převod se nepovedl: místní postup nepřepisujeme
          P = p2;
          return getTable('purchases?select=item_id', t).then(function (r) {
            if (r.ok && Array.isArray(r.data)) {
              var o = {}; r.data.forEach(function (x) { o[x.item_id] = 1; });
              setLocalOwned(o);
            }
            setLocalVK(P.money);
            flush();
            return true;
          });
        });
      });
    });
  }
  O.sync = function () {
    if (!S) return Promise.resolve(false);
    if (syncing) return syncing;
    syncing = doSync().then(function (ok) { syncing = null; ui(); return ok; },
                            function () { syncing = null; return false; });
    return syncing;
  };

  /* ---------- odeslání výsledku po závodě ---------- */
  function outbox() { try { return JSON.parse(LS.get('motol_outbox') || '[]') || []; } catch (e) { return []; } }
  function saveOutbox(a) { LS.set('motol_outbox', JSON.stringify(a.slice(-20))); }
  O.report = function (x) {
    try {
      if (!S || !x) return;
      var m = MODE_MAP[x.mode] || x.mode;
      var t = (typeof x.time === 'number' && isFinite(x.time) && x.time >= 30 && x.time <= 600)
        ? Math.round(x.time * 1000) / 1000 : null;
      var p = (typeof x.points === 'number' && isFinite(x.points)) ? Math.round(x.points) : null;
      var r = (x.position >= 1 && x.position <= 12) ? Math.round(x.position) : null;
      if (m === 'kilometr') r = t !== null ? 1 : null;
      var w = Math.max(0, Math.min(400, Math.round(x.reward || 0)));
      var a = outbox();
      a.push({ m: m, t: t, p: p, r: r, w: w, e: S.email });
      saveOutbox(a);
      flush();
    } catch (e) {}
  };
  var flushing = false, retryT = null;
  function later(ms) {
    clearTimeout(retryT); retryT = setTimeout(flush, ms);
    if (retryT && retryT.unref) retryT.unref();
  }
  O.flush = function () { flush(); };
  function flush() {
    if (flushing || !S) return;
    var a = outbox();
    if (!a.length) return;
    var it = a[0];
    if (it.e && S.email && it.e !== S.email) { a.shift(); saveOutbox(a); return flush(); }   // cizí účet
    flushing = true;
    rpc('submit_result', { p_mode: it.m, p_time_s: it.t, p_points: it.p, p_position: it.r, p_reward: it.w }, true)
      .then(function (res) {
        flushing = false;
        var wait = 0, q = outbox();
        if (res.ok) {
          q.shift(); saveOutbox(q); wait = 6000;
          if (res.data && typeof res.data.money === 'number') {
            if (P) P.money = res.data.money;
            setLocalVK(res.data.money);
          }
          ui();
        } else {
          var c = errCode(res);
          if (res.status === 0 || res.status >= 500 || res.status === 401 || c === 'rate' || /too_fast/.test(c)) wait = 30000;
          else { q.shift(); saveOutbox(q); wait = 1000; }   // nepřijatelný záznam zahodíme
        }
        if (wait && outbox().length) later(wait);
      });
  }

  /* ---------- obchod, přezdívka, žebříček ---------- */
  O.buy = function (id) {
    return rpc('buy_item', { p_item_id: id }, true).then(function (r) {
      if (r.ok && typeof r.data === 'number') {
        var o = localOwned(); o[id] = 1; setLocalOwned(o);
        if (P) P.money = r.data;
        setLocalVK(r.data);
        if (typeof G.renderShop === 'function') { try { G.renderShop(); } catch (e) {} }
        return { ok: true };
      }
      return { ok: false, err: errCode(r) };
    });
  };
  O.setNickname = function (n) {
    return rpc('set_nickname', { p_nickname: String(n || '').trim() }, true).then(function (r) {
      if (r.ok) {
        if (P) { P.nickname = String(n).trim(); P.nickname_status = 'pending'; }
        ui();
        return { ok: true };
      }
      return { ok: false, err: errCode(r) };
    });
  };
  O.leaderboard = function (mode) {
    return rpc('get_leaderboard', { p_mode: mode, p_limit: 30 }, false).then(function (r) {
      return r.ok && Array.isArray(r.data) ? { ok: true, rows: r.data } : { ok: false, err: errCode(r) };
    });
  };

  /* ---------- okna ---------- */
  function initUI() {
    if (typeof document === 'undefined' || !document.body) return;
    var st = document.createElement('style');
    st.textContent =
      '#onlineBar{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 14px}' +
      '.onb{font:inherit;font-size:13px;font-weight:800;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);border-radius:12px;padding:8px 12px;cursor:pointer}' +
      '#onlineOv{position:fixed;left:0;top:0;right:0;bottom:0;z-index:90;display:none;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;background:rgba(5,12,28,.78)}' +
      '#onlineOv .oc{background:#fffdf5;color:#1a1a1a;border-radius:16px;padding:16px;max-width:440px;width:100%;max-height:100%;overflow:auto;box-sizing:border-box;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:15px;line-height:1.4;text-align:left}' +
      '#onlineOv,#onlineOv *{-webkit-user-select:text;user-select:text}' +
      '#onlineOv .oc{touch-action:pan-y}' +
      '#onlineOv .oi{touch-action:manipulation;-webkit-appearance:none;appearance:none}' +
      '#onlineOv h2{margin:0 0 8px;font-size:18px}' +
      '#onlineOv p{margin:0 0 10px}' +
      '#onlineOv .oi{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:18px;padding:10px 12px;margin:0 0 10px;border:2px solid #cfc9b8;border-radius:10px;background:#fff;color:#111}' +
      '#onlineOv .ob{font:inherit;font-size:14px;font-weight:800;border:0;border-radius:10px;padding:10px 14px;margin:0 6px 6px 0;cursor:pointer;background:#e63946;color:#fff}' +
      '#onlineOv .ob.alt{background:#d9d4c7;color:#222}' +
      '#onlineOv .om{min-height:20px;font-size:13px;font-weight:700;color:#b3261e;margin:0 0 8px}' +
      '#onlineOv .ot{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}' +
      '#onlineOv .ot button{font:inherit;font-size:12px;font-weight:800;border:0;border-radius:8px;padding:6px 8px;background:#e8e3d3;color:#222;cursor:pointer}' +
      '#onlineOv .ot button.on{background:#1a1a1a;color:#c6ff1a}' +
      '#onlineOv table{width:100%;border-collapse:collapse;font-size:14px}' +
      '#onlineOv td{padding:5px 4px;border-top:1px solid #0001}' +
      '#onlineOv tr.me td{font-weight:900;background:#c6ff1a55}' +
      '#onlineOv td.gold{font-weight:900;color:transparent;background:linear-gradient(100deg,#b8860b 0%,#ffd700 30%,#fff6b0 50%,#ffd700 70%,#b8860b 100%) 0 0/250% 100%;-webkit-background-clip:text;background-clip:text;animation:onGold 2.4s linear infinite}' +
      '@keyframes onGold{0%{background-position:150% 0}100%{background-position:-100% 0}}' +
      '@media (prefers-reduced-motion:reduce){#onlineOv td.gold{animation:none}}' +
      '#onlineOv .os{font-size:12px;opacity:.7}';
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.id = 'onlineOv';
    var box = document.createElement('div');
    box.className = 'oc';
    ov.appendChild(box);
    document.body.appendChild(ov);
    ['keydown', 'keyup', 'keypress', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'wheel'].forEach(function (ev) {
      ov.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    // když je okno otevřené, klávesy (např. číslice) nesmí spustit závod na pozadí
    window.addEventListener('keydown', function (e) {
      if (ov.style.display === 'flex' && !ov.contains(e.target)) e.stopImmediatePropagation();
    }, true);

    function h(tag, attrs, kids) {
      var e = document.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) {
        if (k === 'text') e.textContent = attrs[k];
        else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
        else e.setAttribute(k, attrs[k]);
      });
      (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      return e;
    }
    var cur = 'login', ctx = { email: '', msg: '', busy: false, boardMode: 'kilometr', confirmOut: false };
    function open(v) { cur = v; ctx.msg = ''; ctx.confirmOut = false; ov.style.display = 'flex'; render(); }
    function close() { ov.style.display = 'none'; }
    function setMsg(m) { ctx.msg = m; render(); }

    function render() {
      box.innerHTML = '';
      if (cur === 'login') viewLogin();
      else if (cur === 'code') viewCode();
      else if (cur === 'nick') viewNick();
      else if (cur === 'account') viewAccount();
      else viewBoard();
    }
    function closeBtn(label) { return h('button', { class: 'ob alt', text: label || 'Zavřít', on: { click: close } }); }

    function viewLogin() {
      var inp = h('input', { class: 'oi', type: 'email', placeholder: 'tvůj@e-mail.cz', autocomplete: 'email', maxlength: '120' });
      inp.value = ctx.email;
      function go() {
        if (ctx.busy) return; ctx.email = inp.value.trim(); ctx.busy = true; ctx.msg = 'Posílám kód…'; render();
        O.sendCode(ctx.email).then(function (r) {
          ctx.busy = false;
          if (r.ok) { cur = 'code'; ctx.msg = ''; render(); } else setMsg(msgFor(r.err));
        });
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(h('h2', { text: '👤 Přihlášení' }));
      box.appendChild(h('p', { text: 'Pošleme ti na e-mail šestimístný kód. Žádné heslo. S účtem se ti peníze, nákupy a výsledky uloží a půjdou s tebou na každý telefon.' }));
      box.appendChild(inp);
      box.appendChild(h('div', { class: 'om', text: ctx.msg }));
      box.appendChild(h('button', { class: 'ob', text: 'Poslat kód', on: { click: go } }));
      box.appendChild(closeBtn());
      box.appendChild(h('div', { class: 'os', text: 'Ukládáme jen e-mail, přezdívku, výsledky a penízky. Účet jde kdykoli smazat na požádání.' }));
    }
    function viewCode() {
      var inp = h('input', { class: 'oi', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'kód z e-mailu', maxlength: '10' });
      function go() {
        if (ctx.busy) return; ctx.busy = true; ctx.msg = 'Ověřuju…'; render();
        O.verify(ctx.email, inp.value).then(function (r) {
          ctx.busy = false;
          if (r.ok) { open(P && !P.nickname ? 'nick' : 'account'); } else setMsg(msgFor(r.err));
        });
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(h('h2', { text: '📧 Zadej kód' }));
      box.appendChild(h('p', { text: 'Poslali jsme kód na ' + ctx.email + '. Mrkni i do spamu.' }));
      box.appendChild(inp);
      box.appendChild(h('div', { class: 'om', text: ctx.msg }));
      box.appendChild(h('button', { class: 'ob', text: 'Přihlásit', on: { click: go } }));
      box.appendChild(h('button', { class: 'ob alt', text: 'Poslat znovu', on: { click: function () { cur = 'login'; ctx.msg = ''; render(); } } }));
      box.appendChild(closeBtn());
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
    }
    function viewNick() {
      var inp = h('input', { class: 'oi', type: 'text', maxlength: '16', placeholder: 'přezdívka (3–16 znaků)', autocomplete: 'nickname' });
      inp.value = (P && P.nickname) || '';
      function go() {
        if (ctx.busy) return; ctx.busy = true; ctx.msg = 'Ukládám…'; render();
        O.setNickname(inp.value).then(function (r) {
          ctx.busy = false;
          if (r.ok) open('account'); else setMsg(msgFor(r.err));
        });
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(h('h2', { text: '✏️ Přezdívka' }));
      box.appendChild(h('p', { text: 'Pod touhle přezdívkou se ukážeš v žebříčku. Nejdřív ji schválíme, do té doby hraješ a vyděláváš normálně.' }));
      box.appendChild(inp);
      box.appendChild(h('div', { class: 'om', text: ctx.msg }));
      box.appendChild(h('button', { class: 'ob', text: 'Uložit', on: { click: go } }));
      box.appendChild(closeBtn('Později'));
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
    }
    function statusText() {
      if (!P || !P.nickname) return 'zatím žádná';
      var s = P.nickname_status === 'approved' ? 'schválená' : P.nickname_status === 'rejected' ? 'zamítnutá, zvol jinou' : 'čeká na schválení';
      return P.nickname + ' (' + s + ')';
    }
    function viewAccount() {
      box.appendChild(h('h2', { text: '👤 Účet' }));
      box.appendChild(h('p', { text: 'E-mail: ' + (S ? S.email : '') }));
      box.appendChild(h('p', { text: 'Přezdívka: ' + statusText() }));
      box.appendChild(h('p', { text: 'Penízky: 💰 ' + (P ? P.money : localVK()) }));
      box.appendChild(h('button', { class: 'ob', text: 'Změnit přezdívku', on: { click: function () { open('nick'); } } }));
      if (!ctx.confirmOut) {
        box.appendChild(h('button', { class: 'ob alt', text: 'Odhlásit', on: { click: function () { ctx.confirmOut = true; render(); } } }));
      } else {
        box.appendChild(h('p', { class: 'om', text: 'Po odhlášení se na tomhle telefonu vynulují penízky a nákupy. Na účtu zůstanou a načtou se po dalším přihlášení.' }));
        box.appendChild(h('button', { class: 'ob', text: 'Ano, odhlásit', on: { click: function () { O.signOut(); close(); } } }));
        box.appendChild(h('button', { class: 'ob alt', text: 'Zpět', on: { click: function () { ctx.confirmOut = false; render(); } } }));
      }
      box.appendChild(closeBtn());
    }
    function fmtRow(mode, r) {
      if (mode === 'kilometr') return r.best_time_s == null ? '–' : Number(r.best_time_s).toFixed(3).replace('.', ',') + ' s';
      if (mode === 'bodovacka' || mode === 'madison') return (r.best_points == null ? '–' : r.best_points + ' b');
      return (r.wins || 0) + '× vítěz';
    }
    function viewBoard() {
      box.appendChild(h('h2', { text: '🏆 Žebříček' }));
      var tabs = h('div', { class: 'ot' });
      MODES.forEach(function (m) {
        tabs.appendChild(h('button', { text: m[1], class: m[0] === ctx.boardMode ? 'on' : '',
          on: { click: function () { ctx.boardMode = m[0]; render(); } } }));
      });
      box.appendChild(tabs);
      var list = h('div', { text: 'Načítám…' });
      box.appendChild(list);
      box.appendChild(closeBtn());
      var mode = ctx.boardMode;
      O.leaderboard(mode).then(function (r) {
        if (cur !== 'board' || ctx.boardMode !== mode) return;
        list.textContent = '';
        if (!r.ok) { list.textContent = msgFor(r.err); return; }
        if (!r.rows.length) { list.textContent = 'Zatím tu nikdo není. Buď první!'; return; }
        var tb = h('table');
        r.rows.forEach(function (x) {
          var mine = P && P.nickname && x.nickname === P.nickname;
          tb.appendChild(h('tr', { class: mine ? 'me' : '' }, [
            h('td', { text: x.place + '.' }), h('td', { text: String(x.nickname), class: x.badge === 'gold' ? 'gold' : '' }), h('td', { text: fmtRow(mode, x), style: 'text-align:right' })]));
        });
        list.appendChild(tb);
      });
    }

    /* lišta v menu: žebříček a účet */
    var bar = document.getElementById('onlineBar');
    if (!bar) {
      bar = h('div', { id: 'onlineBar' });
      var vk = document.querySelector('.vk');
      if (vk && vk.parentNode) vk.parentNode.insertBefore(bar, vk.nextSibling);
      else { var mc = document.querySelector('#menu .card'); if (mc) mc.appendChild(bar); }
    }
    function drawBar() {
      bar.innerHTML = '';
      bar.appendChild(h('button', { class: 'onb', text: '🏆 Žebříček', on: { click: function () { open('board'); } } }));
      var label = S ? ('👤 ' + ((P && P.nickname) || (S.email || '').split('@')[0])) : '👤 Přihlásit se';
      bar.appendChild(h('button', { class: 'onb', text: label, on: { click: function () {
        if (!S) open('login'); else if (P && !P.nickname) open('nick'); else open('account'); } } }));
    }
    ui = function () {
      try {
        drawBar();
        if (ov.style.display === 'flex' && (cur === 'account')) render();
      } catch (e) {}
    };
    O._ui = { open: open, render: render, get: function () { return { cur: cur, ctx: ctx }; } };
    drawBar();
  }

  /* ---------- start ---------- */
  O.init = function () {
    try {
      loadSess();
      initUI();
      if (S) O.sync();
    } catch (e) {}
  };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', O.init);
    else O.init();
  }
  if (typeof module !== 'undefined') module.exports = O;
})();

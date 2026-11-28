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
  var MODE_MAP = { kilo: 'kilometr', points: 'bodovacka', elim: 'vylucovacka', teamsprint: 'team_sprint' };
  var MODES = [['kilometr', 'Kilometr'], ['sprint', 'Sprint'], ['keirin', 'Keirin'], ['scratch', 'Scratch'],
    ['bodovacka', 'Bodovačka'], ['madison', 'Madison'], ['vylucovacka', 'Vylučovačka'],
    ['omnium', 'Omnium'], ['team_sprint', 'Team sprint']];
  var MSG = {
    network: 'Nejde se připojit. Zkontroluj internet a zkus to znovu.',
    rate: 'Moc pokusů za sebou. Zkus to za chvíli.',
    bad_email: 'Zadej platný e-mail.',
    otp: 'Kód nesedí nebo vypršel. Zkus ho opsat znovu, případně si pošli nový.',
    invalid_nickname: 'Přezdívka musí mít 3 až 16 znaků a nesmí obsahovat < > & " \' \\',
    nickname_taken: 'Tahle přezdívka je už obsazená.',
    feedback_short: 'Napiš aspoň pár slov.',
    feedback_long: 'Zpráva je moc dlouhá, max. 1000 znaků.',
    feedback_limit: 'Dnes jsi poslal už 20 návrhů. Další můžeš zítra.',
    coach_name_short: 'Napiš jméno trenéra (aspoň 2 znaky).',
    coach_name_long: 'Jméno trenéra je moc dlouhé, max. 30 znaků.',
    coach_look_short: 'Popiš, jak má trenér vypadat.',
    coach_look_long: 'Popis je moc dlouhý, max. 600 znaků.',
    coach_behavior_long: 'Popis chování je moc dlouhý, max. 300 znaků.',
    coach_limit: 'Dnes jsi už poslal 5 žádostí. Další můžeš zítra.',
    not_authenticated: 'Nejdřív se přihlas.',
    fail: 'Něco se nepovedlo. Zkus to znovu.'
  };

  var O = {};
  G.Online = O;
  var S = null;        // přihlášení: {access, refresh, exp, email}
  var P = null;        // profil ze serveru: {nickname, nickname_status, money, imported, coach}
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
  function setLocalOwned(o) {
    LS.set('motol_shop', JSON.stringify(o));
    if (typeof G.renderShop === 'function') { try { G.renderShop(); } catch (e) {} }   // hra překreslí obchod a nasadí koupené disky
  }
  function saveSess() { if (S) LS.set('motol_session', JSON.stringify(S)); else LS.del('motol_session'); }
  function loadSess() {
    try { S = JSON.parse(LS.get('motol_session') || 'null'); } catch (e) { S = null; }
    if (S && !(S.access && S.refresh)) S = null;
  }
  /* přihlášení uložené jinou kartou / novější verzí stránky (Supabase obnovovací klíč použije jen jednou) */
  function storedSess() {
    var x = null; try { x = JSON.parse(LS.get('motol_session') || 'null'); } catch (e) {}
    return x && x.access && x.refresh ? x : null;
  }
  function adoptStored() {   // jiná karta už klíč obnovila: vezmi si její
    var x = storedSess();
    if (x && S && x.refresh !== S.refresh) { S = x; return true; }
    return false;
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
  function token(minLeft) {
    if (!S) return Promise.resolve(null);
    adoptStored();
    if (S.exp - (minLeft || 60) > now()) return Promise.resolve(S.access);
    if (refreshing) return refreshing;
    var used = S.refresh;
    var ask = function (tries) {
      return http('/auth/v1/token?grant_type=refresh_token', { refresh_token: S.refresh }).then(function (r) {
        if (r.ok && r.data && r.data.access_token) { setSess(r.data); return S.access; }
        if (!S) return null;
        if (adoptStored()) return S.exp - 30 > now() ? S.access : (tries > 0 ? ask(tries - 1) : null);   // mezitím obnovila jiná karta
        if ((r.status === 400 || r.status === 401 || r.status === 403) && S.refresh === used) {
          if (tries > 0) return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return adoptStored() ? token(minLeft) : ask(tries - 1); });
          var x = storedSess();   // odhlásit jen, když úložiště drží pořád ten neplatný klíč
          S = null; P = null; if (!x || x.refresh === used) LS.del('motol_session'); ui();
        }
        return null;   // výpadek sítě: přihlášení zůstává, zkusí se to příště
      });
    };
    refreshing = ask(1).then(function (t) { refreshing = null; return t; }, function () { refreshing = null; return null; });
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
  /* pro multi.js (plocha online): platný token, id účtu a veřejná jména hráčů */
  O.accessToken = function (minLeft) { return token(minLeft); };
  O.uid = function () {
    try { var b = S.access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(G.atob(b)))).sub || null; } catch (e) { return null; }
  };
  O.names = function (ids) {
    return rpc('get_public_names', { p_ids: ids }, true).then(function (r) { return r.ok && Array.isArray(r.data) ? r.data : []; });
  };
  O.config = function () { return { url: CFG.url, key: CFG.key }; };
  /* pro race-net.js (online závod): STUN/TURN servery z Edge Function turn-credentials (krátkodobé údaje, drží se do vypršení) */
  var ice = null;
  O.iceServers = function () {
    if (ice && ice.until > Date.now()) return Promise.resolve(ice.list);
    return token().then(function (t) {
      if (!t) throw new Error('auth');
      return http('/functions/v1/turn-credentials', {}, { token: t });
    }).then(function (r) {
      var l = r.ok && r.data && Array.isArray(r.data.iceServers) ? r.data.iceServers : null;
      if (!l || !l.length) throw new Error('ice');
      ice = { list: l, until: Date.now() + Math.max(60, (+r.data.ttl || 3600) - 300) * 1000 };
      return l;
    });
  };

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
    coachOut();
    setLocalVK(0); setLocalOwned({});
    if (t) http('/auth/v1/logout', {}, { token: t });
    ui();
  };

  /* ---------- synchronizace účtu s hrou ---------- */
  var syncing = null;
  function getProfile(t) {
    return getTable('profiles?select=nickname,nickname_status,money,imported,coach', t).then(function (r) {
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
          coachOut();
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
  /* začátek závodu: server si zapíše čas startu (race_start); výsledek pak jde přes race_finish s kontrolou věrohodnosti.
     raceKey = společné id online závodu od hostitele (jinak null). Bez připojení zůstane výsledek neověřený (submit_result). */
  var race = null;
  O.raceStart = function (mode, raceKey) {
    if (!S) { race = null; return Promise.resolve(null); }
    var m = MODE_MAP[mode] || mode, R = { m: m, id: null, at: Date.now() };
    race = R;
    R.p = rpc('race_start', { p_mode: m, p_race_key: raceKey || null }, true).then(function (r) {
      R.id = r.ok && typeof r.data === 'string' ? r.data : null; R.done = true; return R.id;
    });
    return R.p;
  };
  O.raceSession = function () { return race; };
  O.report = function (x, R0) {
    try {
      if (!S || !x) return;
      var R = R0 !== undefined ? R0 : race;
      if (R0 === undefined) race = null;
      if (R && !R.done && R.p) {   // race_start ještě neodpověděl: počkej na něj (se sezením tohohle závodu, ne dalšího)
        R.p.then(function () { O.report(x, R); }); return;
      }
      var m = MODE_MAP[x.mode] || x.mode;
      var t = (typeof x.time === 'number' && isFinite(x.time) && x.time >= 30 && x.time <= 600)
        ? Math.round(x.time * 1000) / 1000 : null;
      var p = (typeof x.points === 'number' && isFinite(x.points)) ? Math.round(x.points) : null;
      var r = (x.position >= 1 && x.position <= 12) ? Math.round(x.position) : null;
      if (m === 'kilometr') r = t !== null ? 1 : null;
      var w = Math.max(0, Math.min(400, Math.round(x.reward || 0)));
      var a = outbox();
      var it = { m: m, t: t, p: p, r: r, w: w, e: S.email, at: Date.now() };
      if (R && R.id && R.m === m) {
        it.s = R.id; it.d = !!x.dnf;
        var ex = x.extra || {}, xo = {};
        ['beer', 'lap', 's0', 's1'].forEach(function (k) { var v = +ex[k]; if (isFinite(v) && v > 0) xo[k] = Math.round(v); });
        it.x = xo;
        if (Array.isArray(x.order)) it.o = x.order.slice(0, 12).map(function (u) { return typeof u === 'string' && /^[0-9a-f-]{36}$/.test(u) ? u : null; });
      }
      a.push(it);
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
    (it.s ? rpc('race_finish', { p_session: it.s, p_time_s: it.t, p_points: it.p, p_position: it.r, p_dnf: !!it.d, p_extra: it.x || {}, p_order: it.o || null }, true)
      : rpc('submit_result', { p_mode: it.m, p_time_s: it.t, p_points: it.p, p_position: it.r, p_reward: it.w }, true))
      .then(function (res) {
        flushing = false;
        var wait = 0, q = outbox();
        if (res.ok) {
          q.shift(); saveOutbox(q); wait = 6000;
          if (res.data && typeof res.data.money === 'number') {
            if (P) P.money = res.data.money;
            setLocalVK(res.data.money);
          }
          if (res.data && res.data.rejected) { if (it.at && Date.now() - it.at < 10 * 60 * 1000) O.toast('⚠️ Výsledek server neuznal (nevěrohodný čas závodu).'); }
          else if (res.data && it.at && Date.now() - it.at < 10 * 60 * 1000) O.toast(O.recordNote(it.m, res.data));
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
  /* návrh na zlepšení: jen pro přihlášené, ukládá se do tabulky feedback (čte ji autor hry) */
  O.sendFeedback = function (text) {
    var t = String(text || '').trim();
    if (t.length < 3) return Promise.resolve({ ok: false, err: 'feedback_short' });
    if (t.length > 1000) return Promise.resolve({ ok: false, err: 'feedback_long' });
    return rpc('submit_feedback', { p_message: t }, true).then(function (r) {
      if (r.ok) return { ok: true };
      return { ok: false, err: r.status === 401 ? 'not_authenticated' : errCode(r) };
    });
  };

  /* vlastní trenér: hráč pošle jméno a popis, autor hry podle něj vyplní profiles.coach (vidí ho jen tenhle účet) */
  function coachOut() { try { if (typeof G.applyCoach === 'function') G.applyCoach(P && P.coach && typeof P.coach === 'object' ? P.coach : null); } catch (e) {} }
  O.coach = function () { return P && P.coach && typeof P.coach === 'object' ? P.coach : null; };
  O.sendCoach = function (name, look, behavior) {
    var n = String(name || '').trim(), l = String(look || '').trim(), b = String(behavior || '').trim();
    if (n.length < 2) return Promise.resolve({ ok: false, err: 'coach_name_short' });
    if (n.length > 30) return Promise.resolve({ ok: false, err: 'coach_name_long' });
    if (l.length < 5) return Promise.resolve({ ok: false, err: 'coach_look_short' });
    if (l.length > 600) return Promise.resolve({ ok: false, err: 'coach_look_long' });
    if (b.length > 300) return Promise.resolve({ ok: false, err: 'coach_behavior_long' });
    return rpc('submit_coach', { p_name: n, p_look: l, p_behavior: b }, true).then(function (r) {
      if (r.ok) return { ok: true };
      return { ok: false, err: r.status === 401 ? 'not_authenticated' : errCode(r) };
    });
  };
  /* poslední žádost o trenéra ({name, look, behavior, status}) nebo null */
  O.myCoachRequest = function () {
    return token().then(function (t) {
      if (!t) return { ok: false, err: 'not_authenticated' };
      return getTable('coach_requests?select=name,look,behavior,status&order=created_at.desc&limit=1', t).then(function (r) {
        return r.ok && Array.isArray(r.data) ? { ok: true, req: r.data[0] || null } : { ok: false, err: errCode(r) };
      });
    });
  };

  O.leaderboard = function (mode) {
    return rpc('get_leaderboard', { p_mode: mode, p_limit: 10 }, false).then(function (r) {
      return r.ok && Array.isArray(r.data) ? { ok: true, rows: r.data.slice(0, 10) } : { ok: false, err: errCode(r) };
    });
  };

  /* moje pořadí v disciplíně (i mimo první desítku); null = ještě jsem ji nejel */
  O.myRank = function (mode) {
    if (!S) return Promise.resolve({ ok: false, err: 'not_authenticated' });
    return rpc('get_my_rank', { p_mode: mode }, true).then(function (r) {
      return r.ok ? { ok: true, row: r.data && typeof r.data === 'object' ? r.data : null } : { ok: false, err: errCode(r) };
    });
  };

  /* hláška po závodě: osobní rekord, vstup do TOP 10, posun v pořadí */
  var MODE_NAME = {};
  MODES.forEach(function (m) { MODE_NAME[m[0]] = m[1]; });
  O.recordNote = function (mode, d) {
    if (!d || typeof d !== 'object') return '';
    var name = MODE_NAME[mode] || mode, out = [];
    var pl = typeof d.place === 'number' ? d.place : null, pp = typeof d.prev_place === 'number' ? d.prev_place : null;
    if (d.pb) out.push('⭐ Nový osobní rekord – ' + name + '!');
    if (d.approved && pl !== null && pl <= 10) {
      if (pp === null || pp > 10) out.push('🏆 Jsi v TOP 10! ' + pl + '. místo – ' + name);
      else if (pl < pp) out.push('▲ Posun na ' + pl + '. místo – ' + name);
    }
    return out.join('\n');
  };
  var toastT = null;
  O.toast = function (text) {
    if (!text || typeof document === 'undefined' || !document.body) return;
    var el = document.getElementById('onlineToast');
    if (!el) {
      el = document.createElement('div'); el.id = 'onlineToast';
      el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:95;max-width:90%;box-sizing:border-box;' +
        'padding:10px 16px;border-radius:14px;background:rgba(10,20,40,.92);color:#fff;border:2px solid #ffd700;' +
        'font:800 15px/1.35 system-ui,sans-serif;text-align:center;white-space:pre-line;pointer-events:none;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.5);transition:opacity .4s;opacity:0';
      document.body.appendChild(el);
    }
    el.textContent = text; el.style.display = 'block';
    setTimeout(function () { el.style.opacity = '1'; }, 20);
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.style.display = 'none'; }, 450); }, 5000);
    if (toastT && toastT.unref) toastT.unref();
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
      '#onlineOv span.gold{font-weight:900;color:#c99700}' +
      '.obd{text-align:left;font-size:14px}.obd .ot{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px}' +
      '.obd .ot button{font:inherit;font-size:12px;font-weight:800;border:0;border-radius:8px;padding:6px 8px;background:rgba(255,255,255,.14);color:#fff;cursor:pointer}' +
      '.obd .ot button.on{background:#c6ff1a;color:#111}.obd table{width:100%;border-collapse:collapse}.obd td{padding:5px 4px;border-top:1px solid #fff2}' +
      '.obd tr.me td{font-weight:900;color:#c6ff1a}.obd span.gold{font-weight:900;color:#ffd700}' +
      '@supports ((-webkit-background-clip:text) or (background-clip:text)){#onlineOv span.gold,.obd span.gold{color:transparent;-webkit-text-fill-color:transparent;background-image:linear-gradient(100deg,#a67400 0%,#ffd700 30%,#fff6b0 50%,#ffd700 70%,#a67400 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;animation:onGold 2.4s linear infinite}}' +
      '@keyframes onGold{0%{background-position:150% 0}100%{background-position:-100% 0}}' +
      '@media (prefers-reduced-motion:reduce){#onlineOv span.gold,.obd span.gold{animation:none}}' +
      '#onlineOv span.gb,.obd span.gb{display:inline-block;margin-left:5px;padding:1px 4px 0;border-radius:4px;font-size:9px;font-weight:900;letter-spacing:.5px;line-height:1.3;vertical-align:2px;color:#3a2a00;background:linear-gradient(135deg,#a67400,#ffd700 45%,#fff6b0 55%,#c99700);box-shadow:0 0 0 1px #0003}' +
      '#onlineOv .os{font-size:12px;opacity:.7}' +
      '#onlineOv .olk{font:inherit;font-size:12px;background:none;border:0;padding:6px 0 0;color:#555;text-decoration:underline;cursor:pointer;display:block}' +
      '#onlineOv textarea.oi{font-size:16px;min-height:120px;resize:vertical;line-height:1.35}' +
      '#onlineOv .oq{display:flex;gap:10px;align-items:flex-start;margin:0 0 10px}' +
      '#onlineOv .oq b{flex:none;font-size:30px;line-height:1}' +
      '#onlineOv .oq p{margin:0;background:#efe9da;border-radius:12px;padding:8px 11px;font-weight:700}' +
      '#onlineOv .ocn{font-size:12px;text-align:right;margin:-6px 0 6px;opacity:.65}' +
      '#onlineOv .ook{font-size:15px;font-weight:800;color:#1d7a35;margin:0 0 10px}';
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
    var cur = 'login', ctx = { email: '', msg: '', busy: false, boardMode: 'kilometr', confirmOut: false, after: '', fb: '', fbSent: false, back: '' };
    function open(v) { cur = v; ctx.msg = ''; ctx.confirmOut = false; if (v !== 'login' && v !== 'code' && v !== 'nick' && v !== 'feedback' && v !== 'coach') ctx.after = ''; ov.style.display = 'flex'; render(); }
    function close() { ov.style.display = 'none'; ctx.after = ''; }
    function afterLogin(def) { var a = ctx.after; ctx.after = ''; if (a === 'mp') mpCheck(); else open(a || def); }
    /* plocha online: jen přihlášený hráč s přezdívkou (ne zamítnutou) */
    function mpCheck() {
      if (!S) { open('mpLogin'); return; }
      function go() {
        if (!S) { open('mpLogin'); return; }
        if (!P) { ctx.mpGo = null; open('mpErr'); return; }
        if (!P.nickname || P.nickname_status === 'rejected') { open('nick'); ctx.after = 'mp'; render(); return; }
        var f = ctx.mpGo; ctx.mpGo = null; close(); if (f) f();
      }
      if (P) go(); else O.sync().then(go, go);
    }
    O.multi = function (start) { ctx.mpGo = start; mpCheck(); };
    function setMsg(m) { ctx.msg = m; render(); }

    function render() {
      box.innerHTML = '';
      if (cur === 'login') viewLogin();
      else if (cur === 'code') viewCode();
      else if (cur === 'nick') viewNick();
      else if (cur === 'account') viewAccount();
      else if (cur === 'feedback') viewFeedback();
      else if (cur === 'fbLogin') viewFbLogin();
      else if (cur === 'coach') viewCoach();
      else if (cur === 'coachLogin') viewCoachLogin();
      else if (cur === 'privacy') viewPrivacy();
      else if (cur === 'mpLogin') viewMpLogin();
      else if (cur === 'mpErr') viewMpErr();
      else viewBoard();
    }
    function privacyLink() { return h('button', { class: 'olk', text: 'Jak nakládáme s údaji', on: { click: function () { ctx.back = cur; cur = 'privacy'; ctx.msg = ''; render(); } } }); }
    var CONTACT = 'pavellehkyy@gmail.com';
    function viewPrivacy() {
      function sec(t, body) { box.appendChild(h('p', null, [h('b', { text: t + ' ' }), body])); }
      box.appendChild(h('h2', { text: '🔒 Jak nakládáme s údaji' }));
      sec('Kdo:', 'Hru Motol Simulator provozuje její autor. Kontakt: ' + CONTACT + '.');
      sec('Bez účtu:', 'nic neodesíláme. Postup, penízky a vybavení se ukládají jen v tvém prohlížeči.');
      sec('S účtem ukládáme:', 'e-mail, přezdívku, výsledky závodů, penízky, nákupy, návrhy ze schránky a žádosti o vlastního trenéra (jméno, popis vzhledu a chování). E-mail používáme jen k přihlášení: posíláme na něj jednorázový kód (přes přihlašovací službu Supabase) a nic jiného. Účet je dobrovolný; bez e-mailu ho založit nejde, ale celá hra kromě žebříčku a online hry jde hrát i bez něj.');
      sec('Proč:', 'aby fungoval účet, žebříček a obchod (to je služba, o kterou sis řekl) a abychom ze souhrnných statistik hraní poznali, co vylepšit (oprávněný zájem). Kontrola času startu a cíle online závodů a schvalování přezdívek slouží k poctivému a slušnému žebříčku (oprávněný zájem). Údaje neprodáváme, nepoužíváme na reklamu a neposíláme newslettery. Nic se nevyhodnocuje automaticky tak, aby to mělo vliv na tebe, kromě skrytí zjevně nemožného nebo neověřeného výsledku z žebříčku.');
      sec('Co vidí ostatní:', 'jen tvou přezdívku a výsledky v žebříčku. E-mail ani tvého vlastního trenéra nevidí nikdo jiný.');
      sec('Plocha online:', 'když na ni vstoupíš, posíláme ostatním přihlášeným hráčům na ploše tvou polohu, pohyb, přezdívku (jen schválenou), náhodné číslo účtu (bez e-mailu) a zprávy, které napíšeš do chatu, dokud tam jsi. Zprávy vidí jen hráči, kteří jsou zrovna s tebou na ploše. Nikam se to neukládá.');
      sec('Online závod:', 'když se přidáš do online závodu, propojí se tvé zařízení přímo se zařízeními ostatních jezdců v závodě (WebRTC). Posílá se jim poloha a rychlost tvého jezdce, jeho vzhled (helma, kola, barvy), přezdívka (jen schválená) a náhodné číslo účtu, ze kterého nejde zjistit tvůj e-mail. Při přímém spojení ostatní hráči technicky vidí tvou IP adresu. K navázání spojení se tvé zařízení ptá STUN serveru Googlu nebo Cloudflare, který tak uvidí tvou IP adresu. Když přímé spojení nejde, data jdou přes přenosový (TURN) server poskytovatele Cloudflare nebo Metered, případně přes server hry (Supabase); ty data jen přeposílají a neukládají. Na serveru hry se k závodu ukládá čas startu a cíle, režim a pořadí, které jsi nahlásil, kvůli kontrole poctivosti výsledků; mažou se po 30 dnech.');
      sec('Kde:', 'databáze Supabase na serverech ve Frankfurtu (EU). Stránku hry doručuje GitHub Pages a 3D knihovnu Cloudflare; ty jako každý web vidí tvou IP adresu. Supabase, GitHub, Cloudflare, Google a Metered mohou údaje (hlavně IP adresu) zpracovat i v USA; předávání je kryté rámcem EU–USA pro ochranu údajů (Data Privacy Framework) nebo standardními smluvními doložkami.');
      sec('Technické záznamy:', 'když hra mluví se serverem (přihlášení, žebříček, Plocha online), Supabase si kvůli provozu a bezpečnosti zapíše IP adresu, čas a typ prohlížeče a zařízení. Vidí je jen autor hry, používá je jen k opravě chyb a ochraně před zneužitím a nejpozději po 7 dnech se samy smažou.');
      sec('Cookies:', 'hra nepoužívá cookies ani sledovací a reklamní nástroje. Do prohlížeče ukládá jen to, co je nutné ke hře a k přihlášení, proto se tě na souhlas neptáme.');
      sec('Jak dlouho:', 'dokud máš účet; po smazání účtu se smaže i všechno k němu. Záznamy o startu online závodů se mažou po 30 dnech, návrhy ze schránky a vyřízené žádosti o trenéra po roce, technické záznamy po 7 dnech.');
      sec('Nevhodný obsah:', 'urážlivou přezdívku, zprávu v chatu nebo jiný nezákonný obsah nahlas na ' + CONTACT + ' (přezdívku hráče, čas a co se stalo). Přezdívky schvalujeme ručně; nevhodné přezdívky a výsledky skryjeme a účty, které porušují pravidla, můžeme zablokovat. Proti takovému rozhodnutí se můžeš ozvat na stejnou adresu.');
      sec('Děti:', 'účet a online hra (plocha, závod, chat) jsou pro hráče od 15 let. Mladší je můžou používat jen se souhlasem rodičů. Bez účtu se hraje celá hra a nic se neodesílá.');
      sec('Tvoje práva:', 'můžeš zjistit, co o tobě máme, nechat to opravit, dostat kopii, smazat účet, omezit zpracování nebo vznést námitku proti zpracování z oprávněného zájmu. Napiš z e-mailu, kterým se přihlašuješ, na ' + CONTACT + '. Stížnost můžeš podat i Úřadu pro ochranu osobních údajů (uoou.gov.cz).');
      box.appendChild(h('div', { class: 'os', text: 'Je ti méně než 15? Ukaž tohle rodičům. Platí od 28. 11. 2026.' }));
      box.appendChild(h('button', { class: 'ob alt', text: 'Zpět', on: { click: function () { cur = ctx.back || 'login'; ctx.back = ''; ctx.msg = ''; render(); } } }));
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
      box.appendChild(privacyLink());
    }
    function viewCode() {
      var inp = h('input', { class: 'oi', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: 'kód z e-mailu', maxlength: '10' });
      function go() {
        if (ctx.busy) return; ctx.busy = true; ctx.msg = 'Ověřuju…'; render();
        O.verify(ctx.email, inp.value).then(function (r) {
          ctx.busy = false;
          if (r.ok) { if (P && !P.nickname) open('nick'); else afterLogin('account'); } else setMsg(msgFor(r.err));
        });
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(h('h2', { text: '📧 Zadej kód' }));
      box.appendChild(h('p', { text: 'Poslali jsme kód na ' + ctx.email + '.' }));
      box.appendChild(h('p', { style: 'background:rgba(255,200,0,.15);border:1px solid rgba(255,200,0,.6);border-radius:8px;padding:8px 10px;font-weight:600', text: '⚠️ Kód nepřišel? Zkontroluj složku Hromadné a Spam (na Gmailu i Promoakce). Někdy dorazí až za minutu.' }));
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
          if (r.ok) afterLogin('account'); else setMsg(msgFor(r.err));
        });
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(h('h2', { text: '✏️ Přezdívka' }));
      if (ctx.after === 'mp') box.appendChild(h('p', { class: 'om', text: P && P.nickname_status === 'rejected' ? 'Tvoje přezdívka byla zamítnutá. Na plochu online si musíš zvolit jinou.' : 'Na plochu online si musíš zvolit přezdívku.' }));
      box.appendChild(h('p', { text: ctx.after === 'mp' ? 'Ostatní hráči ji uvidí nad tvou hlavou, až ji schválíme. Do té doby budeš na ploše jako „Hráč“.' : 'Pod touhle přezdívkou se ukážeš v žebříčku. Nejdřív ji schválíme, do té doby hraješ a vyděláváš normálně.' }));
      box.appendChild(inp);
      box.appendChild(h('div', { class: 'om', text: ctx.msg }));
      box.appendChild(h('button', { class: 'ob', text: 'Uložit', on: { click: go } }));
      box.appendChild(ctx.after === 'mp' ? closeBtn('Zpět') : ctx.after ? h('button', { class: 'ob alt', text: 'Později', on: { click: function () { afterLogin('account'); } } }) : closeBtn('Později'));
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
      box.appendChild(h('div', { class: 'os', text: 'Smazání účtu: napiš z tohoto e-mailu na ' + CONTACT + '.' }));
      box.appendChild(privacyLink());
    }
    /* schránka na návrhy: člověk v kóji na ploše se ptá, co zlepšit */
    function ask(t) { return h('div', { class: 'oq' }, [h('b', { text: '🧔' }), h('p', { text: t })]); }
    function viewFbLogin() {
      box.appendChild(h('h2', { text: '💡 Návrhy na zlepšení' }));
      box.appendChild(ask('Máš nápad, co na hře zlepšit? Napiš mi ho, ale nejdřív se přihlas.'));
      box.appendChild(h('p', { text: 'Návrhy můžou posílat jen přihlášení hráči. Přihlášení je přes e-mail s kódem, bez hesla.' }));
      box.appendChild(h('button', { class: 'ob', text: 'Přihlásit se', on: { click: function () { ctx.after = 'feedback'; cur = 'login'; ctx.msg = ''; render(); } } }));
      box.appendChild(closeBtn('Teď ne'));
    }
    function viewFeedback() {
      if (!S) { cur = 'fbLogin'; render(); return; }
      box.appendChild(h('h2', { text: '💡 Návrhy na zlepšení' }));
      if (ctx.fbSent) {
        box.appendChild(ask('Díky! Přečteme si to a když to půjde, uděláme to.'));
        box.appendChild(h('div', { class: 'ook', text: '✅ Návrh je odeslaný.' }));
        box.appendChild(h('button', { class: 'ob alt', text: 'Napsat další', on: { click: function () { ctx.fbSent = false; ctx.msg = ''; render(); } } }));
        box.appendChild(closeBtn());
        return;
      }
      box.appendChild(ask('Ahoj! Co bys na hře zlepšil? Klidně i stížnost, nic mě nerozhodí.'));
      var ta = h('textarea', { class: 'oi', maxlength: '1000', placeholder: 'Třeba: v madisonu se špatně počítají kola…' });
      ta.value = ctx.fb;
      var cnt = h('div', { class: 'ocn', text: ctx.fb.length + ' / 1000' });
      ta.addEventListener('input', function () { ctx.fb = ta.value; cnt.textContent = ta.value.length + ' / 1000'; });
      function go() {
        if (ctx.busy) return; ctx.fb = ta.value; ctx.busy = true; ctx.msg = 'Posílám…'; render();
        O.sendFeedback(ctx.fb).then(function (r) {
          ctx.busy = false;
          if (r.ok) { ctx.fb = ''; ctx.fbSent = true; ctx.msg = ''; render(); }
          else if (r.err === 'not_authenticated') { cur = 'fbLogin'; ctx.msg = ''; render(); }
          else setMsg(msgFor(r.err));
        });
      }
      box.appendChild(ta);
      box.appendChild(cnt);
      box.appendChild(h('div', { class: 'om', text: ctx.msg }));
      box.appendChild(h('button', { class: 'ob', text: 'Odeslat', on: { click: go } }));
      box.appendChild(closeBtn());
      box.appendChild(h('div', { class: 'os', text: 'Návrh si přečte jen autor hry. Po roce se sám smaže. Nepiš do něj hesla ani osobní údaje.' }));
      setTimeout(function () { try { ta.focus(); } catch (e) {} }, 50);
    }
    O.feedback = function () { ctx.fbSent = false; open(S ? 'feedback' : 'fbLogin'); };

    /* vlastní trenér: žádost se jménem a popisem vzhledu */
    function viewMpLogin() {
      box.appendChild(h('h2', { text: '👥 Plocha online' }));
      box.appendChild(h('p', { text: 'Na plochu online můžou jen přihlášení hráči. Přihlas se a potkáš tam ostatní.' }));
      box.appendChild(h('button', { class: 'ob', text: 'Přihlásit se', on: { click: function () { ctx.after = 'mp'; cur = 'login'; ctx.msg = ''; render(); } } }));
      box.appendChild(closeBtn('Zpět'));
    }
    function viewMpErr() {
      box.appendChild(h('h2', { text: '👥 Plocha online' }));
      box.appendChild(h('p', { text: 'Nejde se spojit se serverem. Zkontroluj internet a zkus to znovu.' }));
      box.appendChild(closeBtn());
    }
    function viewCoachLogin() {
      box.appendChild(h('h2', { text: '🎨 Vlastní trenér' }));
      box.appendChild(ask('Chceš místo mě jiného trenéra? Řekni mi, jak se má jmenovat a jak má vypadat. Nejdřív se ale přihlas.'));
      box.appendChild(h('p', { text: 'Vlastního trenéra si můžou objednat jen přihlášení hráči. Přihlášení je přes e-mail s kódem, bez hesla.' }));
      box.appendChild(h('button', { class: 'ob', text: 'Přihlásit se', on: { click: function () { ctx.after = 'coach'; cur = 'login'; ctx.msg = ''; render(); } } }));
      box.appendChild(closeBtn('Teď ne'));
    }
    function viewCoach() {
      if (!S) { cur = 'coachLogin'; render(); return; }
      box.appendChild(h('h2', { text: '🎨 Vlastní trenér' }));
      var c = O.coach();
      if (ctx.cSent) {
        box.appendChild(ask('Mám to! Až ho vyrobíme, uvidíš ho na ploše i na mantinelu. Jen ty, na svém účtu.'));
        box.appendChild(h('div', { class: 'ook', text: '✅ Žádost je odeslaná, čeká na výrobu.' }));
        box.appendChild(closeBtn());
        return;
      }
      var st = h('div', { class: 'os', text: c ? 'Teď máš trenéra: ' + (c.name || 'vlastní') + '.' : '' });
      box.appendChild(ask('Jak se má tvůj trenér jmenovat, jak má vypadat a jak se má chovat? Popiš co nejvíc: postava, vlasy, vousy, oblečení a barvy, čepice, brýle… a jestli bývá naštvaný, sprostý, hodný, klidný.'));
      box.appendChild(st);
      var nm = h('input', { class: 'oi', maxlength: '30', placeholder: 'Jméno trenéra' });
      nm.value = ctx.cName || '';
      var ta = h('textarea', { class: 'oi', maxlength: '600', placeholder: 'Třeba: šedivý, plešatý, knír, červené propocené triko, kšandy, modré džíny…' });
      ta.value = ctx.cLook || '';
      var cnt = h('div', { class: 'ocn', text: ta.value.length + ' / 600' });
      var bh = h('textarea', { class: 'oi', maxlength: '300', placeholder: 'Chování: třeba věčně naštvaný a sprostý, nebo hodný a povzbuzuje. Klidně i jeho oblíbené hlášky.' });
      bh.value = ctx.cBeh || '';
      var cnt2 = h('div', { class: 'ocn', text: bh.value.length + ' / 300' });
      bh.addEventListener('input', function () { ctx.cBeh = bh.value; cnt2.textContent = bh.value.length + ' / 300'; });
      nm.addEventListener('input', function () { ctx.cName = nm.value; });
      ta.addEventListener('input', function () { ctx.cLook = ta.value; cnt.textContent = ta.value.length + ' / 600'; });
      function go() {
        if (ctx.busy) return; ctx.cName = nm.value; ctx.cLook = ta.value; ctx.cBeh = bh.value; ctx.busy = true; ctx.msg = 'Posílám…'; render();
        O.sendCoach(ctx.cName, ctx.cLook, ctx.cBeh).then(function (r) {
          ctx.busy = false;
          if (r.ok) { ctx.cName = ctx.cLook = ctx.cBeh = ''; ctx.cSent = true; ctx.msg = ''; render(); }
          else if (r.err === 'not_authenticated') { cur = 'coachLogin'; ctx.msg = ''; render(); }
          else setMsg(msgFor(r.err));
        });
      }
      box.appendChild(nm);
      box.appendChild(ta);
      box.appendChild(cnt);
      box.appendChild(bh);
      box.appendChild(cnt2);
      box.appendChild(h('div', { class: 'om', text: ctx.msg }));
      box.appendChild(h('button', { class: 'ob', text: 'Odeslat', on: { click: go } }));
      box.appendChild(closeBtn());
      box.appendChild(h('div', { class: 'os', text: 'Trenéra vyrábíme ručně, chvíli to potrvá. Uvidíš ho jen ty. Nová žádost nahradí tu, co ještě čeká.' }));
      if (!ctx.cLook && !ctx.cName && !ctx.cBeh) O.myCoachRequest().then(function (r) {
        if (cur !== 'coach' || ctx.cSent || !r.ok || !r.req || r.req.status !== 'new') return;
        st.textContent = '⏳ Čeká na výrobu: ' + r.req.name + '. Novou žádostí ji nahradíš.';
      });
      setTimeout(function () { try { nm.focus(); } catch (e) {} }, 50);
    }
    O.customCoach = function () { ctx.cSent = false; open(S ? 'coach' : 'coachLogin'); };
    O.overlayOpen = function () { return ov.style.display === 'flex'; };

    function fmtRow(mode, r) {
      if (mode === 'kilometr' || mode === 'team_sprint') return r.best_time_s == null ? '–' : Number(r.best_time_s).toFixed(3).replace('.', ',') + ' s';
      if (mode === 'bodovacka' || mode === 'madison' || mode === 'omnium') return (r.best_points == null ? '–' : r.best_points + ' b');
      return (r.wins || 0) + '× vítěz';
    }
    /* záložky disciplín + tabulka; kreslí se do okna žebříčku i do televize na ploše */
    function boardInto(wrap, state, rerender, alive) {
      var tabs = h('div', { class: 'ot' });
      MODES.forEach(function (m) {
        tabs.appendChild(h('button', { text: m[1], class: m[0] === state.boardMode ? 'on' : '',
          on: { click: function () { state.boardMode = m[0]; rerender(); } } }));
      });
      wrap.appendChild(tabs);
      var list = h('div', { text: 'Načítám…' });
      wrap.appendChild(list);
      var mode = state.boardMode;
      O.leaderboard(mode).then(function (r) {
        if (!alive() || state.boardMode !== mode) return;
        list.textContent = '';
        if (!r.ok) { list.textContent = msgFor(r.err); return; }
        if (!r.rows.length) { list.textContent = 'Zatím tu nikdo není. Buď první!'; return; }
        var tb = h('table'), seen = false;
        function row(x, mine) {
          var nick = String(x.nickname || 'Ty');
          tb.appendChild(h('tr', { class: mine ? 'me' : '' }, [
            h('td', { text: x.place + '.' }), h('td', x.badge === 'gold' ? null : { text: nick }, x.badge === 'gold' ? [h('span', { class: 'gold', text: nick }), h('span', { class: 'gb', text: 'GOLD', title: 'Gold účet' })] : null), h('td', { text: fmtRow(mode, x), style: 'text-align:right' })]));
        }
        r.rows.forEach(function (x) {
          var mine = !!(P && P.nickname && x.nickname === P.nickname);
          if (mine) seen = true;
          row(x, mine);
        });
        list.appendChild(tb);
        if (!seen && S) O.myRank(mode).then(function (m) {
          if (!alive() || state.boardMode !== mode || !m.ok || !m.row || typeof m.row.place !== 'number') return;
          if (m.row.place > r.rows.length + 1) tb.appendChild(h('tr', {}, [h('td', { text: '…' }), h('td', {}), h('td', {})]));
          row(m.row, true);
        });
      });
    }
    function viewBoard() {
      box.appendChild(h('h2', { text: '🏆 Žebříček' }));
      boardInto(box, ctx, render, function () { return cur === 'board'; });
      box.appendChild(closeBtn());
    }
    /* žebříček v televizi na ploše: O.board(el) překreslí obsah prvku el */
    var tvGen = 0;
    O.board = function (el) {
      if (!el) return;
      var my = ++tvGen;
      el.innerHTML = '';
      boardInto(el, ctx, function () { O.board(el); }, function () { return my === tvGen; });
    };

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
  /* jiná karta obnovila přihlášení (nový obnovovací klíč): převezmi ho, ať se karty navzájem neodhlásí */
  if (G.addEventListener) G.addEventListener('storage', function (e) {
    if (e.key !== 'motol_session' || !S) return;
    var x = storedSess(); if (x && x.refresh !== S.refresh) S = x;
  });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', O.init);
    else O.init();
  }
  if (typeof module !== 'undefined') module.exports = O;
})();

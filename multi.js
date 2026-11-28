/* Motol Simulator – plocha online (Supabase Realtime přes WebSocket, bez knihoven).
   Hráči na ploše se vidí: každý posílá svou polohu do soukromého kanálu plocha:N (max. 8 hráčů v místnosti).
   Pustí jen přihlášeného s přezdívkou (ověřuje server). Do databáze se nic neukládá.
   Hra volá Multi.start(), Multi.stop(), Multi.send(stav), Multi.say(text) (chat) a čte Multi.peers / Multi.status / Multi.count(). */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var ROOM_MAX = 8, ROOMS = 9, HB = 25000, TOKEN_EVERY = 60000, PEER_TTL = 12000;

  var M = { peers: {}, status: 'off', room: 0, stats: { tx: 0, rx: 0, bad: 0 } };
  G.Multi = M;
  var ws = null, want = false, ref = 0, joinRef = null, topic = '', uid = null, me = null, room = 1, tracked = false;
  var hbT = null, tokT = null, retryT = null, retries = 0, present = {}, names = {}, asked = {}, gen = 0, hbRef = null, lastTok = '';

  function O() { return G.Online; }
  function nowMs() { return Date.now(); }
  function setStatus(s) { M.status = s; }
  function sendRaw(m) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(m)); return true; } catch (e) {} } return false; }
  function msg(ev, payload) { ref++; return sendRaw({ topic: topic, event: ev, payload: payload, ref: String(ref), join_ref: joinRef }); }

  function clearTimers() { clearInterval(hbT); clearInterval(tokT); clearTimeout(retryT); hbT = tokT = retryT = null; }
  function reset() { M.peers = {}; present = {}; tracked = false; M.room = 0; }

  M.start = function () {
    if (want) return;
    want = true; retries = 0; room = 1; connect();
  };
  M.stop = function () {
    want = false; gen++; clearTimers();
    if (ws) { if (topic) msg('phx_leave', {}); try { ws.close(); } catch (e) {} }
    ws = null; topic = ''; reset(); M.chat = []; setStatus('off');
  };
  /* ostatní hráči v místnosti: unikátní účty podle presence key (účet:zařízení) bez mého účtu,
     takže se nepočítá ani můj druhý telefon/okno, ani můj starý záznam po znovunačtení stránky */
  M.others = function () {
    var a = {}, n = 0, mine = me ? me.split(':')[0] : uid;
    for (var k in present) { var acc = String(k).split(':')[0]; if (acc !== mine && !a[acc]) { a[acc] = 1; n++; } }
    return n;
  };
  /* počet hráčů v místnosti včetně mě */
  M.count = function () { return M.others() + (tracked ? 1 : 0); };
  /* kolik Realtime kanálů je otevřených (má být 0 nebo 1) */
  M.channels = function () { return ws && topic ? 1 : 0; };
  M.name = function (id) { return names[id] || null; };

  var lastSent = 0;
  M.send = function (st) {
    if (M.status !== 'on' || !tracked) return false;
    st.u = me; lastSent = nowMs(); M.stats.tx++;
    return msg('broadcast', { type: 'broadcast', event: 'p', payload: st });
  };

  /* chat: krátká zpráva všem v místnosti (max. 120 znaků, Gold účet 1000; nejvýš 1 za 2 s); nic se neukládá */
  var CHAT_MAX = 120, CHAT_GOLD = 1000, CHAT_GAP = 2000, lastChat = 0, chatIn = {};
  M.chat = [];   // posledních 20 zpráv: { u, me, text, t }
  M.onChat = null;
  function cleanText(t, max) { return String(t == null ? '' : t).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || CHAT_MAX); }
  function meGold() { var p = O() && O().profile && O().profile(); return !!(p && p.badge === 'gold'); }
  M.chatMax = function () { return meGold() ? CHAT_GOLD : CHAT_MAX; };
  function pushChat(c) { M.chat.push(c); if (M.chat.length > 20) M.chat.shift(); if (typeof M.onChat === 'function') { try { M.onChat(c); } catch (e) {} } }
  M.say = function (text) {
    var t = cleanText(text, M.chatMax());
    if (!t || M.status !== 'on' || !tracked) return false;
    if (nowMs() - lastChat < CHAT_GAP) return false;
    lastChat = nowMs();
    if (!msg('broadcast', { type: 'broadcast', event: 'c', payload: { u: me, m: t } })) return false;
    M.stats.tx++; pushChat({ u: me, me: true, text: t, t: nowMs() });
    return true;
  };

  function connect() {
    var on = O();
    if (!on || !on.loggedIn || !on.loggedIn() || !on.accessToken) { setStatus('denied'); want = false; return; }
    setStatus('connecting');
    if (ws) { var old = ws; ws = null; topic = ''; clearTimers(); try { old.close(); } catch (e) {} }   // nikdy dvě spojení najednou
    var g = ++gen;
    on.accessToken(300).then(function (t) {
      if (!want || g !== gen) return;
      lastTok = t;
      uid = on.uid && on.uid();
      if (!t || !uid) { setStatus('denied'); want = false; return; }
      if (!me || me.split(':')[0] !== uid) me = uid + ':' + Math.random().toString(36).slice(2, 8);   // každé zařízení zvlášť (stejný účet na mobilu i počítači)
      var c = on.config();
      var url = c.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(c.key) + '&vsn=1.0.0';
      var W = M._WS || G.WebSocket;
      try { ws = new W(url); } catch (e) { fail(); return; }
      var sock = ws;
      ws.onopen = function () { if (sock !== ws) return; join(t); hbRef = null;
        hbT = setInterval(function () {   // odpověď na minulý heartbeat nepřišla: spojení je mrtvé
          if (hbRef) { try { ws.close(); } catch (e) {} return; }
          ref++; hbRef = String(ref); sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: hbRef }); }, HB);
        tokT = setInterval(refreshToken, TOKEN_EVERY); };
      ws.onmessage = function (e) { if (sock !== ws) return; var m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
      ws.onclose = function () { if (sock !== ws) return; ws = null; clearTimers(); reset(); if (want) fail(); };
      ws.onerror = function () {};
    }, function () { if (g === gen) fail(); });
  }
  function fail() {
    ws = null; clearTimers(); reset();
    if (!want) return;
    setStatus('error');
    retries++; retryT = setTimeout(function () { if (want) connect(); }, Math.min(20000, 2000 * retries));
  }
  function refreshToken() {
    var on = O(); if (!on || !on.accessToken) return;
    on.accessToken(300).then(function (t) { if (t && topic && t !== lastTok) { lastTok = t; msg('access_token', { access_token: t }); } });
  }
  function join(t) {
    topic = 'realtime:plocha:' + room; ref++; joinRef = String(ref); present = {}; tracked = false;
    sendRaw({ topic: topic, event: 'phx_join', ref: joinRef, join_ref: joinRef,
      payload: { config: { broadcast: { self: false, ack: false }, presence: { key: me, enabled: true }, postgres_changes: [], private: true }, access_token: t } });
  }
  function nextRoom() {
    msg('phx_leave', {}); topic = '';
    if (room >= ROOMS) { setStatus('full'); want = false; try { ws.close(); } catch (e) {} return; }
    room++; var g = gen;
    O().accessToken(300).then(function (t) { if (want && ws && g === gen) join(t); }, function () { if (g === gen && ws) try { ws.close(); } catch (e) {} });
  }

  function onMsg(m) {
    if (m.topic === 'phoenix' && m.ref === hbRef) { hbRef = null; return; }
    if (m.topic !== topic) return;
    var p = m.payload || {};
    if (m.event === 'phx_reply' && m.ref === joinRef) {
      if (p.status !== 'ok') { setStatus('denied'); want = false; try { ws.close(); } catch (e) {} return; }
      var jr = joinRef;   // stav místnosti nepřišel: počítej s prázdnou
      setTimeout(function () { if (want && ws && jr === joinRef && !tracked) onMsg({ topic: topic, event: 'presence_state', payload: {} }); }, 2000);
      return;
    }
    if (m.event === 'system' && p.status === 'error') { try { ws.close(); } catch (e) {} return; }   // např. vypršel token: připojit znovu (bez práva odmítne už join)
    if (m.event === 'phx_error' || m.event === 'phx_close') { if (want) { try { ws.close(); } catch (e) {} } return; }
    if (m.event === 'presence_state') {
      for (var k in p) if (k !== me) present[k] = (p[k].metas || [1]).length || 1;
      if (!tracked) {
        if (Object.keys(present).length >= ROOM_MAX) { nextRoom(); return; }
        tracked = true; retries = 0; M.room = room; setStatus('on');
        msg('presence', { type: 'presence', event: 'track', payload: { t: nowMs() } });
      }
      askNames(); return;
    }
    if (m.event === 'presence_diff') {
      var j = p.joins || {}, l = p.leaves || {}, k2;
      for (k2 in j) if (k2 !== me) present[k2] = (present[k2] || 0) + ((j[k2].metas || [1]).length || 1);
      for (k2 in l) if (k2 !== me && !j[k2]) {   // stejný účet ve dvou oknech: smaž až po odchodu posledního
        var left = (l[k2].metas || []).length, had = present[k2] === true ? 1 : present[k2] || 1;
        if (had - left > 0) present[k2] = had - left; else { delete present[k2]; delete M.peers[k2]; }
      }
      askNames(); return;
    }
    if (m.event === 'broadcast' && p.event === 'p') {
      var s = p.payload;
      if (!s || typeof s.u !== 'string' || s.u === me || !present[s.u]) { M.stats.bad++; return; }
      var x = +s.x, y = +s.y, z = +s.z, h = +s.h;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(h)) return;
      var P = M.peers[s.u] || (M.peers[s.u] = { id: s.u });
      M.stats.rx++; P.x = x; P.y = y; P.z = z; P.h = h; P.v = +s.v || 0; P.st = s.st | 0; P.c = s.c | 0; P.a = s.a | 0; P.g = (s.g | 0) === 1 || (s.g | 0) === 2 ? s.g | 0 : 0; P.t = nowMs();
      /* záchranka po pádu ze žebříku: r = [x, z, natočení, fáze 0–4, čas ve fázi] */
      var r = s.r; P.r = Array.isArray(r) && r.length === 5 && r.every(function (n) { return typeof n === 'number' && isFinite(n); }) && (r[3] | 0) >= 0 && (r[3] | 0) <= 4 ? [r[0], r[1], r[2], r[3] | 0, r[4]] : null;
    }
    if (m.event === 'broadcast' && p.event === 'c') {
      var c = p.payload;
      if (!c || typeof c.u !== 'string' || c.u === me || !present[c.u]) { M.stats.bad++; return; }
      var tx = cleanText(c.m, names[c.u] && names[c.u].gold ? CHAT_GOLD : CHAT_MAX), acc = c.u.split(':')[0], tn = nowMs();
      if (!tx || tn - (chatIn[acc] || 0) < CHAT_GAP - 300) return;   // cizí klient, co posílá moc rychle
      chatIn[acc] = tn; M.stats.rx++;
      pushChat({ u: c.u, me: false, text: tx, t: tn });
    }
  }
  /* jména: jen schválené přezdívky ze serveru (ostatní jsou „Hráč“) */
  function askNames() {
    var ids = [];
    for (var k in present) if (!asked[k]) { asked[k] = 1; ids.push(k); }
    if (!ids.length || !O() || !O().names) return;
    var acc = function (k) { return String(k).split(':')[0]; }, uniq = [];   // klíč = účet:zařízení
    ids.forEach(function (k) { if (uniq.indexOf(acc(k)) < 0 && /^[0-9a-f-]{36}$/.test(acc(k))) uniq.push(acc(k)); });
    O().names(uniq.slice(0, 20)).then(function (rows) {
      rows.forEach(function (r) { ids.forEach(function (k) { if (acc(k) === r.id) names[k] = { nick: r.nickname || 'Hráč', gold: r.badge === 'gold' }; }); });
      ids.forEach(function (id) { if (!names[id]) names[id] = { nick: 'Hráč', gold: false }; });
    }, function () { ids.forEach(function (id) { delete asked[id]; }); });
  }
  /* staré záznamy (hráč přestal posílat a server ho ještě neodhlásil) */
  M.prune = function () {
    var t = nowMs();
    for (var k in M.peers) if (t - M.peers[k].t > PEER_TTL) delete M.peers[k];
    return t - lastSent;
  };
  /* návrat do aplikace (mobil v pozadí uspí časovače): hned se připojit znovu */
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && want && M.status === 'error') { clearTimeout(retryT); retries = 0; connect(); }
  });
  M._reset = function () { M.stop(); names = {}; asked = {}; M.chat = []; chatIn = {}; lastChat = 0; };
})();

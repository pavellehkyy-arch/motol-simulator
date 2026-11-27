/* Motol Simulator – plocha online (Supabase Realtime přes WebSocket, bez knihoven).
   Hráči na ploše se vidí: každý posílá svou polohu do soukromého kanálu plocha:N (max. 8 hráčů v místnosti).
   Pustí jen přihlášeného s přezdívkou (ověřuje server). Do databáze se nic neukládá.
   Hra volá Multi.start(), Multi.stop(), Multi.send(stav) a čte Multi.peers / Multi.status / Multi.count(). */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var ROOM_MAX = 8, ROOMS = 9, HB = 25000, TOKEN_EVERY = 240000, PEER_TTL = 12000;

  var M = { peers: {}, status: 'off', room: 0 };
  G.Multi = M;
  var ws = null, want = false, ref = 0, joinRef = null, topic = '', uid = null, room = 1, tracked = false;
  var hbT = null, tokT = null, retryT = null, retries = 0, present = {}, names = {}, asked = {};

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
    want = false; clearTimers();
    if (ws) { if (topic) msg('phx_leave', {}); try { ws.close(); } catch (e) {} }
    ws = null; topic = ''; reset(); setStatus('off');
  };
  /* počet hráčů v místnosti včetně mě */
  M.count = function () { return Object.keys(present).length + (tracked && !present[uid] ? 1 : 0); };
  M.name = function (id) { return names[id] || null; };

  var lastSent = 0;
  M.send = function (st) {
    if (M.status !== 'on' || !tracked) return false;
    st.u = uid; lastSent = nowMs();
    return msg('broadcast', { type: 'broadcast', event: 'p', payload: st });
  };

  function connect() {
    var on = O();
    if (!on || !on.loggedIn || !on.loggedIn() || !on.accessToken) { setStatus('denied'); want = false; return; }
    setStatus('connecting');
    on.accessToken().then(function (t) {
      if (!want) return;
      uid = on.uid && on.uid();
      if (!t || !uid) { setStatus('denied'); want = false; return; }
      var c = on.config();
      var url = c.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(c.key) + '&vsn=1.0.0';
      var W = M._WS || G.WebSocket;
      try { ws = new W(url); } catch (e) { fail(); return; }
      var me = ws;
      ws.onopen = function () { if (me !== ws) return; join(t); hbT = setInterval(function () { ref++; sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref) }); }, HB);
        tokT = setInterval(refreshToken, TOKEN_EVERY); };
      ws.onmessage = function (e) { if (me !== ws) return; var m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
      ws.onclose = function () { if (me !== ws) return; ws = null; clearTimers(); reset(); if (want) fail(); };
      ws.onerror = function () {};
    }, fail);
  }
  function fail() {
    ws = null; clearTimers(); reset();
    if (!want) return;
    setStatus('error');
    if (retries++ < 6) retryT = setTimeout(function () { if (want) connect(); }, Math.min(20000, 2000 * retries));
  }
  function refreshToken() {
    var on = O(); if (!on || !on.accessToken) return;
    on.accessToken().then(function (t) { if (t && topic) msg('access_token', { access_token: t }); });
  }
  function join(t) {
    topic = 'realtime:plocha:' + room; ref++; joinRef = String(ref); present = {}; tracked = false;
    sendRaw({ topic: topic, event: 'phx_join', ref: joinRef, join_ref: joinRef,
      payload: { config: { broadcast: { self: false, ack: false }, presence: { key: uid, enabled: true }, private: true }, access_token: t } });
  }
  function nextRoom() {
    msg('phx_leave', {});
    if (room >= ROOMS) { setStatus('full'); want = false; try { ws.close(); } catch (e) {} return; }
    room++;
    O().accessToken().then(function (t) { if (want && ws) join(t); });
  }

  function onMsg(m) {
    if (m.topic !== topic) return;
    var p = m.payload || {};
    if (m.event === 'phx_reply' && m.ref === joinRef) {
      if (p.status !== 'ok') { setStatus('denied'); want = false; try { ws.close(); } catch (e) {} return; }
      var jr = joinRef;   // stav místnosti nepřišel: počítej s prázdnou
      setTimeout(function () { if (want && ws && jr === joinRef && !tracked) onMsg({ topic: topic, event: 'presence_state', payload: {} }); }, 2000);
      return;
    }
    if (m.event === 'system' && p.status === 'error') { setStatus('denied'); want = false; try { ws.close(); } catch (e) {} return; }
    if (m.event === 'phx_error' || m.event === 'phx_close') { if (want) { try { ws.close(); } catch (e) {} } return; }
    if (m.event === 'presence_state') {
      for (var k in p) if (k !== uid) present[k] = 1;
      if (!tracked) {
        if (Object.keys(present).length >= ROOM_MAX) { nextRoom(); return; }
        tracked = true; retries = 0; M.room = room; setStatus('on');
        msg('presence', { type: 'presence', event: 'track', payload: { t: nowMs() } });
      }
      askNames(); return;
    }
    if (m.event === 'presence_diff') {
      var j = p.joins || {}, l = p.leaves || {}, k2;
      for (k2 in j) if (k2 !== uid) present[k2] = 1;
      for (k2 in l) if (k2 !== uid && !j[k2]) { delete present[k2]; delete M.peers[k2]; }
      askNames(); return;
    }
    if (m.event === 'broadcast' && p.event === 'p') {
      var s = p.payload;
      if (!s || typeof s.u !== 'string' || s.u === uid || !present[s.u]) return;
      var x = +s.x, y = +s.y, z = +s.z, h = +s.h;
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(h)) return;
      var P = M.peers[s.u] || (M.peers[s.u] = { id: s.u });
      P.x = x; P.y = y; P.z = z; P.h = h; P.v = +s.v || 0; P.st = s.st | 0; P.c = s.c | 0; P.t = nowMs();
    }
  }
  /* jména: jen schválené přezdívky ze serveru (ostatní jsou „Hráč“) */
  function askNames() {
    var ids = [];
    for (var k in present) if (!asked[k]) { asked[k] = 1; ids.push(k); }
    if (!ids.length || !O() || !O().names) return;
    O().names(ids.slice(0, 20)).then(function (rows) {
      rows.forEach(function (r) { names[r.id] = { nick: r.nickname || 'Hráč', gold: r.badge === 'gold' }; });
      ids.forEach(function (id) { if (!names[id]) names[id] = { nick: 'Hráč', gold: false }; });
    }, function () { ids.forEach(function (id) { delete asked[id]; }); });
  }
  /* staré záznamy (hráč přestal posílat a server ho ještě neodhlásil) */
  M.prune = function () {
    var t = nowMs();
    for (var k in M.peers) if (t - M.peers[k].t > PEER_TTL) delete M.peers[k];
    return t - lastSent;
  };
  M._reset = function () { M.stop(); names = {}; asked = {}; };
})();

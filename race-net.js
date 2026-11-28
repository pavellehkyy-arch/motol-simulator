/* Motol Simulator – online závod peer-to-peer (WebRTC), bez knihoven.
   Supabase Realtime (WebSocket, Phoenix protokol, soukromé kanály zavod:<režim>:1…20) slouží jen
   k hledání místnosti (presence) a k signalizaci (broadcast 'sig'). Poloha jezdců a události jdou
   přímo mezi hráči datovými kanály WebRTC (mesh, max. 8 hráčů v místnosti). Nic se neukládá.

   Hra volá:
     RaceNet.join(mode), RaceNet.leave()
     RaceNet.send({ s, w, v, e, f, l, fl })      – stav mého jezdce (cca 10× za s, binárně, bez záruky)
     RaceNet.sample(key, now)                     – interpolovaný stav cizího jezdce (o DELAY ms zpět)
     RaceNet.event(k, data)                       – spolehlivá zpráva všem
     RaceNet.startRace(delayMs, info), RaceNet.snap(obj), RaceNet.finish()   – jen hostitel (finish kdokoli)
     RaceNet.hostNow(), RaceNet.toLocal(hostMs), RaceNet.isHost(), RaceNet.members(), RaceNet.name(key),
     RaceNet.linkState(key), RaceNet.relayed(key)
   Čte RaceNet.status (off/connecting/lobby/race/full/denied/error), .host, .epoch, .me, .room, .peers,
   .lastSnap, .race, .stats { tx, rx, bad, drop, old }.
   Callbacky: onHost(isMe, epoch), onStart({ atLocal, race, info, host }), onSnap(obj, fromKey),
   onEvent(fromKey, k, data, fromHost), onLink(key, state), onStatus(status). */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var MAX = 8, ROOMS = 20, HB = 25000, TOKEN_EVERY = 60000, TICK = 200,
    DELAY = 150, EXTRA = 500, BUF = 20, ICE_TO = 10000, DOWN_TO = 4000, HOST_TO = 2000,
    PING_EVERY = 2000, KA_EVERY = 300, SIG_WAIT = 3000, MSG_MAX = 16000, LAP = 153.846, PKT = 32;
  var FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
  var EV_NAME = /^[A-Za-z0-9_-]{1,32}$/;

  var R = {
    status: 'off', mode: '', room: 0, me: null, host: null, epoch: 0, peers: {}, lastSnap: null, race: null,
    stats: { tx: 0, rx: 0, bad: 0, drop: 0, old: 0 }, LAP: LAP, DELAY: DELAY, MAX: MAX,
    onHost: null, onStart: null, onSnap: null, onEvent: null, onLink: null, onStatus: null
  };
  G.RaceNet = R;

  var ws = null, want = false, ref = 0, joinRef = null, topic = '', uid = null, room = 1, lastTok = '';
  var tracked = false, stick = false, myT = 0, mySt = 'wait', present = {}, dead = {}, hostAnn = {}, maxEp = 0;
  var clockOff = 0, offs = [], pings = {}, lastPing = 0, seqOut = 0, pendSig = [], iceP = null;
  var hbT = null, tokT = null, tickT = null, retryT = null, retries = 0, hbRef = null, gen = 0, names = {}, asked = {};
  var KA = new Uint8Array([2]).buffer;   // keepalive na kanálu 'u' (1 bajt)

  function O() { return G.Online; }
  function now() { return R._now ? R._now() : Date.now(); }
  function noop() {}
  function bad() { R.stats.bad++; }
  function fin(x) { return typeof x === 'number' && isFinite(x); }
  function cb(name) { var f = R[name]; if (typeof f !== 'function') return; try { f.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) {} }
  function setStatus(s) { if (R.status === s) return; R.status = s; cb('onStatus', s); }
  function rid(n) { var s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); }
  function uuid() {
    try { if (G.crypto && G.crypto.randomUUID) return G.crypto.randomUUID(); } catch (e) {}
    var h = ''; for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-a' + h.slice(17, 20) + '-' + h.slice(20);
  }
  function unref(t) { if (t && typeof t.unref === 'function') t.unref(); return t; }
  function isAB(d) { return Object.prototype.toString.call(d) === '[object ArrayBuffer]'; }
  function toAB(d) {
    if (isAB(d)) return d;
    if (d && ArrayBuffer.isView(d)) return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
    return null;
  }

  /* ---------- Realtime (WebSocket) ---------- */
  function sendRaw(m) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(m)); return true; } catch (e) {} } return false; }
  function msg(ev, payload) { ref++; return sendRaw({ topic: topic, event: ev, payload: payload, ref: String(ref), join_ref: joinRef }); }
  function clearWs() { clearInterval(hbT); clearInterval(tokT); clearTimeout(retryT); hbT = tokT = retryT = null; }

  R.join = function (mode) {
    mode = String(mode == null ? '' : mode);
    if (!/^[a-z0-9_]{1,24}$/.test(mode)) return false;
    if (want && R.mode === mode) return true;
    if (want) R.leave();
    want = true; R.mode = mode; room = 1; retries = 0;
    clearInterval(tickT); tickT = unref(setInterval(R._tick, TICK));
    connect();
    return true;
  };
  R.leave = function () {
    want = false; gen++; clearWs(); clearInterval(tickT); tickT = null;
    for (var k in R.peers) closePc(R.peers[k]);
    if (ws) { var w = ws; if (topic) msg('phx_leave', {}); ws = null; try { w.close(); } catch (e) {} }
    topic = ''; resetRoom(); setStatus('off');
  };
  function resetRoom() {
    R.peers = {}; present = {}; dead = {}; hostAnn = {}; tracked = stick = false; R.room = 0; R.host = null; R.epoch = 0; maxEp = 0;
    myT = 0; mySt = 'wait'; R.race = null; R.lastSnap = null; offs = []; clockOff = 0; pings = {}; lastPing = 0; pendSig = []; iceP = null;
  }

  function connect() {
    var on = O();
    if (!on || !on.loggedIn || !on.loggedIn() || !on.accessToken) { setStatus('denied'); want = false; return; }
    if (R.status !== 'race') setStatus('connecting');
    if (ws) { var old = ws; ws = null; topic = ''; clearWs(); try { old.close(); } catch (e) {} }   // nikdy dvě spojení najednou
    var g = ++gen;
    on.accessToken(300).then(function (t) {
      if (!want || g !== gen) return;
      lastTok = t; uid = on.uid && on.uid();
      if (!t || !uid) { setStatus('denied'); want = false; return; }
      if (!R.me || R.me.split(':')[0] !== uid) R.me = uid + ':' + rid(6);   // klíč = účet:zařízení
      var c = on.config();
      var url = c.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(c.key) + '&vsn=1.0.0';
      var W = R._WS || G.WebSocket;
      try { ws = new W(url); } catch (e) { fail(); return; }
      var sock = ws;
      ws.onopen = function () {
        if (sock !== ws) return; join(t); hbRef = null;
        hbT = unref(setInterval(function () {   // odpověď na minulý heartbeat nepřišla: spojení je mrtvé
          if (hbRef) { try { ws.close(); } catch (e) {} return; }
          ref++; hbRef = String(ref); sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: hbRef });
        }, HB));
        tokT = unref(setInterval(refreshToken, TOKEN_EVERY));
      };
      ws.onmessage = function (e) { if (sock !== ws) return; var m; try { m = JSON.parse(e.data); } catch (_) { return; } if (m && typeof m === 'object') onMsg(m); };
      ws.onclose = function () { if (sock !== ws) return; ws = null; topic = ''; clearWs(); if (want) fail(); };
      ws.onerror = noop;
    }, function () { if (g === gen) fail(); });
  }
  /* výpadek signalizace: datové kanály běží dál, znovu se připojí do téže místnosti */
  function fail() {
    ws = null; topic = ''; clearWs(); tracked = false;
    if (!want) return;
    if (R.status !== 'race') setStatus('error');
    retries++; retryT = setTimeout(function () { if (want) connect(); }, Math.min(20000, 2000 * retries));
  }
  function refreshToken() {
    var on = O(); if (!on || !on.accessToken) return;
    on.accessToken(300).then(function (t) { if (t && topic && t !== lastTok) { lastTok = t; msg('access_token', { access_token: t }); } }, noop);
  }
  function join(t) {
    topic = 'realtime:zavod:' + R.mode + ':' + room; ref++; joinRef = String(ref); tracked = false;
    sendRaw({ topic: topic, event: 'phx_join', ref: joinRef, join_ref: joinRef,
      payload: { config: { broadcast: { self: false, ack: false }, presence: { key: R.me, enabled: true }, postgres_changes: [], private: true }, access_token: t } });
  }
  function nextRoom() {
    msg('phx_leave', {}); topic = ''; present = {};
    if (room >= ROOMS) { setStatus('full'); want = false; clearInterval(tickT); tickT = null; var w = ws; ws = null; try { w.close(); } catch (e) {} return; }
    room++; var g = gen;
    O().accessToken(300).then(function (t) { if (want && ws && g === gen) join(t); }, function () { if (g === gen && ws) try { ws.close(); } catch (e) {} });
  }
  function track() { if (topic) msg('presence', { type: 'presence', event: 'track', payload: { t: myT, st: mySt } }); }

  /* presence meta { t: čas připojení, st: 'wait'|'race' } */
  function meta(entry) {
    var ms = entry && entry.metas;
    if (!Array.isArray(ms) || !ms.length) return null;
    var best = null;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i] || {}, t = fin(m.t) ? m.t : Infinity;
      if (!best || t < best.t) best = { t: t, st: m.st === 'race' ? 'race' : 'wait' };
    }
    return best;
  }
  function order(a, b) { return a.t !== b.t ? (a.t < b.t ? -1 : 1) : (a.k < b.k ? -1 : a.k > b.k ? 1 : 0); }
  function sortedOf(map, withMe) {
    var a = [];
    for (var k in map) a.push({ k: k, t: map[k].t });
    if (withMe) a.push({ k: R.me, t: myT });
    return a.sort(order);
  }

  function onMsg(m) {
    if (m.topic === 'phoenix' && m.ref === hbRef) { hbRef = null; return; }
    if (!topic || m.topic !== topic) return;
    var p = m.payload || {}, k;
    if (m.event === 'phx_reply' && m.ref === joinRef) {
      if (p.status !== 'ok') { setStatus('denied'); want = false; var w = ws; ws = null; topic = ''; clearWs(); try { w.close(); } catch (e) {} return; }
      var jr = joinRef;   // stav místnosti nepřišel: počítej s prázdnou
      setTimeout(function () { if (want && ws && jr === joinRef && !tracked) onMsg({ topic: topic, event: 'presence_state', payload: {} }); }, 2000);
      return;
    }
    if (m.event === 'system' && p.status === 'error') { try { ws.close(); } catch (e) {} return; }
    if (m.event === 'phx_error' || m.event === 'phx_close') { if (want && ws) { try { ws.close(); } catch (e) {} } return; }
    if (m.event === 'presence_state') {
      var st = {};
      for (k in p) if (k !== R.me) { var mt = meta(p[k]); if (mt) st[k] = mt; }
      if (!tracked && !stick) {   // výběr místnosti
        var list = sortedOf(st, false);
        if (list.length >= MAX || (list.length && st[list[0].k].st === 'race')) { nextRoom(); return; }
      }
      present = st;
      if (!tracked) {
        tracked = true; stick = true; retries = 0; R.room = room;
        if (!myT) myT = now();
        track();
        if (R.status !== 'race') setStatus('lobby');
      }
      roomChanged(); return;
    }
    if (m.event === 'presence_diff') {
      var j = p.joins || {}, l = p.leaves || {};
      for (k in l) if (k !== R.me && !Object.prototype.hasOwnProperty.call(j, k)) delete present[k];
      for (k in j) if (k !== R.me) { var mj = meta(j[k]); if (mj) present[k] = mj; }
      if (tracked) roomChanged();
      return;
    }
    if (m.event === 'broadcast' && p.event === 'sig') { if (tracked) onSig(p.payload, false); }
    if (m.event === 'broadcast' && p.event === 'rl') { if (tracked) onRelay(p.payload); }
  }
  function roomChanged() { syncPeers(); flushSig(); recompute(); askNames(); }

  /* ---------- hostitel ---------- */
  R.members = function () { return stick ? sortedOf(present, true).map(function (x) { return x.k; }) : []; };
  R.isHost = function () { return R.host !== null && R.host === R.me; };
  function recompute() {
    if (!stick) return;
    var c = sortedOf(present, true).filter(function (x) { return x.k === R.me || !dead[x.k]; });
    var h = c.length ? c[0].k : null;
    if (h !== R.host) changeHost(h);
  }
  function changeHost(h) {
    R.host = h; offs = []; pings = {}; lastPing = 0;
    if (h === R.me) {
      R.epoch = Math.max(R.epoch, maxEp) + 1; maxEp = R.epoch; clockOff = 0;
      eachOpen(function (P) { sendR(P, { k: 'host', e: R.epoch }); });
    } else if (h && hostAnn[h] > R.epoch) R.epoch = hostAnn[h];
    cb('onHost', h === R.me, R.epoch);
    var H = h && h !== R.me && R.peers[h];
    if (H && H.state === 'open') ping(H);
  }
  /* zpráva hostitelského typu: jen od aktuálního hostitele a s epochou, která není starší */
  function hostOk(from, e) {
    if (typeof e !== 'number' || !isFinite(e) || Math.floor(e) !== e || e < 0 || e > 1e9) { bad(); return false; }
    if (from !== R.host || R.host === R.me) { R.stats.drop++; return false; }
    if (e < R.epoch) { R.stats.drop++; return false; }
    if (e > R.epoch) { R.epoch = e; if (e > maxEp) maxEp = e; cb('onHost', false, e); }
    return true;
  }

  /* ---------- hodiny (NTP styl, median z posledních 5) ---------- */
  R.hostNow = function () { return now() + (R.host === R.me ? 0 : clockOff); };
  R.toLocal = function (h) { return h - (R.host === R.me ? 0 : clockOff); };
  function ping(P) {
    var t = now(); lastPing = t;
    if (Object.keys(pings).length > 10) pings = {};   // nezodpovězené pingy nehromadit
    pings[t] = 1; sendR(P, { k: 'ping', a: t });
  }
  function onPong(P, m) {
    if (P.key !== R.host || R.host === R.me) { R.stats.drop++; return; }
    if (!fin(m.a) || !fin(m.b) || !pings[m.a]) { bad(); return; }
    delete pings[m.a];
    var t3 = now(), rtt = t3 - m.a;
    if (rtt < 0 || rtt > 10000) return;
    offs.push(m.b - (m.a + t3) / 2); if (offs.length > 5) offs.shift();
    var s = offs.slice().sort(function (a, b) { return a - b; }), n = s.length;
    clockOff = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  /* ---------- spojení s hráči (mesh) ---------- */
  function syncPeers() {
    var k;
    for (k in present) if (!R.peers[k]) newPeer(k);
    for (k in R.peers) if (!present[k]) dropPeer(k);
  }
  function newPeer(k) {
    var P = { key: k, offerer: R.me < k, pc: null, u: null, r: null, n: 0, tries: 0, state: 'connecting', since: now(), downAt: 0,
      lastRx: 0, lastTx: 0, buf: [], seq: -1, relay: false, iceQ: [], chain: Promise.resolve() };
    R.peers[k] = P;
    cb('onLink', k, 'connecting');
    if (P.offerer) offer(P);   // nabídku posílá vždy menší klíč
  }
  function dropPeer(k) {
    var P = R.peers[k]; if (!P) return;
    closePc(P); delete R.peers[k]; delete dead[k]; delete hostAnn[k];
  }
  function closePc(P) {
    var pc = P.pc, u = P.u, r = P.r;
    P.pc = P.u = P.r = null;
    try { if (u) u.close(); } catch (e) {}
    try { if (r) r.close(); } catch (e) {}
    try { if (pc) pc.close(); } catch (e) {}
  }
  function getIce() {
    if (!iceP) iceP = new Promise(function (res) {
      var on = O(), ok = function (a) { res(Array.isArray(a) && a.length ? a : FALLBACK_ICE); };
      try {
        var p = on && on.iceServers ? on.iceServers() : null;
        if (Array.isArray(p)) ok(p); else if (p && typeof p.then === 'function') p.then(ok, function () { res(FALLBACK_ICE); }); else res(FALLBACK_ICE);
      } catch (e) { res(FALLBACK_ICE); }
    });
    return iceP;
  }
  function alive(P, n) { return R.peers[P.key] === P && P.n === n; }
  function makePc(P, srv) {
    var RTC = R._RTC || G.RTCPeerConnection;
    if (!RTC) throw new Error('WebRTC není');
    var pc = new RTC({ iceServers: srv }), n = P.n;
    P.pc = pc; P.relay = false; P.iceQ = []; P.dg = { lc: 0, rc: 0, lt: {}, rt: {} };
    P.u = chan(P, pc, pc.createDataChannel('u', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 }), 'u');
    P.r = chan(P, pc, pc.createDataChannel('r', { negotiated: true, id: 1, ordered: true }), 'r');
    pc.onicecandidate = function (e) {
      if (pc !== P.pc || !e || !e.candidate) return;
      var c = e.candidate; P.dg.lc++; P.dg.lt[ctype(c.candidate)] = 1;
      sig(P.key, 'ice', { candidate: String(c.candidate), sdpMid: c.sdpMid == null ? null : String(c.sdpMid), sdpMLineIndex: c.sdpMLineIndex == null ? null : c.sdpMLineIndex }, n);
    };
    pc.onconnectionstatechange = function () {
      if (pc !== P.pc) return;
      var s = pc.connectionState;
      if (s === 'failed') failure(P);
      else if (s === 'disconnected') { if (!P.downAt) P.downAt = now(); }
      else if (s === 'connected') P.downAt = 0;
    };
    return pc;
  }
  function chan(P, pc, ch, name) {
    ch.binaryType = 'arraybuffer';
    ch.onopen = function () { if (pc === P.pc) opened(P); };
    ch.onclose = function () {
      if (pc !== P.pc) return;
      if (P.state === 'open') { if (!dead[P.key]) { dead[P.key] = 1; recompute(); } failure(P); }
    };
    ch.onmessage = function (e) { if (pc === P.pc && e) onData(P, name, e.data); };
    return ch;
  }
  function offer(P) {
    var n = P.n;
    P.chain = P.chain.then(getIce).then(function (srv) {
      if (!alive(P, n)) return;
      closePc(P);
      var pc = makePc(P, srv);
      return pc.createOffer().then(function (o) { return pc.setLocalDescription(o).then(function () { return o; }); }).then(function (o) {
        if (pc === P.pc) sig(P.key, 'offer', { type: 'offer', sdp: (pc.localDescription || o).sdp }, n);
      });
    }).catch(function () { if (alive(P, n)) failure(P); });
  }
  function opened(P) {
    if (P.state === 'open' || !P.u || !P.r || P.u.readyState !== 'open' || P.r.readyState !== 'open') return;
    linkUp(P);
    checkRelay(P);
  }
  function linkUp(P) {
    P.state = 'open'; P.tries = 0; P.lastRx = now(); P.lastTx = 0; P.downAt = 0;
    cb('onLink', P.key, 'open');
    if (R.host === R.me) {
      sendR(P, { k: 'host', e: R.epoch });
      if (R.race) sendR(P, { k: 'start', e: R.epoch, at: R.race.at, race: R.race.id, info: R.race.info });
    }
    if (P.key === R.host) ping(P);
  }
  /* relay = spojení jde přes TURN server */
  function checkRelay(P) {
    var pc = P.pc;
    if (!pc || typeof pc.getStats !== 'function') return;
    try {
      pc.getStats().then(function (rep) {
        if (pc !== P.pc || !rep || typeof rep.forEach !== 'function') return;
        var all = {}, sel = null, pair = null;
        rep.forEach(function (s) { if (!s) return; all[s.id] = s; if (s.type === 'transport' && s.selectedCandidatePairId) sel = s.selectedCandidatePairId; });
        rep.forEach(function (s) {
          if (!pair && s && s.type === 'candidate-pair' && (sel ? s.id === sel : (s.selected || (s.nominated && s.state === 'succeeded')))) pair = s;
        });
        if (!pair) return;
        var lc = all[pair.localCandidateId], rc = all[pair.remoteCandidateId];
        P.relay = !!((lc && lc.candidateType === 'relay') || (rc && rc.candidateType === 'relay'));
      }, noop);
    } catch (e) {}
  }
  /* ICE se nespojilo / spojení spadlo: jednou zkusit znovu (nové spojení), pak je hráč nedostupný */
  function failure(P) {
    if (R.peers[P.key] !== P || P.state === 'failed') return;
    var wasOpen = P.state === 'open';
    closePc(P);
    if (P.tries < 1) {
      P.tries++; P.state = 'connecting'; P.since = now(); P.downAt = 0;
      if (wasOpen) cb('onLink', P.key, 'connecting');
      if (P.offerer) { P.n++; offer(P); }   // druhá strana čeká na novou nabídku
    } else if (ws && topic && tracked) viaServer(P);   // napřímo to nejde: zprávy půjdou přes Supabase Realtime (bez TURN)
    else {
      P.state = 'failed'; cb('onLink', P.key, 'failed');
      if (!dead[P.key]) { dead[P.key] = 1; recompute(); }
    }
  }
  /* ---------- záloha bez TURN: data přes kanál Realtime (broadcast 'rl'), pomaleji (stav nejvýš 5× za s) ---------- */
  var WS_U_GAP = 190, WS_KA = 1000, wsOut = [], wsFlushQ = false, wsLastU = 0;
  function viaServer(P) {
    if (R.peers[P.key] !== P || P.ws) return;
    closePc(P); P.ws = true; P.relay = true; P.seq = -1;
    linkUp(P);
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(ab) {   // bez btoa (krátké pakety, ať to běží všude)
    var u = new Uint8Array(ab), o = '', i, n;
    for (i = 0; i < u.length; i += 3) {
      n = (u[i] << 16) | ((u[i + 1] || 0) << 8) | (u[i + 2] || 0);
      o += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < u.length ? B64[n >> 6 & 63] : '=') + (i + 2 < u.length ? B64[n & 63] : '=');
    }
    return o;
  }
  function unb64(t) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t) || t.length % 4) return null;
    var pad = t.charAt(t.length - 1) === '=' ? (t.charAt(t.length - 2) === '=' ? 2 : 1) : 0, len = t.length / 4 * 3 - pad, u = new Uint8Array(len), j = 0;
    for (var i = 0; i < t.length; i += 4) {
      var n = (B64.indexOf(t[i]) << 18) | (B64.indexOf(t[i + 1]) << 12) | ((B64.indexOf(t[i + 2]) & 63) << 6) | (B64.indexOf(t[i + 3]) & 63);
      if (j < len) u[j++] = n >> 16 & 255; if (j < len) u[j++] = n >> 8 & 255; if (j < len) u[j++] = n & 255;
    }
    return u.buffer;
  }
  function wsSend(P, c, d) {
    if (!ws || !topic || !tracked) return false;
    var bin = typeof d !== 'string', t = bin ? b64(toAB(d) || new ArrayBuffer(0)) : d;
    if (t.length > MSG_MAX) return false;
    for (var i = 0; i < wsOut.length; i++) { var o = wsOut[i]; if (o.c === c && o.d === t && o.b === bin) { if (o.to.indexOf(P.key) < 0) o.to.push(P.key); return true; } }
    wsOut.push({ c: c, d: t, b: bin, to: [P.key] });
    if (!wsFlushQ) { wsFlushQ = true; Promise.resolve().then(wsFlush); }
    return true;
  }
  function wsFlush() {
    wsFlushQ = false; var q = wsOut; wsOut = [];
    q.forEach(function (o) { msg('broadcast', { type: 'broadcast', event: 'rl', payload: { f: R.me, to: o.to, c: o.c, d: o.d, b: o.b ? 1 : 0 } }); R.stats.tx++; });
  }
  function onRelay(m) {
    if (!m || typeof m !== 'object' || typeof m.f !== 'string' || m.f === R.me || !Array.isArray(m.to) || m.to.length > MAX || m.to.indexOf(R.me) < 0) return;
    if ((m.c !== 'u' && m.c !== 'r') || typeof m.d !== 'string' || m.d.length > MSG_MAX) { bad(); return; }
    var P = R.peers[m.f];
    if (!P || !present[m.f]) { bad(); return; }
    if (!P.ws) viaServer(P);   // druhá strana už jede přes server: přidej se
    var d = m.d;
    if (m.b) { d = unb64(m.d); if (!d) { bad(); return; } }
    onData(P, m.c, d);
  }
  function ctype(c) { var m = / typ (\w+)/.exec(String(c || '')); return m ? m[1] : '?'; }
  /* diagnostika spojení pro čekárnu: stav ICE a kolik kandidátů jakého typu (host/srflx/relay) jsme poslali a dostali */
  R.diag = function (k) {
    var P = R.peers[k], pc = P && P.pc, d = P && P.dg;
    if (!P) return null;
    return { st: P.state, ice: pc ? pc.iceConnectionState : '-', con: pc ? pc.connectionState : '-', sig: pc ? pc.signalingState : '-',
      lc: d ? d.lc : 0, rc: d ? d.rc : 0, lt: d ? Object.keys(d.lt).join('+') : '', rt: d ? Object.keys(d.rt).join('+') : '', n: P.n | 0 };
  };
  R.linkState = function (k) { var P = R.peers[k]; return P ? P.state : null; };
  R.relayed = function (k) { var P = R.peers[k]; return !!(P && P.relay); };
  R.viaServer = function (k) { var P = R.peers[k]; return !!(P && P.ws); };

  /* ---------- signalizace přes Realtime broadcast 'sig' ---------- */
  function sig(to, ty, d, n) {
    if (!ws || !topic || !tracked) return false;
    return msg('broadcast', { type: 'broadcast', event: 'sig', payload: { f: R.me, to: to, ty: ty, d: d, n: n } });
  }
  function cleanSig(s) {
    if (!s || typeof s !== 'object') return null;
    if (typeof s.f !== 'string' || !s.f || s.f.length > 80 || s.f === R.me) return null;
    if (s.ty !== 'offer' && s.ty !== 'answer' && s.ty !== 'ice') return null;
    var n = s.n === undefined ? 0 : s.n;
    if (typeof n !== 'number' || Math.floor(n) !== n || n < 0 || n > 100) return null;
    var d = s.d, out;
    if (s.ty === 'ice') {
      if (d === null) out = null;
      else if (d && typeof d === 'object' && typeof d.candidate === 'string' && d.candidate.length <= 2000 &&
        (d.sdpMid == null || (typeof d.sdpMid === 'string' && d.sdpMid.length <= 64)) &&
        (d.sdpMLineIndex == null || (typeof d.sdpMLineIndex === 'number' && Math.floor(d.sdpMLineIndex) === d.sdpMLineIndex && d.sdpMLineIndex >= 0 && d.sdpMLineIndex < 64)))
        out = { candidate: d.candidate, sdpMid: d.sdpMid == null ? null : d.sdpMid, sdpMLineIndex: d.sdpMLineIndex == null ? null : d.sdpMLineIndex };
      else return null;
    } else {
      if (!d || typeof d !== 'object' || d.type !== s.ty || typeof d.sdp !== 'string' || !d.sdp || d.sdp.length > 30000) return null;
      out = { type: d.type, sdp: d.sdp };
    }
    return { f: s.f, ty: s.ty, d: out, n: n };
  }
  function onSig(raw, again) {
    if (!raw || typeof raw !== 'object') { bad(); return; }
    if (raw.to !== R.me) return;   // není pro mě
    var s = cleanSig(raw);
    if (!s) { bad(); return; }
    var P = R.peers[s.f];
    if (!P) {   // odesílatel ještě není v presence (presence_diff může přijít až po nabídce): chvíli počkat
      if (again || pendSig.length >= 40) bad(); else pendSig.push({ s: raw, at: now() });
      return;
    }
    if ((s.ty === 'offer' && P.offerer) || (s.ty === 'answer' && !P.offerer)) { bad(); return; }
    if (P.state === 'failed') return;
    P.chain = P.chain.then(function () { return handleSig(P, s); }).catch(function () { if (R.peers[P.key] === P) failure(P); });
  }
  function flushSig() {
    var keep = [];
    pendSig.forEach(function (x) { if (R.peers[x.s.f]) onSig(x.s, true); else keep.push(x); });
    pendSig = keep;
  }
  function flushIce(P) {
    var q = P.iceQ, pc = P.pc; P.iceQ = [];
    q.forEach(function (c) { if (c && pc) try { pc.addIceCandidate(c).catch(noop); } catch (e) {} });
  }
  function handleSig(P, s) {
    if (R.peers[P.key] !== P) return;
    if (s.ty === 'offer') {
      if (P.pc && (s.n < P.n || (s.n === P.n && P.pc.remoteDescription))) return;   // stará nebo opakovaná nabídka
      return getIce().then(function (srv) {
        if (R.peers[P.key] !== P) return;
        var wasOpen = P.state === 'open';
        closePc(P); P.n = s.n;
        if (wasOpen) { P.state = 'connecting'; P.since = now(); cb('onLink', P.key, 'connecting'); }
        var pc = makePc(P, srv);
        return pc.setRemoteDescription(s.d).then(function () { flushIce(P); return pc.createAnswer(); })
          .then(function (a) { return pc.setLocalDescription(a).then(function () { return a; }); })
          .then(function (a) { if (pc === P.pc) sig(P.key, 'answer', { type: 'answer', sdp: (pc.localDescription || a).sdp }, s.n); });
      });
    }
    if (s.ty === 'answer') {
      if (!P.pc || s.n !== P.n || P.pc.remoteDescription) return;
      var pc = P.pc;
      return pc.setRemoteDescription(s.d).then(function () { if (pc === P.pc) flushIce(P); });
    }
    if (s.n !== P.n || !s.d) return;   // ice
    if (P.dg) { P.dg.rc++; P.dg.rt[ctype(s.d.candidate)] = 1; }
    if (!P.pc || !P.pc.remoteDescription) { if (P.iceQ.length < 60) P.iceQ.push(s.d); return; }
    return P.pc.addIceCandidate(s.d).catch(noop);
  }

  /* ---------- datové kanály ---------- */
  function eachOpen(fn) { for (var k in R.peers) { var P = R.peers[k]; if (P.state === 'open') fn(P); } }
  function sendU(P, data) {
    if (P.ws) { P.lastTx = now(); return wsSend(P, 'u', data); }
    if (!P.u || P.u.readyState !== 'open') return false;
    try { P.u.send(data); P.lastTx = now(); R.stats.tx++; return true; } catch (e) { return false; }
  }
  function sendR(P, obj) {
    if (!P.ws && (!P.r || P.r.readyState !== 'open')) return false;
    var s; try { s = typeof obj === 'string' ? obj : JSON.stringify(obj); } catch (e) { return false; }
    if (!s || s.length > MSG_MAX) return false;
    if (P.ws) { P.lastTx = now(); return wsSend(P, 'r', s); }
    try { P.r.send(s); P.lastTx = now(); R.stats.tx++; return true; } catch (e) { return false; }
  }
  function onData(P, ch, d) {
    var t = now();
    if (dead[P.key]) { delete dead[P.key]; recompute(); }   // zase se ozval (třeba jen zaseknuté vlákno): může být znovu hostitel
    if (ch === 'u' && typeof d !== 'string') {
      var b = toAB(d);
      if (!b) { bad(); return; }
      if (b.byteLength === 1 && new Uint8Array(b)[0] === 2) { P.lastRx = t; return; }   // keepalive
      var s = dec(b);
      if (!s) { bad(); return; }
      P.lastRx = t;
      if (P.seq >= 0) { var dd = (s.seq - P.seq) & 0xffff; if (dd === 0 || dd >= 0x8000) { R.stats.old++; return; } }   // starší (i přes přetečení Uint16)
      P.seq = s.seq;
      var lt = R.toLocal(s.t);
      if (!(lt <= t) || lt < t - 5000) lt = t;   // nesmyslný čas (hodiny ještě nesladěné)
      var last = P.buf[P.buf.length - 1];
      if (last && lt < last.t) lt = last.t;
      P.buf.push({ t: lt, s: s.s, w: s.w, v: s.v, e: s.e, f: s.f, l: s.l, fl: s.fl, seq: s.seq });
      if (P.buf.length > BUF) P.buf.shift();
      R.stats.rx++; return;
    }
    if (typeof d !== 'string' || d.length > MSG_MAX) { bad(); return; }
    var m; try { m = JSON.parse(d); } catch (e) { bad(); return; }
    if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.k !== 'string') { bad(); return; }
    P.lastRx = t;
    if (ch === 'u') { if (m.k === 'snap') onSnapMsg(P, m); else bad(); return; }
    if (ch !== 'r') { bad(); return; }
    switch (m.k) {
      case 'host':
        if (typeof m.e !== 'number' || Math.floor(m.e) !== m.e || m.e < 0 || m.e > 1e9) { bad(); return; }
        R.stats.rx++;
        if (!(hostAnn[P.key] >= m.e)) hostAnn[P.key] = m.e;
        if (m.e > maxEp) maxEp = m.e;
        if (R.host === R.me && m.e >= R.epoch) {   // někdo se prohlásil hostitelem, ale podle pořadí jsem to já: přebij jeho epochu
          R.epoch = maxEp + 1; maxEp = R.epoch; eachOpen(function (Q) { sendR(Q, { k: 'host', e: R.epoch }); }); cb('onHost', true, R.epoch); return;
        }
        if (P.key !== R.host || R.host === R.me) { R.stats.drop++; return; }   // ohlásil se někdo, kdo pro mě hostitel není (ještě)
        if (m.e > R.epoch) { R.epoch = m.e; cb('onHost', false, m.e); }
        return;
      case 'ping':
        if (!fin(m.a)) { bad(); return; }
        if (R.host === R.me) sendR(P, { k: 'pong', a: m.a, b: R.hostNow() });
        return;
      case 'pong': onPong(P, m); return;
      case 'start': onStartMsg(P, m); return;
      case 'ev':
        if (typeof m.n !== 'string' || !EV_NAME.test(m.n)) { bad(); return; }
        if (m.h && !hostOk(P.key, m.e)) return;
        R.stats.rx++;
        cb('onEvent', P.key, m.n, m.d === undefined ? null : m.d, !!m.h);
        return;
      default: bad();
    }
  }
  function onStartMsg(P, m) {
    if (!fin(m.at) || typeof m.race !== 'string' || !m.race || m.race.length > 64) { bad(); return; }
    if (!hostOk(P.key, m.e)) return;
    if (R.race && R.race.id === m.race) return;
    R.stats.rx++;
    var info = m.info === undefined ? null : m.info;
    R.race = { id: m.race, at: m.at, info: info, host: P.key };
    mySt = 'race'; if (tracked) track(); setStatus('race');
    cb('onStart', { atLocal: R.toLocal(m.at), race: m.race, info: info, host: P.key });
  }
  function onSnapMsg(P, m) {
    if (!m.d || typeof m.d !== 'object') { bad(); return; }
    if (!hostOk(P.key, m.e)) return;
    R.stats.rx++;
    R.lastSnap = m.d;
    cb('onSnap', m.d, P.key);
  }

  /* ---------- binární stav jezdce (32 B, little endian) ----------
     0 u8 typ 1 | 1 u8 verze 1 | 2 u16 sekvence | 4 f64 čas odesílatele v hodinách hostitele (ms)
     12 f32 s | 16 f32 w | 20 f32 v | 24 u16 e·65535 | 26 u16 f·65535 | 28 u16 kolo | 30 u16 příznaky */
  function enc(st, seq, t) {
    if (!st || typeof st !== 'object') return null;
    var s = +st.s, w = +st.w || 0, v = +st.v || 0, e = +st.e, f = +st.f || 0, l = +st.l || 0, fl = +st.fl || 0;
    if (!isFinite(s) || !isFinite(w) || !isFinite(v) || !isFinite(t) || Math.abs(s) > 1e6 || Math.abs(w) > 50 || Math.abs(v) > 100) return null;
    if (!isFinite(e)) e = 1;
    if (!isFinite(f)) f = 0;
    var b = new ArrayBuffer(PKT), dv = new DataView(b);
    dv.setUint8(0, 1); dv.setUint8(1, 1); dv.setUint16(2, seq & 0xffff, true); dv.setFloat64(4, t, true);
    dv.setFloat32(12, s, true); dv.setFloat32(16, w, true); dv.setFloat32(20, v, true);
    dv.setUint16(24, Math.round(Math.max(0, Math.min(1, e)) * 65535), true);
    dv.setUint16(26, Math.round(Math.max(0, Math.min(1, f)) * 65535), true);
    dv.setUint16(28, Math.max(0, Math.min(65535, Math.floor(l) || 0)), true);
    dv.setUint16(30, (fl | 0) & 0xffff, true);
    return b;
  }
  function dec(b) {
    b = toAB(b);
    if (!b || b.byteLength !== PKT) return null;
    var dv = new DataView(b);
    if (dv.getUint8(0) !== 1 || dv.getUint8(1) !== 1) return null;
    var o = { seq: dv.getUint16(2, true), t: dv.getFloat64(4, true), s: dv.getFloat32(12, true), w: dv.getFloat32(16, true), v: dv.getFloat32(20, true),
      e: dv.getUint16(24, true) / 65535, f: dv.getUint16(26, true) / 65535, l: dv.getUint16(28, true), fl: dv.getUint16(30, true) };
    if (!isFinite(o.t) || !isFinite(o.s) || !isFinite(o.w) || !isFinite(o.v) || Math.abs(o.s) > 1e6 || Math.abs(o.w) > 50 || Math.abs(o.v) > 100) return null;
    return o;
  }

  R.send = function (st) {
    if ((R.status !== 'lobby' && R.status !== 'race') || !st) return 0;
    var b = enc(st, (seqOut + 1) & 0xffff, R.hostNow());
    if (!b) return 0;
    seqOut = (seqOut + 1) & 0xffff;
    var t = now(), wsOk = t - wsLastU >= WS_U_GAP, wsUsed = false, n = 0;   // přes server nejvýš 5× za s
    eachOpen(function (P) { if (P.ws) { if (!wsOk) return; wsUsed = true; } if (sendU(P, b)) n++; });
    if (wsUsed) wsLastU = t;
    return n;
  };

  /* ---------- interpolace ---------- */
  function lapd(d) { return d - LAP * Math.round(d / LAP); }   // nejkratší rozdíl na okruhu
  function lerp(a, b, x) { return a + (b - a) * x; }
  function res(s, l, w, v, e, f, fl, wrap) {
    if (wrap) { var k = Math.floor(s / LAP); s -= k * LAP; if (s >= LAP) { s -= LAP; k++; } l += k; }
    return { s: s, w: w, v: v, e: e, f: f, l: l, fl: fl };
  }
  R.sample = function (key, t) {
    var P = R.peers[key], b = P && P.buf;
    if (!b || !b.length) return null;
    var tg = (t == null ? now() : t) - DELAY, n = b.length, a = b[0], c, i, x;
    var wrap = function (q) { return q.s >= 0 && q.s < LAP; };   // s v rozsahu kola: po přetečení přičti kolo
    if (tg <= a.t) return res(a.s, a.l, a.w, a.v, a.e, a.f, a.fl, false);
    c = b[n - 1];
    if (tg >= c.t) {   // vzorky dopředu chybí: extrapolace podle rychlosti, nejvýš 0,5 s
      var dt = Math.min(tg - c.t, EXTRA) / 1000;
      return res(c.s + c.v * dt, c.l, c.w, c.v, c.e, c.f, c.fl, wrap(c));
    }
    for (i = n - 1; i > 0; i--) if (b[i - 1].t <= tg) break;
    a = b[i - 1]; c = b[i];
    x = c.t > a.t ? (tg - a.t) / (c.t - a.t) : 1;
    var ds = wrap(a) && wrap(c) ? lapd(c.s - a.s) : c.s - a.s;
    return res(a.s + ds * x, a.l, lerp(a.w, c.w, x), lerp(a.v, c.v, x), lerp(a.e, c.e, x), lerp(a.f, c.f, x), x < 0.5 ? a.fl : c.fl, wrap(a));
  };

  /* ---------- události a závod ---------- */
  R.event = function (k, data) {
    if (typeof k !== 'string' || !EV_NAME.test(k)) return 0;
    var o = { k: 'ev', n: k, d: data === undefined ? null : data };
    if (R.host === R.me) { o.h = 1; o.e = R.epoch; }
    var s; try { s = JSON.stringify(o); } catch (e) { return 0; }
    if (s.length > MSG_MAX) return 0;
    var n = 0; eachOpen(function (P) { if (sendR(P, s)) n++; });
    return n;
  };
  R.startRace = function (delayMs, info) {
    if (!R.isHost() || R.status !== 'lobby') return null;
    var delay = fin(delayMs) ? Math.max(0, Math.min(60000, delayMs)) : 3000;
    info = info === undefined ? null : info;
    var id = uuid(), at = R.hostNow() + delay;
    var s; try { s = JSON.stringify({ k: 'start', e: R.epoch, at: at, race: id, info: info }); } catch (e) { return null; }
    if (s.length > MSG_MAX) return null;
    R.race = { id: id, at: at, info: info, host: R.me };
    mySt = 'race'; track(); setStatus('race');
    eachOpen(function (P) { sendR(P, s); });
    cb('onStart', { atLocal: R.toLocal(at), race: id, info: info, host: R.me });
    return id;
  };
  R.snap = function (obj) {
    if (!R.isHost() || !obj || typeof obj !== 'object') return 0;
    var s; try { s = JSON.stringify({ k: 'snap', e: R.epoch, d: obj }); } catch (e) { return 0; }
    if (s.length > MSG_MAX) return 0;
    R.lastSnap = obj;
    var n = 0; eachOpen(function (P) { if (sendU(P, s)) n++; });
    return n;
  };
  /* po závodě zpátky do čekárny (místnost zase pustí nové hráče, když to udělá hostitel) */
  R.finish = function () {
    if (R.status !== 'race') return false;
    R.race = null; mySt = 'wait'; track(); setStatus('lobby');
    return true;
  };

  /* ---------- pravidelná kontrola (časovač 200 ms; testy volají _tick s vlastním časem) ---------- */
  var lastTick = 0;
  R._tick = function () {
    var t = now(), ch = false, k, P, lag = lastTick && t - lastTick > 1000;   // vlastní vlákno se zaseklo: ticho ostatních nic neznamená
    lastTick = t;
    for (k in R.peers) {
      P = R.peers[k];
      if (P.state === 'connecting') { if (t - P.since > ICE_TO) failure(P); continue; }
      if (P.state !== 'open') continue;
      if (!P.ws && P.downAt && t - P.downAt > DOWN_TO) { failure(P); continue; }
      if (!lag && !dead[k] && t - P.lastRx > HOST_TO) { dead[k] = 1; ch = true; }   // 2 s ticho: nemůže být hostitel
      if (t - P.lastTx >= (P.ws ? WS_KA : KA_EVERY)) sendU(P, KA);
    }
    if (ch) recompute();
    var H = R.host && R.host !== R.me ? R.peers[R.host] : null;
    if (H && H.state === 'open' && t - lastPing >= PING_EVERY) ping(H);
    if (pendSig.length) pendSig = pendSig.filter(function (x) { if (t - x.at > SIG_WAIT) { bad(); return false; } return true; });
  };

  /* jména: jen schválené přezdívky ze serveru (ostatní jsou „Hráč“) */
  function askNames() {
    var ids = [];
    for (var k in present) if (!asked[k]) { asked[k] = 1; ids.push(k); }
    if (!ids.length || !O() || !O().names) return;
    var acc = function (k) { return String(k).split(':')[0]; }, uniq = [];
    ids.forEach(function (k) { if (uniq.indexOf(acc(k)) < 0 && /^[0-9a-f-]{36}$/.test(acc(k))) uniq.push(acc(k)); });
    if (!uniq.length) { ids.forEach(function (id) { names[id] = { nick: 'Hráč', gold: false }; }); return; }
    O().names(uniq.slice(0, 20)).then(function (rows) {
      (rows || []).forEach(function (r) { ids.forEach(function (k) { if (r && acc(k) === r.id) names[k] = { nick: r.nickname || 'Hráč', gold: r.badge === 'gold' }; }); });
      ids.forEach(function (id) { if (!names[id]) names[id] = { nick: 'Hráč', gold: false }; });
    }, function () { ids.forEach(function (id) { delete asked[id]; }); });
  }
  R.name = function (k) { return names[k] || null; };

  /* návrat do aplikace (mobil v pozadí uspí časovače): hned se připojit znovu */
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && want && !ws) { clearTimeout(retryT); retries = 0; connect(); }
  });

  /* ---------- pro testy ---------- */
  R._enc = enc; R._dec = dec;
  R._in = function (key, ch, data) { var P = R.peers[key]; if (!P) { bad(); return; } onData(P, ch, data); };
  R._reset = function () { R.leave(); names = {}; asked = {}; seqOut = 0; R.me = null; R.stats = { tx: 0, rx: 0, bad: 0, drop: 0, old: 0 }; R.mode = ''; lastTick = 0; wsOut = []; wsLastU = 0; };
})();

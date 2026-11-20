/* Isolated local store, HTTP-safe locking, immutable order/session/topup snapshots, QR & transfer codecs, and consent-gated analytics. */
(function (global) {
  'use strict';

  var STORAGE_PREFIX = 'vp.full.krasinsky.';
  var KEYS = {
    state: STORAGE_PREFIX + 'state.v1',
    consent: STORAGE_PREFIX + 'consent.v1',
    events: STORAGE_PREFIX + 'events.v1',
    orders: STORAGE_PREFIX + 'orders.v1',
    sessions: STORAGE_PREFIX + 'sessions.v1',
    topups: STORAGE_PREFIX + 'topups.v1',
    pending: STORAGE_PREFIX + 'pending.v1',
    paidKeys: STORAGE_PREFIX + 'paidkeys.v1',
    locks: STORAGE_PREFIX + 'lock.v1'
  };

  var consentShownThisLoad = false;

  function safeRead(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  // HTTP-safe lock: uses navigator.locks if available, else localStorage lease lock (works over plain HTTP on mobile)
  function withActionLock(lockName, fn) {
    if (global.navigator && global.navigator.locks && typeof global.navigator.locks.request === 'function') {
      return global.navigator.locks.request(STORAGE_PREFIX + lockName, { ifAvailable: true }, function (lock) {
        if (!lock) return Promise.resolve({ busy: true });
        return Promise.resolve(fn());
      });
    }
    var lockKey = KEYS.locks + '.' + lockName;
    var now = Date.now();
    var existing = safeRead(lockKey, null);
    if (existing && existing.expiresAt > now) {
      return Promise.resolve({ busy: true });
    }
    var token = (global.VPFullPricing && global.VPFullPricing.safeId) ? global.VPFullPricing.safeId('lk') : String(now);
    safeWrite(lockKey, { token: token, expiresAt: now + 4000 });
    return Promise.resolve()
      .then(fn)
      .finally(function () {
        var cur = safeRead(lockKey, null);
        if (cur && cur.token === token) {
          try { global.localStorage.removeItem(lockKey); } catch (_) {}
        }
      });
  }

  function defaultParty() {
    return [{ id: 'g1', label: 'Участник 1', ageBand: null }];
  }

  function defaultState() {
    return {
      version: 1,
      lang: 'ru',
      firstHit: 'passes',
      onlyOpen: true,
      hearts: [],
      reactions: {},
      companyTags: [],
      party: defaultParty(),
      matrix: {},
      directCart: {},          // { 'package3': qty, 'ticket:koleso': qty }
      directUnlimited: [],     // [ { id, recipientLabel } ]
      lastRemoved: null,
      showAllHome: false,
      checkoutSource: 'day',
      checkoutOutcomeSim: 'success',
      sessionDraft: {
        mode: 'full',          // 'full' | 'step'
        step: 1,
        eventId: 'show',       // 'show' (seated) | 'garden' (general capacity)
        date: '2026-11-21',
        time: '17:00',
        guests: 2,
        seats: ['A2', 'A3']
      },
      topupDraft: {
        card: '',
        amount: 5000,
        delayCredit: false
      }
    };
  }

  function normalizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    base.lang = ['ru', 'en', 'hy'].indexOf(raw.lang) >= 0 ? raw.lang : 'ru';
    base.firstHit = raw.firstHit === 'autodrom' ? 'autodrom' : 'passes';
    base.onlyOpen = raw.onlyOpen !== false;
    base.hearts = Array.isArray(raw.hearts) ? Array.from(new Set(raw.hearts.filter(function (s) { return typeof s === 'string'; }))) : [];
    base.reactions = (raw.reactions && typeof raw.reactions === 'object') ? raw.reactions : {};
    base.companyTags = Array.isArray(raw.companyTags) ? raw.companyTags.filter(function (t) { return ['couple', 'family', 'friends', 'solo'].indexOf(t) >= 0; }) : [];
    if (Array.isArray(raw.party) && raw.party.length >= 1 && raw.party.length <= 12) {
      base.party = raw.party.map(function (p, idx) {
        return {
          id: (p && typeof p.id === 'string' && p.id) ? p.id : ('g' + (idx + 1)),
          label: (p && typeof p.label === 'string' && p.label.trim()) ? p.label.trim().slice(0, 40) : ('Участник ' + (idx + 1)),
          ageBand: (p && ['under3', 'age3_4', 'age5_9', 'age10_17', 'adult'].indexOf(p.ageBand) >= 0) ? p.ageBand : null
        };
      });
    }
    base.matrix = (raw.matrix && typeof raw.matrix === 'object') ? raw.matrix : {};
    base.directCart = (raw.directCart && typeof raw.directCart === 'object') ? raw.directCart : {};
    base.directUnlimited = Array.isArray(raw.directUnlimited) ? raw.directUnlimited.slice(0, 20) : [];
    base.lastRemoved = raw.lastRemoved || null;
    base.showAllHome = Boolean(raw.showAllHome);
    base.checkoutSource = raw.checkoutSource === 'direct' ? 'direct' : 'day';
    if (['success', 'cancel', 'error', 'waiting', 'unknown'].indexOf(raw.checkoutOutcomeSim) >= 0) {
      base.checkoutOutcomeSim = raw.checkoutOutcomeSim;
    }
    if (raw.sessionDraft && typeof raw.sessionDraft === 'object') {
      base.sessionDraft = Object.assign(base.sessionDraft, raw.sessionDraft);
    }
    if (raw.topupDraft && typeof raw.topupDraft === 'object') {
      base.topupDraft = Object.assign(base.topupDraft, raw.topupDraft);
    }
    ensureMatrixCoverage(base);
    return base;
  }

  function ensureMatrixCoverage(state) {
    var partyIds = state.party.map(function (p) { return p.id; });
    state.hearts.forEach(function (slug) {
      if (!state.matrix[slug] || typeof state.matrix[slug] !== 'object') {
        state.matrix[slug] = {};
      }
      var hasAny = false;
      partyIds.forEach(function (pid) {
        if (typeof state.matrix[slug][pid] !== 'number') state.matrix[slug][pid] = 1;
        if (state.matrix[slug][pid] > 0) hasAny = true;
      });
      Object.keys(state.matrix[slug]).forEach(function (pid) {
        if (partyIds.indexOf(pid) < 0) delete state.matrix[slug][pid];
      });
      if (!hasAny && partyIds.length > 0) state.matrix[slug][partyIds[0]] = 1;
    });
    Object.keys(state.matrix).forEach(function (slug) {
      if (state.hearts.indexOf(slug) < 0) delete state.matrix[slug];
    });
  }

  function partyFromTags(tags, prevParty) {
    if (!tags || tags.length === 0 || (tags.length === 1 && tags[0] === 'solo')) {
      return [{ id: 'g1', label: 'Участник 1', ageBand: null }];
    }
    var adults = 0;
    var kids = 0;
    if (tags.indexOf('friends') >= 0) adults = Math.max(adults, 4);
    if (tags.indexOf('couple') >= 0) adults = Math.max(adults, 2);
    if (tags.indexOf('family') >= 0) {
      adults = Math.max(adults, 2);
      kids = Math.max(kids, 1);
    }
    if (adults === 0) adults = 1;
    var total = Math.min(12, adults + kids);
    var out = [];
    for (var i = 0; i < total; i++) {
      var prev = prevParty && prevParty[i];
      var isChild = i >= adults;
      out.push({
        id: 'g' + (i + 1),
        label: (prev && prev.label) ? prev.label : ('Участник ' + (i + 1)),
        ageBand: isChild ? 'age5_9' : 'adult'
      });
    }
    return out;
  }

  var listeners = [];
  var state = normalizeState(safeRead(KEYS.state, null));

  function getState() { return state; }

  function notify() {
    listeners.forEach(function (fn) { try { fn(state); } catch (_) {} });
  }

  function mutate(updater) {
    updater(state);
    ensureMatrixCoverage(state);
    safeWrite(KEYS.state, state);
    notify();
  }

  function mutateSilent(updater) {
    updater(state);
    ensureMatrixCoverage(state);
    safeWrite(KEYS.state, state);
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  // Immutable histories
  function getOrders() { var v = safeRead(KEYS.orders, []); return Array.isArray(v) ? v : []; }
  function saveOrder(orderSnapshot) {
    var list = getOrders();
    var copy = JSON.parse(JSON.stringify(orderSnapshot));
    list.unshift(copy);
    safeWrite(KEYS.orders, list.slice(0, 50));
    notify();
    return copy;
  }
  function getOrderById(orderId) {
    return getOrders().find(function (o) { return o.id === orderId; }) || null;
  }

  function getSessions() { var v = safeRead(KEYS.sessions, []); return Array.isArray(v) ? v : []; }
  function saveSession(sessionSnapshot) {
    var list = getSessions();
    var copy = JSON.parse(JSON.stringify(sessionSnapshot));
    list.unshift(copy);
    safeWrite(KEYS.sessions, list.slice(0, 50));
    notify();
    return copy;
  }

  function getTopups() { var v = safeRead(KEYS.topups, []); return Array.isArray(v) ? v : []; }
  function saveOrUpdateTopup(record) {
    var list = getTopups();
    var copy = JSON.parse(JSON.stringify(record));
    var idx = list.findIndex(function (x) { return x.id === copy.id; });
    if (idx >= 0) list[idx] = copy;
    else list.unshift(copy);
    safeWrite(KEYS.topups, list.slice(0, 50));
    notify();
    return copy;
  }

  // Pending attempt (for waiting / unknown states with retry lock) & cross-tab idempotency
  function getPendingAttempt() { return safeRead(KEYS.pending, null); }
  function setPendingAttempt(attempt) {
    if (!attempt) {
      try { global.localStorage.removeItem(KEYS.pending); } catch (_) {}
    } else {
      safeWrite(KEYS.pending, attempt);
    }
    notify();
  }

  function getPaidKeyOrder(idempotencyKey) {
    var map = safeRead(KEYS.paidKeys, {});
    return (map && map[idempotencyKey]) || null;
  }
  function recordPaidKey(idempotencyKey, orderId) {
    var map = safeRead(KEYS.paidKeys, {});
    map[idempotencyKey] = orderId;
    safeWrite(KEYS.paidKeys, map);
  }

  // Real decodable QR SVG using MIT qrcode-generator v1.4.4 (window.qrcode)
  function renderQrSvg(payload, cellSize) {
    if (typeof global.qrcode !== 'function') {
      return '<div style="padding:12px;border:1px dashed #2F2E7D;font-size:12px">QR: ' + String(payload) + '</div>';
    }
    var qr = global.qrcode(0, 'M');
    qr.addData(String(payload));
    qr.make();
    return qr.createSvgTag({ cellSize: cellSize || 5, margin: 2, scalable: true });
  }

  // UTF-8 safe Base64URL codec for isolated single-ticket transfer URLs (#/share?t=...)
  function toBase64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(b64) {
    var norm = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/');
    while (norm.length % 4) norm += '=';
    var bin = atob(norm);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // Only encodes fields belonging to THAT single ticket — never other order tickets or history!
  function encodeTransferTicket(ticket, orderMeta) {
    var slim = {
      v: 1,
      demo: true,
      code: ticket.code,
      title: ticket.title,
      unit: ticket.unit,
      recipient: ticket.recipient,
      validity: ticket.validity,
      included: ticket.included,
      price: ticket.price,
      issuedAt: orderMeta.confirmedAt || orderMeta.createdAt
    };
    return toBase64Url(JSON.stringify(slim));
  }

  function decodeTransferTicket(token) {
    try {
      var obj = JSON.parse(fromBase64Url(token));
      if (!obj || obj.v !== 1 || !obj.code || !obj.title) return null;
      return obj;
    } catch (_) {
      return null;
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Standalone HTML file export (single ticket OR full order with ALL tickets, even unopened)
  function buildStandaloneHtml(title, tickets, demoStamp, lang) {
    var htmlLang = lang || 'ru';
    var cards = tickets.map(function (tk) {
      var qrSvg = renderQrSvg(tk.qrPayload || tk.code, 5);
      return (
        '<article class="tk">' +
          '<div class="stamp">' + escapeHtml(demoStamp) + '</div>' +
          '<h2>' + escapeHtml(tk.title) + '</h2>' +
          '<p><strong>' + escapeHtml(tk.unit) + '</strong></p>' +
          '<div class="qr">' + qrSvg + '</div>' +
          '<p class="code">' + escapeHtml(tk.code) + '</p>' +
          '<p>' + escapeHtml(tk.recipient) + ' · ' + escapeHtml(tk.validity) + '</p>' +
          (tk.included ? '<p class="inc">' + escapeHtml(tk.included) + '</p>' : '') +
        '</article>'
      );
    }).join('');
    return (
      '<!doctype html><html lang="' + escapeHtml(htmlLang) + '"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
      '<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:680px;margin:24px auto;padding:0 16px;color:#1E1D4B}' +
      '.tk{border:2px solid #2F2E7D;border-radius:16px;padding:18px;margin-bottom:18px;page-break-inside:avoid}' +
      '.stamp{display:inline-block;background:#FDEBF6;color:#B20873;font-weight:700;font-size:12px;padding:4px 10px;border-radius:99px}' +
      '.qr{width:180px;height:180px;margin:12px 0}.qr svg{width:100%;height:100%}' +
      '.code{font-family:monospace;font-size:16px;font-weight:700;letter-spacing:.05em}.inc{font-size:13px;color:#4C4A73}</style>' +
      '</head><body><h1>' + escapeHtml(title) + '</h1>' + cards + '</body></html>'
    );
  }

  function downloadHtmlFile(filename, htmlContent) {
    var blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {}
    }, 300);
  }

  // Consent-gated local analytics: ZERO localStorage writes before consent === 'yes'
  function markConsentBannerShown() { consentShownThisLoad = true; }

  function getConsent() {
    var c = safeRead(KEYS.consent, null);
    return c && (c.value === 'yes' || c.value === 'no') ? c.value : null;
  }

  function setConsent(value) {
    var clean = value === 'yes' ? 'yes' : 'no';
    safeWrite(KEYS.consent, { value: clean, updatedAt: new Date().toISOString() });
    if (clean === 'yes') {
      if (consentShownThisLoad) {
        appendEventRaw('consent_shown', { source: 'banner' });
      }
      appendEventRaw('consent_yes', { page: global.location ? (global.location.hash || '#/') : '#/' });
    }
    notify();
  }

  function appendEventRaw(name, payload) {
    var list = safeRead(KEYS.events, []);
    if (!Array.isArray(list)) list = [];
    list.push({
      id: (global.VPFullPricing && global.VPFullPricing.safeId) ? global.VPFullPricing.safeId('ev') : String(Date.now()),
      ts: new Date().toISOString(),
      dayType: (new Date().getDay() === 0 || new Date().getDay() === 6) ? 'weekend' : 'weekday',
      lang: state.lang,
      event: name,
      data: payload || {}
    });
    if (list.length > 500) list = list.slice(list.length - 500);
    safeWrite(KEYS.events, list);
  }

  function track(name, payload) {
    if (getConsent() !== 'yes') return false;
    appendEventRaw(name, payload);
    return true;
  }

  function getEvents() { var v = safeRead(KEYS.events, []); return Array.isArray(v) ? v : []; }
  function clearEvents() {
    if (getConsent() === 'yes') {
      safeWrite(KEYS.events, []);
    } else {
      try { global.localStorage.removeItem(KEYS.events); } catch (_) {}
    }
    notify();
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', function (ev) {
      if (ev.key === KEYS.state) {
        state = normalizeState(safeRead(KEYS.state, null));
        notify();
      } else if (ev.key && ev.key.indexOf(STORAGE_PREFIX) === 0) {
        notify();
      }
    });
  }

  global.VPFullStore = {
    KEYS: KEYS,
    STORAGE_PREFIX: STORAGE_PREFIX,
    getState: getState,
    mutate: mutate,
    mutateSilent: mutateSilent,
    subscribe: subscribe,
    partyFromTags: partyFromTags,
    withActionLock: withActionLock,
    getOrders: getOrders,
    saveOrder: saveOrder,
    getOrderById: getOrderById,
    getSessions: getSessions,
    saveSession: saveSession,
    getTopups: getTopups,
    saveOrUpdateTopup: saveOrUpdateTopup,
    getPendingAttempt: getPendingAttempt,
    setPendingAttempt: setPendingAttempt,
    getPaidKeyOrder: getPaidKeyOrder,
    recordPaidKey: recordPaidKey,
    renderQrSvg: renderQrSvg,
    encodeTransferTicket: encodeTransferTicket,
    decodeTransferTicket: decodeTransferTicket,
    buildStandaloneHtml: buildStandaloneHtml,
    downloadHtmlFile: downloadHtmlFile,
    markConsentBannerShown: markConsentBannerShown,
    getConsent: getConsent,
    setConsent: setConsent,
    track: track,
    getEvents: getEvents,
    clearEvents: clearEvents
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Second-layer 24-block views for Victory Park (from scratch): All 35 Rides, Ticket/QR/Save/Print/Transfer, Sessions (seated & unseated), Card Top-Up, History, Visit/Rules, Park Zones. */
(function (global) {
  'use strict';

  var EVENTS_DATA = {
    show: {
      id: 'show',
      seated: true,
      price: 3500,
      durationMin: 50,
      title: {
        ru: 'Музыкальная история (с выбором кресел)',
        en: 'Musical Story (seated hall)',
        hy: 'Երաժշտական պատմություն (նստատեղերի ընտրությամբ)'
      },
      desc: {
        ru: 'Семейный спектакль с живой музыкой. Выберите кресла рядом на схеме зала.',
        en: 'Family performance with live music. Pick adjacent seats on the hall map.',
        hy: 'Ընտանեկան ներկայացում կենդանի երաժշտությամբ։ Ընտրեք կողք-կողքի տեղեր։'
      },
      rows: ['A', 'B', 'C'],
      cols: [1, 2, 3, 4, 5, 6],
      taken: ['A1', 'B3', 'B4', 'C6']
    },
    garden: {
      id: 'garden',
      seated: false,
      price: 2500,
      durationMin: 60,
      capacityLeft: 14,
      title: {
        ru: 'Творческая прогулка (свободное размещение)',
        en: 'Creative Garden Walk (general admission)',
        hy: 'Ստեղծագործական զբոսանք (ազատ տեղաբաշխում)'
      },
      desc: {
        ru: 'Небольшая группа, прогулка и мастерская под открытым небом. Без схемы кресел.',
        en: 'Small-group open-air walk and workshop. General admission without seat selection.',
        hy: 'Փոքր խմբով զբոսանք և արվեստանոց բաց երկնքի տակ՝ առանց նստատեղի ընտրության։'
      }
    }
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderAll35Screen(ctx) {
    var st = ctx.st, lang = st.lang, I = ctx.I, DATA = ctx.DATA;
    var openCount = DATA.rides.filter(function (r) { return r.demoStatus === 'open'; }).length;
    var list = st.onlyOpen
      ? DATA.rides.filter(function (r) { return r.demoStatus === 'open'; })
      : DATA.rides.slice().sort(function (a, b) {
          var aClosed = a.demoStatus === 'open' ? 0 : 1;
          var bClosed = b.demoStatus === 'open' ? 0 : 1;
          if (aClosed !== bClosed) return aClosed - bClosed;
          return a.rank - b.rank;
        });
    var statusCounts = { open: 0, paused: 0, closed: 0, unknown: 0 };
    DATA.rides.forEach(function (r) { statusCounts[r.demoStatus] = (statusCounts[r.demoStatus] || 0) + 1; });

    return (
      '<main class="vp-wrap vp-screen" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'allRidesTitle')) + '</h1>' +
        '</div>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'allRidesLead')) + '</div>' +
        '<div class="vp-switch-row" style="margin-bottom:12px">' +
          '<button type="button" class="vp-filter-pill" data-toggle-open="true" aria-pressed="' + (st.onlyOpen ? 'true' : 'false') + '">' +
            '<span class="vp-dot" aria-hidden="true"></span>' +
            esc(I.t(lang, 'filterOpen') + ' (' + openCount + ')') +
          '</button>' +
          (st.onlyOpen ? '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-toggle-open="true">' + esc(I.t(lang, 'allRidesResetFilter')) + '</button>' : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;font-size:12px">' +
          '<span class="vp-status-pill vp-status-pill--open">' + esc(I.t(lang, 'statusText.open')) + ': ' + statusCounts.open + '</span>' +
          '<span class="vp-status-pill vp-status-pill--paused">' + esc(I.t(lang, 'statusText.paused')) + ': ' + statusCounts.paused + '</span>' +
          '<span class="vp-status-pill vp-status-pill--closed">' + esc(I.t(lang, 'statusText.closed')) + ': ' + statusCounts.closed + '</span>' +
          '<span class="vp-status-pill vp-status-pill--unknown">' + esc(I.t(lang, 'statusText.unknown')) + ': ' + statusCounts.unknown + '</span>' +
        '</div>' +
        '<div class="vp-rides-grid vp-rides-grid--all">' +
          list.map(function (r) { return ctx.renderRideCard(r, st, false); }).join('') +
        '</div>' +
      '</main>'
    );
  }

  function renderTicketScreen(ctx, orderId, activeIndex, transferUrlForIdx, zoomedQrPayload) {
    var st = ctx.st, lang = st.lang, I = ctx.I, P = ctx.P, S = ctx.S;
    var order = orderId ? S.getOrderById(orderId) : S.getOrders()[0];
    if (!order) {
      return (
        '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
          '<div class="vp-screen-head">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="history">← ' + esc(I.t(lang, 'back')) + '</button>' +
            '<h1 class="vp-screen-title">' + esc(I.t(lang, 'ticketScreenTitle')) + '</h1>' +
          '</div>' +
          '<div class="vp-panel"><p>' + esc(I.t(lang, 'historyEmpty')) + '</p></div>' +
        '</main>'
      );
    }

    var tickets = order.tickets || [];
    var idx = Math.max(0, Math.min(tickets.length - 1, Number(activeIndex || 0)));
    var tk = tickets[idx];
    var selectorHtml = tickets.length > 1 ? (
      '<div class="vp-switch-row no-print" style="margin-bottom:12px">' +
        tickets.map(function (item, i) {
          return '<button type="button" class="vp-chip" data-ticket-select="' + esc(order.id + ':' + i) + '" aria-pressed="' + (i === idx ? 'true' : 'false') + '">#' + (i + 1) + ' ' + esc(item.shortTitle || item.title) + '</button>';
        }).join('') +
      '</div>'
    ) : '';

    var qrSvg = S.renderQrSvg(tk.qrPayload || tk.code, 5);
    var transferBlock = '';
    if (tk.transferable) {
      transferBlock = '<button type="button" class="vp-btn vp-btn--ghost" data-ticket-transfer="' + esc(order.id + ':' + idx) + '">' + esc(I.t(lang, 'ticketTransferBtn')) + '</button>';
    } else {
      transferBlock = '<div class="vp-demo-tag" style="margin-top:6px">' + esc(I.t(lang, 'ticketTransferNote')) + '</div>';
    }

    var transferResultHtml = '';
    if (transferUrlForIdx && transferUrlForIdx.idx === idx && transferUrlForIdx.orderId === order.id) {
      transferResultHtml = (
        '<div class="vp-panel no-print" data-transfer-box="true" style="background:var(--vp-surface);margin-top:10px">' +
          '<div style="font-size:13px;font-weight:700;margin-bottom:6px">' + esc(I.t(lang, 'ticketTransferReady')) + '</div>' +
          '<input type="text" readonly class="vp-input" data-transfer-url-input="true" value="' + esc(transferUrlForIdx.url) + '" style="width:100%;font-size:13px">' +
          '<div class="vp-switch-row" style="margin-top:8px">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-copy-text="' + esc(transferUrlForIdx.url) + '">' + esc(I.t(lang, 'ticketCopyCode')) + '</button>' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="' + esc(transferUrlForIdx.url) + '" data-open-transfer-link="true">' + esc(I.t(lang, 'ticketTransferOpenClean')) + '</a>' +
          '</div>' +
        '</div>'
      );
    }

    // Printable hidden view includes ALL tickets of the order (Block 15!)
    var printAllHtml = tickets.map(function (item, i) {
      return (
        '<article class="vp-print-ticket">' +
          '<div class="vp-demo-stamp">' + esc(I.t(lang, 'ticketDemoStamp')) + '</div>' +
          '<h2>#' + (i + 1) + ' ' + esc(item.title) + '</h2>' +
          '<p>' + esc(item.unit) + ' · ' + esc(item.recipient) + '</p>' +
          '<div class="vp-qr-box">' + S.renderQrSvg(item.qrPayload || item.code, 4) + '</div>' +
          '<p class="vp-mono-code">' + esc(item.code) + '</p>' +
          '<p style="font-size:12px">' + esc(item.validity) + ' · ' + esc(item.included || '') + '</p>' +
        '</article>'
      );
    }).join('');

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head no-print">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="history">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'ticketScreenTitle')) + ' #' + esc(order.id) + '</h1>' +
        '</div>' +
        selectorHtml +
        '<section class="vp-panel vp-ticket-card no-print" data-active-ticket="' + esc(tk.code) + '">' +
          '<div class="vp-demo-stamp">' + esc(I.t(lang, 'ticketDemoStamp')) + '</div>' +
          '<h2 style="margin:8px 0 4px;font-size:20px;color:var(--vp-cobalt)">' + esc(tk.title) + '</h2>' +
          '<div style="font-size:13px;color:var(--vp-ink-muted);margin-bottom:10px">' + esc(tk.unit) + ' · ' + esc(P.formatAmd(tk.price, lang)) + '</div>' +
          '<div class="vp-qr-row">' +
            '<div class="vp-qr-box" data-qr-svg="true" data-qr-payload="' + esc(tk.qrPayload || tk.code) + '">' + qrSvg + '</div>' +
            '<div class="vp-qr-meta">' +
              '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketManualCode')) + '</span><div class="vp-mono-code">' + esc(tk.code) + '</div></div>' +
              '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketRecipient')) + ':</span> <strong>' + esc(tk.recipient) + '</strong></div>' +
              '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketValidity')) + ':</span> ' + esc(tk.validity) + '</div>' +
              (tk.included ? '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketIncluded')) + ':</span> ' + esc(tk.included) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="vp-switch-row" style="margin-top:12px">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-zoom-qr="' + esc(tk.qrPayload || tk.code) + '">' + esc(I.t(lang, 'ticketZoomQr')) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-copy-text="' + esc(tk.code) + '">' + esc(I.t(lang, 'ticketCopyCode')) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-save-ticket="' + esc(order.id + ':' + idx) + '">' + esc(I.t(lang, 'ticketSaveOne')) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-save-order="' + esc(order.id) + '">' + esc(I.t(lang, 'ticketSaveAll', { n: tickets.length })) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-print-tickets="true">' + esc(I.t(lang, 'ticketPrint')) + '</button>' +
          '</div>' +
          '<div style="margin-top:10px">' + transferBlock + '</div>' +
          transferResultHtml +
        '</section>' +
        '<section class="print-only" aria-hidden="true">' + printAllHtml + '</section>' +
      '</main>'
    );
  }

  function renderShareScreen(ctx, token) {
    var st = ctx.st, lang = st.lang, I = ctx.I, S = ctx.S;
    var tk = S.decodeTransferTicket(token);
    if (!tk) {
      return (
        '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'shareTitle')) + '</h1>' +
          '<div class="vp-notice">' + esc(I.t(lang, 'shareInvalid')) + '</div>' +
          '<a class="vp-btn vp-btn--ghost" href="#/">' + esc(I.t(lang, 'menuItems.home')) + '</a>' +
        '</main>'
      );
    }
    var qrSvg = S.renderQrSvg('VP-DEMO-TRANSFER|' + tk.code, 5);
    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content" data-shared-ticket-only="true">' +
        '<h1 class="vp-screen-title">' + esc(I.t(lang, 'shareTitle')) + '</h1>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'shareIntro')) + '</div>' +
        '<section class="vp-panel vp-ticket-card" data-transferred-code="' + esc(tk.code) + '">' +
          '<div class="vp-demo-stamp">' + esc(I.t(lang, 'ticketDemoStamp')) + '</div>' +
          '<h2 style="margin:8px 0 4px;color:var(--vp-cobalt)">' + esc(tk.title) + '</h2>' +
          '<div style="font-size:13px;color:var(--vp-ink-muted);margin-bottom:10px">' + esc(tk.unit) + '</div>' +
          '<div class="vp-qr-row">' +
            '<div class="vp-qr-box" data-qr-svg="true" data-qr-payload="VP-DEMO-TRANSFER|' + esc(tk.code) + '">' + qrSvg + '</div>' +
            '<div class="vp-qr-meta">' +
              '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketManualCode')) + '</span><div class="vp-mono-code">' + esc(tk.code) + '</div></div>' +
              '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketRecipient')) + ':</span> <strong>' + esc(tk.recipient) + '</strong></div>' +
              '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketValidity')) + ':</span> ' + esc(tk.validity) + '</div>' +
              (tk.included ? '<div><span class="vp-demo-tag">' + esc(I.t(lang, 'ticketIncluded')) + ':</span> ' + esc(tk.included) + '</div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="vp-switch-row" style="margin-top:12px">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-print-tickets="true">' + esc(I.t(lang, 'ticketPrint')) + '</button>' +
          '</div>' +
        '</section>' +
      '</main>'
    );
  }

  function renderSessionsScreen(ctx) {
    var st = ctx.st, lang = st.lang, I = ctx.I, P = ctx.P;
    var draft = st.sessionDraft;
    var evObj = EVENTS_DATA[draft.eventId] || EVENTS_DATA.show;
    var times = ['12:00', '17:00', '19:00'];
    var total = evObj.seated
      ? (draft.seats.length * evObj.price)
      : (draft.guests * evObj.price);

    var eventCards = ['show', 'garden'].map(function (eid) {
      var e = EVENTS_DATA[eid];
      var active = draft.eventId === eid;
      return (
        '<button type="button" class="vp-panel vp-select-card' + (active ? ' vp-select-card--active' : '') + '" data-session-event="' + eid + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
          '<strong>' + esc(e.title[lang] || e.title.ru) + '</strong>' +
          '<div style="font-size:13px;color:var(--vp-ink-muted);margin:4px 0">' + esc(e.desc[lang] || e.desc.ru) + '</div>' +
          '<div style="font-size:13px;font-weight:700;color:var(--vp-cobalt)">' + esc(P.formatAmd(e.price, lang)) + ' · ' + e.durationMin + ' ' + esc(I.t(lang, 'minSuffix')) + '</div>' +
        '</button>'
      );
    }).join('');

    var step1Html =
      '<div class="vp-panel">' +
        '<div style="display:grid;gap:10px">' +
          '<label><strong>' + esc(I.t(lang, 'sessionsDateLabel')) + '</strong><br>' +
            '<input type="date" class="vp-input" data-session-date="true" value="' + esc(draft.date) + '" min="2026-11-20" max="2026-12-31">' +
          '</label>' +
          '<div><strong>' + esc(I.t(lang, 'sessionsTimeLabel')) + '</strong>' +
            '<div class="vp-switch-row" style="margin-top:6px">' +
              times.map(function (tm) {
                return '<button type="button" class="vp-chip" data-session-time="' + tm + '" aria-pressed="' + (draft.time === tm ? 'true' : 'false') + '">' + tm + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var step2Html = '';
    if (evObj.seated) {
      var rowsHtml = evObj.rows.map(function (row) {
        return (
          '<div class="vp-seat-row">' +
            '<span class="vp-seat-row-label">' + row + '</span>' +
            evObj.cols.map(function (col) {
              var code = row + col;
              var isTaken = evObj.taken.indexOf(code) >= 0;
              var isSel = draft.seats.indexOf(code) >= 0;
              return '<button type="button" class="vp-seat-btn' + (isTaken ? ' vp-seat-btn--taken' : isSel ? ' vp-seat-btn--sel' : '') + '" ' +
                (isTaken ? 'disabled ' : '') + 'data-session-seat="' + code + '" aria-pressed="' + (isSel ? 'true' : 'false') + '">' + code + '</button>';
            }).join('') +
          '</div>'
        );
      }).join('');
      step2Html = (
        '<div class="vp-panel" data-seat-map="true">' +
          '<h2 style="margin:0 0 8px;font-size:16px">' + esc(I.t(lang, 'sessionsSeatsTitle')) + '</h2>' +
          '<div class="vp-seat-grid">' + rowsHtml + '</div>' +
          '<div style="font-size:13px;margin-top:8px"><strong>' + esc(I.t(lang, 'sessionsSeatsSelected', { seats: draft.seats.join(', ') || '—' })) + '</strong></div>' +
        '</div>'
      );
    } else {
      step2Html = (
        '<div class="vp-panel" data-general-capacity="true">' +
          '<p style="margin:0 0 10px;font-size:13.5px">' + esc(I.t(lang, 'sessionsNoSeatsNotice', { left: evObj.capacityLeft })) + '</p>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<strong>' + esc(I.t(lang, 'sessionsGuestsLabel')) + ':</strong>' +
            [1, 2, 3, 4].map(function (n) {
              return '<button type="button" class="vp-chip" data-session-guests="' + n + '" aria-pressed="' + (draft.guests === n ? 'true' : 'false') + '">' + n + '</button>';
            }).join('') +
          '</div>' +
        '</div>'
      );
    }

    var canBook = evObj.seated ? draft.seats.length > 0 : draft.guests >= 1;
    var bookHtml =
      '<div class="vp-panel">' +
        '<div class="vp-total-row" style="margin-top:0;padding-top:0;border-top:0">' +
          '<span class="vp-total-approx">' + esc(draft.date + ' · ' + draft.time) + '</span>' +
          '<span class="vp-total-amd" data-session-total="' + total + '">' + esc(P.formatAmd(total, lang)) + '</span>' +
        '</div>' +
        '<div class="vp-cta-row">' +
          '<button type="button" class="vp-btn vp-btn--primary" data-book-session="true"' + (canBook ? '' : ' disabled') + '>' +
            esc(I.t(lang, 'sessionsBookBtn', { sum: P.formatAmd(total, lang) })) +
          '</button>' +
        '</div>' +
      '</div>';

    var bodyHtml = '';
    if (draft.mode === 'step') {
      if (draft.step === 1) {
        bodyHtml = step1Html + '<button type="button" class="vp-btn vp-btn--cobalt" data-session-step="2">' + esc(I.t(lang, 'sessionsStepNext')) + ' →</button>';
      } else {
        bodyHtml = step2Html + bookHtml + '<button type="button" class="vp-btn vp-btn--ghost" style="margin-top:8px" data-session-step="1">← ' + esc(I.t(lang, 'sessionsStepPrev')) + '</button>';
      }
    } else {
      bodyHtml = step1Html + step2Html + bookHtml;
    }

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'sessionsTitle')) + '</h1>' +
        '</div>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'sessionsDemoNotice')) + '</div>' +
        '<div class="vp-switch-row" style="margin-bottom:12px">' +
          '<button type="button" class="vp-chip" data-session-mode="full" aria-pressed="' + (draft.mode === 'full' ? 'true' : 'false') + '">' + esc(I.t(lang, 'sessionsModeFull')) + '</button>' +
          '<button type="button" class="vp-chip" data-session-mode="step" aria-pressed="' + (draft.mode === 'step' ? 'true' : 'false') + '">' + esc(I.t(lang, 'sessionsModeStep')) + '</button>' +
        '</div>' +
        '<div style="display:grid;gap:10px;margin-bottom:12px">' + eventCards + '</div>' +
        bodyHtml +
      '</main>'
    );
  }

  function renderTopupScreen(ctx, topupError, latestTopup) {
    var st = ctx.st, lang = st.lang, I = ctx.I, P = ctx.P;
    var draft = st.topupDraft;
    var quickAmounts = [2000, 5000, 10000, 15000];
    var statusHtml = '';
    if (latestTopup) {
      statusHtml = (
        '<section class="vp-panel" data-topup-result="' + esc(latestTopup.creditStatus) + '" style="border-color:var(--vp-cobalt)">' +
          '<div style="font-weight:700;color:var(--vp-open-ink);margin-bottom:6px">✓ ' + esc(I.t(lang, 'topupChargeOk', { sum: P.formatAmd(latestTopup.amount, lang) })) + '</div>' +
          (latestTopup.creditStatus === 'credited'
            ? '<div style="font-weight:700;color:var(--vp-open-ink)">✓ ' + esc(I.t(lang, 'topupCreditOk', { sum: P.formatAmd(latestTopup.amount, lang), card: latestTopup.card })) + '</div>'
            : '<div style="font-weight:700;color:var(--vp-paused-ink);margin-bottom:8px">⏳ ' + esc(I.t(lang, 'topupCreditPending', { card: latestTopup.card })) + '</div>' +
              '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-recover-topup="' + esc(latestTopup.id) + '">' + esc(I.t(lang, 'topupRecoverBtn')) + '</button>'
          ) +
        '</section>'
      );
    }

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'topupTitle')) + '</h1>' +
        '</div>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'topupLead')) + '</div>' +
        statusHtml +
        '<section class="vp-panel">' +
          '<div style="display:grid;gap:12px">' +
            '<label><strong>' + esc(I.t(lang, 'topupCardLabel')) + '</strong><br>' +
              '<input type="text" inputmode="numeric" class="vp-input" data-topup-card="true" value="' + esc(draft.card) + '" placeholder="10248899" style="width:100%;margin-top:4px">' +
            '</label>' +
            '<div><strong>' + esc(I.t(lang, 'topupAmountLabel')) + '</strong>' +
              '<div class="vp-switch-row" style="margin:6px 0">' +
                quickAmounts.map(function (amt) {
                  return '<button type="button" class="vp-chip" data-topup-quick="' + amt + '" aria-pressed="' + (Number(draft.amount) === amt ? 'true' : 'false') + '">' + esc(P.formatAmd(amt, lang)) + '</button>';
                }).join('') +
              '</div>' +
              '<input type="number" class="vp-input" data-topup-amount="true" min="500" max="200000" step="100" value="' + esc(draft.amount) + '" style="width:160px">' +
            '</div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px">' +
              '<input type="checkbox" data-topup-delay="true"' + (draft.delayCredit ? ' checked' : '') + '>' +
              '<span>' + esc(I.t(lang, 'topupDelayToggle')) + '</span>' +
            '</label>' +
            (topupError ? '<div style="color:var(--vp-closed-ink);font-weight:600;font-size:13px" role="alert">' + esc(topupError) + '</div>' : '') +
            '<div class="vp-cta-row" style="margin-top:4px"><button type="button" class="vp-btn vp-btn--primary" data-submit-topup="true">' + esc(I.t(lang, 'topupSubmitBtn', { sum: P.formatAmd(draft.amount || 0, lang) })) + '</button></div>' +
          '</div>' +
        '</section>' +
      '</main>'
    );
  }

  function renderHistoryScreen(ctx, activeTab) {
    var st = ctx.st, lang = st.lang, I = ctx.I, P = ctx.P, S = ctx.S;
    var tab = activeTab || 'orders';
    var orders = S.getOrders();
    var sessions = S.getSessions();
    var topups = S.getTopups();
    var pending = S.getPendingAttempt();

    var pendingHtml = pending ? (
      '<div class="vp-undo-banner" style="border-color:var(--vp-paused-ink)">' +
        '<span>' + esc(I.t(lang, 'historyPendingBanner', { id: pending.id })) + '</span>' +
        '<a class="vp-btn vp-btn--sm vp-btn--cobalt" href="#/checkout">' + esc(I.t(lang, 'checkoutCheckStatusBtn')) + '</a>' +
      '</div>'
    ) : '';

    var body = '';
    if (tab === 'orders') {
      body = orders.length ? orders.map(function (o) {
        return (
          '<article class="vp-panel" data-history-order="' + esc(o.id) + '">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
              '<div><strong>#' + esc(o.id) + '</strong> · ' + esc((o.confirmedAt || o.createdAt || '').slice(0, 16).replace('T', ' ')) + '</div>' +
              '<strong>' + esc(P.formatAmd(o.total, lang)) + '</strong>' +
            '</div>' +
            '<div style="font-size:13px;color:var(--vp-ink-muted);margin:6px 0">' + esc(o.summaryText || '') + '</div>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-open-order="' + esc(o.id) + '">' + esc(I.t(lang, 'historyOpenBtn')) + ' (' + (o.tickets ? o.tickets.length : 0) + ')</button>' +
          '</article>'
        );
      }).join('') : '<div class="vp-panel">' + esc(I.t(lang, 'historyEmpty')) + '</div>';
    } else if (tab === 'sessions') {
      body = sessions.length ? sessions.map(function (s) {
        return (
          '<article class="vp-panel" data-history-session="' + esc(s.id) + '">' +
            '<div style="display:flex;justify-content:space-between;gap:8px">' +
              '<strong>' + esc(s.title) + '</strong>' +
              '<strong>' + esc(P.formatAmd(s.total, lang)) + '</strong>' +
            '</div>' +
            '<div style="font-size:13px;color:var(--vp-ink-muted);margin:4px 0">' + esc(s.date + ' ' + s.time + ' · ' + s.detail) + '</div>' +
            '<div class="vp-qr-box" style="width:120px;height:120px;margin:8px 0">' + S.renderQrSvg(s.code, 3) + '</div>' +
            '<div class="vp-mono-code">' + esc(s.code) + '</div>' +
          '</article>'
        );
      }).join('') : '<div class="vp-panel">' + esc(I.t(lang, 'historyEmpty')) + '</div>';
    } else {
      body = topups.length ? topups.map(function (tp) {
        return (
          '<article class="vp-panel" data-history-topup="' + esc(tp.id) + '">' +
            '<div style="display:flex;justify-content:space-between;gap:8px">' +
              '<strong>' + esc(I.t(lang, 'cardWord')) + ' ' + esc(tp.card) + '</strong>' +
              '<strong>' + esc(P.formatAmd(tp.amount, lang)) + '</strong>' +
            '</div>' +
            '<div style="font-size:13px;margin-top:4px">' +
              esc(tp.creditStatus === 'credited' ? I.t(lang, 'topupCreditOk', { sum: P.formatAmd(tp.amount, lang), card: tp.card }) : I.t(lang, 'topupCreditPending', { card: tp.card })) +
            '</div>' +
            (tp.creditStatus !== 'credited' ? '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" style="margin-top:8px" data-recover-topup="' + esc(tp.id) + '">' + esc(I.t(lang, 'topupRecoverBtn')) + '</button>' : '') +
          '</article>'
        );
      }).join('') : '<div class="vp-panel">' + esc(I.t(lang, 'historyEmpty')) + '</div>';
    }

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'historyTitle')) + '</h1>' +
        '</div>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'historyImmutableNote')) + '</div>' +
        pendingHtml +
        '<div class="vp-switch-row" style="margin-bottom:12px">' +
          '<button type="button" class="vp-chip" data-history-tab="orders" aria-pressed="' + (tab === 'orders' ? 'true' : 'false') + '">' + esc(I.t(lang, 'historyTabOrders', { n: orders.length })) + '</button>' +
          '<button type="button" class="vp-chip" data-history-tab="sessions" aria-pressed="' + (tab === 'sessions' ? 'true' : 'false') + '">' + esc(I.t(lang, 'historyTabSessions', { n: sessions.length })) + '</button>' +
          '<button type="button" class="vp-chip" data-history-tab="topups" aria-pressed="' + (tab === 'topups' ? 'true' : 'false') + '">' + esc(I.t(lang, 'historyTabTopups', { n: topups.length })) + '</button>' +
        '</div>' +
        body +
      '</main>'
    );
  }

  function renderVisitScreen(ctx) {
    var st = ctx.st, lang = st.lang, I = ctx.I, DATA = ctx.DATA;
    var items = I.DICT[lang].visitFacts.map(function (f) { return '<li style="margin-bottom:8px">' + esc(f) + '</li>'; }).join('');
    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'visitTitle')) + '</h1>' +
        '</div>' +
        '<section class="vp-panel">' +
          '<ul style="margin:0;padding-left:18px;font-size:14px">' + items + '</ul>' +
          '<div class="vp-switch-row" style="margin-top:14px">' +
            '<a class="vp-btn vp-btn--sm vp-btn--cobalt" href="' + esc(DATA.park.mapHref) + '" target="_blank" rel="noopener noreferrer">' + esc(I.t(lang, 'address')) + ' ↗</a>' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="' + esc(DATA.park.phoneHref) + '">' + esc(DATA.park.phone) + '</a>' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="#/all">' + esc(I.t(lang, 'menuItems.all')) + '</a>' +
          '</div>' +
        '</section>' +
      '</main>'
    );
  }

  function renderZoneScreen(ctx, zoneSlug, dinoQty) {
    var st = ctx.st, lang = st.lang, I = ctx.I, P = ctx.P, DATA = ctx.DATA, ASSET_BASE = ctx.ASSET_BASE;
    var z = I.DICT[lang].zones[zoneSlug] || I.DICT[lang].zones['dino-park'];
    var qty = Math.max(1, Math.min(10, Number(dinoQty || 1)));
    var actionBlock = '';
    if (z.demoPrice) {
      var sum = z.demoPrice * qty;
      actionBlock = (
        '<div class="vp-panel">' +
          '<div class="vp-switch-row" style="margin-bottom:10px">' +
            [1, 2, 3, 4].map(function (n) {
              return '<button type="button" class="vp-chip" data-dino-qty="' + n + '" aria-pressed="' + (qty === n ? 'true' : 'false') + '">' + n + '</button>';
            }).join('') +
          '</div>' +
          '<button type="button" class="vp-btn vp-btn--primary" data-buy-dino="' + qty + '">' + esc(I.t(lang, 'zoneBuyDemoBtn', { sum: P.formatAmd(sum, lang) })) + '</button>' +
        '</div>'
      );
    } else {
      actionBlock = (
        '<div class="vp-switch-row">' +
          '<a class="vp-btn vp-btn--sm vp-btn--cobalt" href="' + esc(DATA.park.phoneHref) + '">' + esc(DATA.park.phone) + '</a>' +
          '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="' + esc(DATA.park.mapHref) + '" target="_blank" rel="noopener noreferrer">' + esc(I.t(lang, 'address')) + ' ↗</a>' +
        '</div>'
      );
    }

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(z.title) + '</h1>' +
        '</div>' +
        '<article class="vp-ride-card" style="margin-bottom:12px">' +
          '<div class="vp-card-media" style="height:240px">' +
            '<img src="' + esc(ASSET_BASE + 'assets/photos/' + z.img + '-780.webp') + '" alt="' + esc(z.title) + '">' +
            '<span class="vp-photo-badge">' + esc(I.t(lang, 'demoPhoto')) + '</span>' +
          '</div>' +
          '<div class="vp-card-body">' +
            '<p style="margin:0;font-size:15px">' + esc(z.lead) + '</p>' +
            '<p style="margin:6px 0 0;font-size:13px;color:var(--vp-ink-muted)">' + esc(z.note) + '</p>' +
          '</div>' +
        '</article>' +
        actionBlock +
      '</main>'
    );
  }

  global.VPFullExtraPages = {
    EVENTS_DATA: EVENTS_DATA,
    renderAll35Screen: renderAll35Screen,
    renderTicketScreen: renderTicketScreen,
    renderShareScreen: renderShareScreen,
    renderSessionsScreen: renderSessionsScreen,
    renderTopupScreen: renderTopupScreen,
    renderHistoryScreen: renderHistoryScreen,
    renderVisitScreen: renderVisitScreen,
    renderZoneScreen: renderZoneScreen
  };
})(typeof window !== 'undefined' ? window : globalThis);

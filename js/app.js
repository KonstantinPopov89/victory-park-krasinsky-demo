/* Victory Park full-site controller (from scratch): Main Path + 24-block Second Layer */
(function () {
  'use strict';

  var DATA = window.VP_FULL_DATA;
  var RATES = window.VP_FULL_RATES;
  var P = window.VPFullPricing;
  var I = window.VPFullI18n;
  var S = window.VPFullStore;
  var EX = window.VPFullExtraPages;

  var ASSET_BASE = document.documentElement.dataset.assetBase || './';
  var PAGE_LANG = I.getLang(document.documentElement.lang || 'ru');

  var ui = {
    modal: null,            // null | 'company' | 'menu' | 'qr'
    qrZoomPayload: '',
    lastTriggerSelector: null,
    termsExpanded: true,
    checkoutFeedback: null, // { kind, orderId, busy }
    ticketOrderId: null,
    ticketIndex: 0,
    transferPreview: null,  // { orderId, idx, url }
    historyTab: 'orders',
    ticketsTab: 'packages',
    unlimitedRecipient: '',
    topupError: '',
    latestTopup: null,
    dinoQty: 1,
    checkoutSource: 'day',
    lastTrackedHead: ''
  };

  var trackedImpressions = {};
  var skippedTracked = {};
  var skipObserver = null;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function parseRoute() {
    var raw = (window.location.hash || '#/').replace(/^#/, '');
    var qIdx = raw.indexOf('?');
    var pathPart = (qIdx >= 0 ? raw.slice(0, qIdx) : raw).replace(/^\/+|\/+$/g, '');
    var queryPart = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
    var params = new URLSearchParams(queryPart);
    var segs = pathPart ? pathPart.split('/') : [];
    var head = segs[0] || 'home';
    return { head: head, arg: segs[1] || '', params: params };
  }

  function navigate(hashTarget) {
    var target = hashTarget.indexOf('#') === 0 ? hashTarget : ('#/' + hashTarget.replace(/^\/+/, ''));
    if (window.location.hash !== target) {
      window.location.hash = target;
    } else {
      render();
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function initFromUrl() {
    var params = new URLSearchParams(window.location.search || '');
    var firstParam = params.get('first');
    var addRide = params.get('addRide');
    S.mutate(function (st) {
      st.lang = PAGE_LANG;
      if (firstParam === 'autodrom' || firstParam === 'passes') st.firstHit = firstParam;
      if (addRide && DATA.rides.some(function (r) { return r.slug === addRide; })) {
        if (st.hearts.indexOf(addRide) < 0) st.hearts.push(addRide);
      }
    });
  }

  function getOrderedRides(st) {
    var list = DATA.rides.slice();
    if (st.firstHit === 'autodrom') {
      var idx = list.findIndex(function (r) { return r.slug === 'autodrom'; });
      if (idx > 0) {
        var auto = list.splice(idx, 1)[0];
        list.unshift(auto);
      }
    }
    if (st.companyTags.length > 0 && !(st.companyTags.length === 1 && st.companyTags[0] === 'solo')) {
      var first = list[0];
      var rest = list.slice(1).sort(function (a, b) {
        var scoreA = st.companyTags.reduce(function (acc, tg) { return acc + (a.audiences.indexOf(tg) >= 0 ? 1 : 0); }, 0);
        var scoreB = st.companyTags.reduce(function (acc, tg) { return acc + (b.audiences.indexOf(tg) >= 0 ? 1 : 0); }, 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.rank - b.rank;
      });
      list = [first].concat(rest);
    }
    if (st.onlyOpen) {
      list = list.filter(function (r) { return r.demoStatus === 'open'; });
    } else {
      list = list.slice().sort(function (a, b) {
        var aClosed = a.demoStatus === 'open' ? 0 : 1;
        var bClosed = b.demoStatus === 'open' ? 0 : 1;
        if (aClosed !== bClosed) return aClosed - bClosed;
        return 0;
      });
    }
    return list;
  }

  function rideDisplayName(ride, lang, isAutodromHero) {
    if (isAutodromHero && ride.slug === 'autodrom' && ride.sketchTitle && ride.sketchTitle[lang]) {
      return ride.sketchTitle[lang];
    }
    return ride.name[lang] || ride.name.ru;
  }

  function photoSrc(ride, width) {
    return ASSET_BASE + 'assets/photos/' + ride.img + '-' + width + '.webp';
  }

  function detailHref(ride, lang) {
    return ASSET_BASE + lang + '/attractions/' + ride.slug + '/';
  }

  function computePricing(st) {
    return P.calculateForMatrix(DATA.rides, st.party, st.matrix);
  }

  function computeDirectOrder(st) {
    var lines = [];
    var total = 0;
    var count = 0;
    Object.keys(st.directCart).forEach(function (key) {
      var qty = Number(st.directCart[key] || 0);
      if (qty <= 0) return;
      count += qty;
      if (key.indexOf('package') === 0) {
        var sz = Number(key.replace('package', ''));
        var unit = sz * P.PKG_UNIT_PRICE;
        lines.push({ kind: 'package', productId: key, packageSize: sz, quantity: qty, unitPrice: unit, subtotal: unit * qty });
        total += unit * qty;
      } else if (key.indexOf('ticket:') === 0) {
        var slug = key.slice(7);
        var r = DATA.rides.find(function (x) { return x.slug === slug; });
        if (r) {
          lines.push({ kind: 'ticket', productId: 'ticket', rideSlug: slug, quantity: qty, unitPrice: r.price, subtotal: r.price * qty });
          total += r.price * qty;
        }
      }
    });
    (st.directUnlimited || []).forEach(function (item) {
      count += 1;
      lines.push({
        kind: 'unlimited',
        productId: 'unlimited-personal',
        quantity: 1,
        unitPrice: P.PERSONAL_UNLIMITED_PRICE,
        subtotal: P.PERSONAL_UNLIMITED_PRICE,
        recipientLabel: item.recipientLabel
      });
      total += P.PERSONAL_UNLIMITED_PRICE;
    });
    return { lines: lines, total: total, count: count };
  }

  function currentCheckoutPayload(st) {
    var lang = st.lang;
    var direct = computeDirectOrder(st);
    var src = st.checkoutSource || ui.checkoutSource || 'day';
    var useDirect = (src === 'direct' && direct.count > 0) || (direct.count > 0 && st.hearts.length === 0);
    if (useDirect) {
      return {
        source: 'direct',
        lines: direct.lines,
        total: direct.total,
        fingerprint: JSON.stringify({ s: 'direct', lines: direct.lines })
      };
    }
    var calc = computePricing(st);
    return {
      source: 'day',
      lines: calc.best.lines,
      total: calc.best.total,
      retailTotal: calc.retailTotal,
      saving: calc.best.saving,
      fingerprint: JSON.stringify({ s: 'day', party: st.party.length, lines: calc.best.lines, lang: lang })
    };
  }

  function buildOrderSnapshot(st, payload) {
    var lang = st.lang;
    var orderId = P.safeId('VP').toUpperCase();
    var now = new Date().toISOString();
    var tickets = [];
    var summaryParts = [];
    var idxCounter = 0;

    var locTicket = {
      ru: {
        packShort: function (sz) { return 'Пакет ' + sz; },
        packUnit: function (sz) { return sz + ' катаний · общий'; },
        packValid: '30 дней с подтверждения (Ереван, демо)',
        packInc: 'Все 35 аттракционов каталога (демо)',
        unlShort: 'Безлимит',
        unlUnit: 'Личный на 1 день (не передаётся)',
        unlInc: '31 из 35 аттракционов (без Виар на двоих, Dark VR, Тир, Игровые аппараты)',
        tkValid: '1 день с первого использования (демо)'
      },
      en: {
        packShort: function (sz) { return 'Pack ' + sz; },
        packUnit: function (sz) { return sz + ' rides · shared'; },
        packValid: '30 days from confirmation (Yerevan, demo)',
        packInc: 'All 35 catalog attractions (demo)',
        unlShort: 'Unlimited',
        unlUnit: 'Personal 1-day pass (non-transferable)',
        unlInc: '31 of 35 attractions (excl. VR for 2, Dark VR, Shooting Gallery, Arcade)',
        tkValid: '1 day from first use (demo)'
      },
      hy: {
        packShort: function (sz) { return 'Փաթեթ ' + sz; },
        packUnit: function (sz) { return sz + ' նստել · ընդհանուր'; },
        packValid: '30 օր հաստատումից (Երևան, դեմո)',
        packInc: 'Կատալոգի բոլոր 35 ատրակցիոնները (դեմո)',
        unlShort: 'Անսահմանափակ',
        unlUnit: 'Անձնական 1 օր (չի փոխանցվում)',
        unlInc: '31 ատրակցիոն 35-ից (առանց 2-տեղ VR, Dark VR, Հրաձգարան, Ավտոմատներ)',
        tkValid: '1 օր առաջին օգտագործումից (դեմո)'
      }
    }[lang];

    payload.lines.forEach(function (line) {
      if (line.kind === 'package') {
        summaryParts.push(I.t(lang, 'unitPackage', { size: line.packageSize }) + ' × ' + line.quantity);
        for (var q = 0; q < line.quantity; q++) {
          idxCounter += 1;
          var code = orderId + '-PK' + line.packageSize + '-' + idxCounter;
          tickets.push({
            code: code,
            qrPayload: 'VP-DEMO|' + orderId + '|' + code,
            shortTitle: locTicket.packShort(line.packageSize),
            title: I.t(lang, 'unitPackage', { size: line.packageSize }),
            unit: locTicket.packUnit(line.packageSize),
            recipient: I.t(lang, 'companyPeopleCount', { n: st.party.length }),
            validity: locTicket.packValid,
            included: locTicket.packInc,
            price: line.unitPrice,
            transferable: true
          });
        }
      } else if (line.kind === 'unlimited') {
        summaryParts.push(I.t(lang, 'unitUnlimited') + ' (' + line.recipientLabel + ')');
        idxCounter += 1;
        var uCode = orderId + '-UNL-' + idxCounter;
        tickets.push({
          code: uCode,
          qrPayload: 'VP-DEMO|' + orderId + '|' + uCode,
          shortTitle: locTicket.unlShort,
          title: I.t(lang, 'unitUnlimited'),
          unit: locTicket.unlUnit,
          recipient: line.recipientLabel,
          validity: DATA.personalUnlimited.validity[lang] || DATA.personalUnlimited.validity.ru,
          included: locTicket.unlInc,
          price: line.unitPrice,
          transferable: false
        });
      } else {
        var ride = DATA.rides.find(function (r) { return r.slug === line.rideSlug; });
        var rName = ride ? (ride.name[lang] || ride.name.ru) : line.rideSlug;
        summaryParts.push(rName + ' × ' + line.quantity);
        for (var j = 0; j < line.quantity; j++) {
          idxCounter += 1;
          var tCode = orderId + '-TK-' + idxCounter;
          tickets.push({
            code: tCode,
            qrPayload: 'VP-DEMO|' + orderId + '|' + tCode,
            shortTitle: rName,
            title: rName,
            unit: I.t(lang, 'unitTicket'),
            recipient: I.t(lang, 'participantPrefix'),
            validity: locTicket.tkValid,
            included: rName,
            price: line.unitPrice,
            transferable: true
          });
        }
      }
    });

    return {
      id: orderId,
      createdAt: now,
      confirmedAt: now,
      langAtIssue: lang,
      total: payload.total,
      summaryText: summaryParts.join('; '),
      tickets: tickets
    };
  }

  function renderHeader(st) {
    var lang = st.lang;
    var langs = ['ru', 'en', 'hy'].map(function (code) {
      var targetHref = ASSET_BASE + code + '/' + (window.location.search || '') + (window.location.hash || '#/');
      return '<a class="vp-lang-btn" href="' + esc(targetHref) + '" data-lang-switch="' + code + '" aria-current="' + (code === lang ? 'true' : 'false') + '">' + code.toUpperCase() + '</a>';
    }).join('');
    return (
      '<header class="vp-topbar">' +
        '<div class="vp-topbar-inner">' +
          '<a class="vp-brand" href="#/" data-nav="home">' +
            '<img src="' + esc(ASSET_BASE + 'assets/img/logo-80.webp') + '" alt="Victory Park" width="28" height="28">' +
            '<span class="vp-brand-name">' + esc(I.t(lang, 'brand')) + '</span>' +
          '</a>' +
          '<div class="vp-topbar-actions">' +
            '<nav class="vp-lang-group" aria-label="Language">' + langs + '</nav>' +
            '<button type="button" class="vp-icon-btn" data-open-modal="menu" aria-label="' + esc(I.t(lang, 'menuTitle')) + '">☰</button>' +
          '</div>' +
        '</div>' +
      '</header>'
    );
  }

  function renderRideCard(ride, st, isHero) {
    var lang = st.lang;
    var hearted = st.hearts.indexOf(ride.slug) >= 0;
    var userReact = st.reactions[ride.slug] || null;
    var title = rideDisplayName(ride, lang, isHero && st.firstHit === 'autodrom');
    var statusTxt = I.t(lang, 'statusText.' + ride.demoStatus);
    var heartLabel = hearted ? I.t(lang, 'heartRemove') : I.t(lang, 'heartAdd');
    var counts = {
      love: ride.demoReactions.love + (userReact === 'love' ? 1 : 0),
      fire: ride.demoReactions.fire + (userReact === 'fire' ? 1 : 0),
      wow: ride.demoReactions.wow + (userReact === 'wow' ? 1 : 0)
    };
    var imgAttrs = isHero ? 'fetchpriority="high" decoding="async"' : 'loading="lazy" decoding="async"';

    if (!trackedImpressions[ride.slug] && isHero) {
      trackedImpressions[ride.slug] = true;
      S.track('card_impression', { slug: ride.slug, position: 1, firstHit: st.firstHit });
    }

    return (
      '<article class="vp-ride-card' + (isHero ? ' vp-ride-card--hero' : '') + '" data-ride-card="' + esc(ride.slug) + '"' + (isHero ? ' data-first-card="true"' : '') + '>' +
        '<div class="vp-card-media">' +
          '<img src="' + esc(photoSrc(ride, isHero ? 780 : 390)) + '"' +
               ' srcset="' + esc(photoSrc(ride, 390)) + ' 390w, ' + esc(photoSrc(ride, 780)) + ' 780w, ' + esc(photoSrc(ride, 1440)) + ' 1440w"' +
               ' sizes="' + (isHero ? '(max-width: 719px) 100vw, 60vw' : '(max-width: 719px) 100vw, 48vw') + '"' +
               ' width="780" height="520"' +
               ' alt="' + esc(title) + '" ' + imgAttrs + '>' +
          '<span class="vp-photo-badge">' + esc(I.t(lang, 'demoPhoto')) + '</span>' +
          '<button type="button" class="vp-heart-btn" data-heart="' + esc(ride.slug) + '" aria-pressed="' + (hearted ? 'true' : 'false') + '" aria-label="' + esc(heartLabel + ': ' + title) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.5-9.5-8.5C.6 9.3 2.2 5 6 5c2.2 0 3.7 1.2 4.5 2.4L12 9.4l1.5-2C14.3 6.2 15.8 5 18 5c3.8 0 5.4 4.3 3.5 7.5C19 16.5 12 21 12 21z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="vp-card-body">' +
          '<div class="vp-card-head">' +
            '<h2 class="vp-card-title"><a href="' + esc(detailHref(ride, lang)) + '">' + esc(title) + '</a></h2>' +
            '<span class="vp-card-price">' + esc(P.formatAmd(ride.price, lang) + ' · ' + I.t(lang, 'demoPriceSuffix')) + '</span>' +
          '</div>' +
          '<div class="vp-card-status-row">' +
            '<span class="vp-status-pill vp-status-pill--' + esc(ride.demoStatus) + '" data-ride-status="' + esc(ride.demoStatus) + '">' +
              '<span class="vp-dot" aria-hidden="true"></span>' +
              esc(statusTxt + ' · ' + I.t(lang, 'demoStatusLabel')) +
            '</span>' +
            '<div class="vp-reactions" role="group" aria-label="' + esc(I.t(lang, 'demoDataLabel')) + '">' +
              '<div class="vp-react-tray">' +
                '<button type="button" class="vp-react-btn" data-react="' + esc(ride.slug) + ':love" aria-pressed="' + (userReact === 'love' ? 'true' : 'false') + '">❤️ ' + counts.love + '</button>' +
                '<button type="button" class="vp-react-btn" data-react="' + esc(ride.slug) + ':fire" aria-pressed="' + (userReact === 'fire' ? 'true' : 'false') + '">🔥 ' + counts.fire + '</button>' +
                '<button type="button" class="vp-react-btn" data-react="' + esc(ride.slug) + ':wow" aria-pressed="' + (userReact === 'wow' ? 'true' : 'false') + '">😍 ' + counts.wow + '</button>' +
              '</div>' +
              '<span class="vp-demo-tag">' + esc(I.t(lang, 'demoDataLabel')) + '</span>' +
            '</div>' +
          '</div>' +
          '<p class="vp-card-vibe">' + esc(ride.vibe[lang] || ride.vibe.ru) + '</p>' +
        '</div>' +
      '</article>'
    );
  }

  function renderConsentStrip(st) {
    if (S.getConsent() !== null) return '';
    S.markConsentBannerShown();
    var lang = st.lang;
    return (
      '<aside class="vp-consent-strip" data-consent-bar="true" aria-label="Analytics consent">' +
        '<p class="vp-consent-text">' + esc(I.t(lang, 'consentText')) + '</p>' +
        '<div class="vp-consent-actions">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-consent="yes">' + esc(I.t(lang, 'consentYes')) + '</button>' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-consent="no">' + esc(I.t(lang, 'consentNo')) + '</button>' +
        '</div>' +
      '</aside>'
    );
  }

  function renderHome(st) {
    var lang = st.lang;
    var rides = getOrderedRides(st);
    var openCount = DATA.rides.filter(function (r) { return r.demoStatus === 'open'; }).length;
    var dayPhrase = I.DICT[lang].dayPhrases[new Date().getDay()];
    var heroRide = rides[0];
    var restRides = st.showAllHome ? rides.slice(1) : rides.slice(1, 5);

    return (
      '<main class="vp-wrap" id="main-content">' +
        '<section class="vp-hero" data-hero="true">' +
          '<h1 class="vp-headline">' + esc(I.t(lang, 'headline')) + '</h1>' +
          '<div class="vp-meta-lines">' +
            '<p class="vp-invite-line">' +
              esc(I.t(lang, 'invitePrefix')) +
              '<a class="vp-address-link" href="' + esc(DATA.park.mapHref) + '" target="_blank" rel="noopener noreferrer">' + esc(I.t(lang, 'address')) + '</a>' +
            '</p>' +
            '<span class="vp-meta-sep" aria-hidden="true">·</span>' +
            '<p class="vp-hours-line">' +
              '<span>' + esc(DATA.park.hours) + '</span> · ' +
              '<a href="' + esc(DATA.park.phoneHref) + '">' + esc(DATA.park.phone) + '</a>' +
            '</p>' +
          '</div>' +
          '<div class="vp-day-filter-row">' +
            '<p class="vp-day-phrase">' + esc(dayPhrase) + '</p>' +
            '<button type="button" class="vp-filter-pill" data-toggle-open="true" aria-pressed="' + (st.onlyOpen ? 'true' : 'false') + '">' +
              '<span class="vp-dot" aria-hidden="true"></span>' +
              '<span>' + esc(I.t(lang, 'filterOpen')) + ' (' + openCount + ')</span>' +
            '</button>' +
          '</div>' +
        '</section>' +

        '<section class="vp-featured-section" aria-label="' + esc(I.t(lang, 'moreHitsHeading')) + '">' +
          (heroRide ? renderRideCard(heroRide, st, true) : '') +
          renderConsentStrip(st) +
        '</section>' +

        '<section class="vp-popular-section" aria-label="' + esc(I.t(lang, 'moreHitsHeading')) + '">' +
          '<h2 class="vp-section-heading">' + esc(I.t(lang, 'moreHitsHeading')) + '</h2>' +
          '<div class="vp-rides-grid' + (st.showAllHome ? ' vp-rides-grid--all' : '') + '">' +
            restRides.map(function (r) { return renderRideCard(r, st, false); }).join('') +
          '</div>' +
          '<div class="vp-more-row">' +
            '<button type="button" class="vp-btn vp-btn--ghost" data-toggle-all-home="true">' +
              esc(st.showAllHome ? I.t(lang, 'collapseRides') : I.t(lang, 'showAllRides', { n: rides.length })) +
            '</button>' +
            '<a class="vp-btn vp-btn--ghost" href="#/all">' + esc(I.t(lang, 'openAllCatalog')) + '</a>' +
          '</div>' +
        '</section>' +

        '<footer class="vp-demo-footer">' +
          '<div><strong>' + esc(I.t(lang, 'firstHitToggleLabel')) + ':</strong></div>' +
          '<div class="vp-switch-row">' +
            '<button type="button" class="vp-btn vp-btn--sm ' + (st.firstHit === 'passes' ? 'vp-btn--cobalt' : 'vp-btn--ghost') + '" data-first-hit="passes">' + esc(I.t(lang, 'firstHitPasses')) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm ' + (st.firstHit === 'autodrom' ? 'vp-btn--cobalt' : 'vp-btn--ghost') + '" data-first-hit="autodrom">' + esc(I.t(lang, 'firstHitAutodrom')) + '</button>' +
          '</div>' +
          '<div class="vp-switch-row">' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="#/sessions">' + esc(I.t(lang, 'menuItems.sessions')) + '</a>' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="#/topup">' + esc(I.t(lang, 'menuItems.topup')) + '</a>' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="#/history">' + esc(I.t(lang, 'menuItems.history')) + '</a>' +
            '<a class="vp-btn vp-btn--sm vp-btn--ghost" href="#/visit">' + esc(I.t(lang, 'menuItems.visit')) + '</a>' +
          '</div>' +
          '<div>' + esc(I.t(lang, 'ratesNote', { date: RATES.date })) + '</div>' +
        '</footer>' +
      '</main>'
    );
  }

  function renderDock(st, routeHead) {
    if (['home', 'all'].indexOf(routeHead) < 0) return '';
    var lang = st.lang;
    var calc = computePricing(st);
    var direct = computeDirectOrder(st);
    var hasHearts = st.hearts.length > 0;
    var activeTotal = hasHearts ? calc.best.total : direct.total;
    var approx = activeTotal > 0 ? P.formatApproxCurrencies(activeTotal, RATES) : '';
    var tagOrder = ['couple', 'family', 'friends', 'solo'];

    var tagsHtml = tagOrder.map(function (tg) {
      var active = st.companyTags.indexOf(tg) >= 0;
      return '<button type="button" class="vp-chip" data-company-tag="' + tg + '" aria-pressed="' + (active ? 'true' : 'false') + '">' + esc(I.t(lang, 'companyTags.' + tg)) + '</button>';
    }).join('');

    var editChip = '<button type="button" class="vp-chip vp-chip--edit" data-open-modal="company">' +
      esc(I.t(lang, 'companyEdit') + ' (' + st.party.length + ') ▾') + '</button>';

    var summaryHtml, ctaLabel, ctaTarget;
    if (hasHearts) {
      var savingTxt = calc.best.saving > 0 ? ' · ' + I.t(lang, 'dockSavedBadge', { sum: P.formatAmd(calc.best.saving, lang) }) : '';
      // Avoid duplicating total in middle column (shown boldly on pink CTA) so zero ellipsis clipping on 390px!
      summaryHtml =
        '<div class="vp-dock-summary" data-live-sum="' + calc.best.total + '">' +
          '<span class="vp-dock-main-line">' +
            esc(I.t(lang, 'dockRidesCount', { n: st.hearts.length }) + ' · ' + I.t(lang, 'companyPeopleCount', { n: st.party.length })) +
          '</span>' +
          '<span class="vp-dock-sub-line">' + esc(approx + savingTxt) + '</span>' +
        '</div>';
      ctaLabel = I.t(lang, 'dockCtaPicked', { sum: P.formatAmd(calc.best.total, lang) });
      ctaTarget = 'day';
    } else if (direct.count > 0) {
      summaryHtml =
        '<div class="vp-dock-summary" data-live-sum="' + direct.total + '">' +
          '<span class="vp-dock-main-line">' + esc(I.t(lang, 'ticketsSelected', { n: direct.count })) + '</span>' +
          '<span class="vp-dock-sub-line">' + esc(approx) + '</span>' +
        '</div>';
      ctaLabel = I.t(lang, 'dayProceedCheckout', { sum: P.formatAmd(direct.total, lang) });
      ctaTarget = 'checkout';
    } else {
      summaryHtml =
        '<div class="vp-dock-summary" data-live-sum="0">' +
          '<span class="vp-dock-main-line">' + esc(I.t(lang, 'companyPeopleCount', { n: st.party.length })) + '</span>' +
          '<span class="vp-dock-sub-line">' + esc(I.t(lang, 'dockEmptyHint')) + '</span>' +
        '</div>';
      ctaLabel = I.t(lang, 'dockCtaEmpty');
      ctaTarget = 'tickets';
    }

    return (
      '<section class="vp-dock" data-bottom-dock="true" aria-label="Company and tickets">' +
        '<div class="vp-dock-inner">' +
          '<div class="vp-dock-tags" role="group" aria-label="' + esc(I.t(lang, 'sheetTitle')) + '">' +
            tagsHtml + editChip +
          '</div>' +
          '<div class="vp-dock-action-row">' +
            '<a class="vp-dock-direct-link" href="#/tickets" data-direct-tickets="true">' + esc(I.t(lang, 'dockDirectLink')) + '</a>' +
            summaryHtml +
            '<button type="button" class="vp-dock-cta" data-dock-cta="' + ctaTarget + '">' + esc(ctaLabel) + '</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderDayScreen(st) {
    var lang = st.lang;
    var calc = computePricing(st);
    var undoHtml = '';
    if (st.lastRemoved) {
      var remRide = DATA.rides.find(function (r) { return r.slug === st.lastRemoved.slug; });
      if (remRide) {
        undoHtml =
          '<div class="vp-undo-banner" role="status">' +
            '<span>' + esc(I.t(lang, 'undoRemoved', { name: remRide.name[lang] || remRide.name.ru })) + '</span>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-undo-remove="true">' + esc(I.t(lang, 'undoBtn')) + '</button>' +
          '</div>';
      }
    }

    if (st.hearts.length === 0) {
      return (
        '<main class="vp-wrap vp-screen" id="main-content">' +
          '<div class="vp-screen-head">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
            '<h1 class="vp-screen-title">' + esc(I.t(lang, 'dayTitle')) + '</h1>' +
          '</div>' +
          undoHtml +
          '<div class="vp-panel">' +
            '<p>' + esc(I.t(lang, 'dayEmpty')) + '</p>' +
            '<div class="vp-switch-row">' +
              '<a class="vp-btn vp-btn--ghost" href="#/">' + esc(I.t(lang, 'menuItems.home')) + '</a>' +
              '<a class="vp-btn vp-btn--primary" href="#/tickets">' + esc(I.t(lang, 'ticketsDirectTitle')) + '</a>' +
            '</div>' +
          '</div>' +
        '</main>'
      );
    }

    var matrixHtml = st.hearts.map(function (slug) {
      var ride = DATA.rides.find(function (r) { return r.slug === slug; });
      if (!ride) return '';
      var perPerson = st.matrix[slug] || {};
      var steppers = st.party.map(function (person, idx) {
        var cnt = Number(perPerson[person.id] || 0);
        return (
          '<div class="vp-stepper">' +
            '<span>' + esc(I.t(lang, 'participantPrefix') + ' ' + (idx + 1)) + '</span>' +
            '<button type="button" data-matrix-delta="' + esc(slug + ':' + person.id + ':-1') + '" aria-label="-">−</button>' +
            '<strong data-matrix-val="' + esc(slug + ':' + person.id) + '">' + cnt + '</strong>' +
            '<button type="button" data-matrix-delta="' + esc(slug + ':' + person.id + ':1') + '" aria-label="+">+</button>' +
          '</div>'
        );
      }).join('');
      return (
        '<div class="vp-matrix-ride">' +
          '<div class="vp-matrix-ride-head">' +
            '<div><strong>' + esc(ride.name[lang] || ride.name.ru) + '</strong> · ' + esc(P.formatAmd(ride.price, lang)) + '</div>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-remove-ride="' + esc(slug) + '">' + esc(I.t(lang, 'dayRemoveRide')) + '</button>' +
          '</div>' +
          '<div class="vp-matrix-people">' + steppers + '</div>' +
        '</div>'
      );
    }).join('');

    var linesHtml = calc.best.lines.map(function (line) {
      var desc = line.kind === 'package'
        ? I.t(lang, 'unitPackage', { size: line.packageSize }) + ' × ' + line.quantity
        : I.t(lang, 'unitTicket') + ': ' + ((DATA.rides.find(function (x) { return x.slug === line.rideSlug; }) || {}).name || {})[lang] + ' × ' + line.quantity;
      return '<li class="vp-offer-line"><span>' + esc(desc) + '</span><strong>' + esc(P.formatAmd(line.subtotal, lang)) + '</strong></li>';
    }).join('');

    var unlComp = calc.unlimitedComparison;
    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'dayTitle')) + '</h1>' +
        '</div>' +
        undoHtml +
        '<div class="vp-notice">' + esc(I.t(lang, 'dayDraftNotice')) + '</div>' +
        '<section class="vp-panel">' +
          '<div class="vp-panel-head">' +
            '<h2 class="vp-panel-title">' + esc(I.t(lang, 'dayMatrixTitle')) + '</h2>' +
            '<button type="button" class="vp-chip vp-chip--edit" data-open-modal="company">' + esc(I.t(lang, 'companyEdit') + ' (' + st.party.length + ') ▾') + '</button>' +
          '</div>' +
          matrixHtml +
        '</section>' +
        '<section class="vp-panel" data-offer-panel="true">' +
          '<h2 class="vp-panel-title" style="margin-bottom:6px">' + esc(I.t(lang, 'dayOfferTitle')) + '</h2>' +
          '<div style="font-size:13px;color:var(--vp-ink-muted)">' + esc(I.t(lang, 'dayRetailCompare', { retail: P.formatAmd(calc.retailTotal, lang) })) + '</div>' +
          '<div style="font-size:13.5px;font-weight:600;color:var(--vp-open-ink);margin-top:4px">' +
            esc(calc.best.saving > 0 ? I.t(lang, 'daySavingsLine', { saving: P.formatAmd(calc.best.saving, lang) }) : I.t(lang, 'dayNoSavingsLine')) +
          '</div>' +
          '<ul class="vp-offer-lines">' + linesHtml + '</ul>' +
          '<div style="font-size:12.5px;color:var(--vp-ink-muted);margin:10px 0 4px">' +
            esc(I.t(lang, 'dayUnlimitedHint', { sum: P.formatAmd(unlComp.combinedTotal, lang), n: unlComp.participantCount })) +
            ' <a href="#/tickets">' + esc(I.t(lang, 'ticketsTabUnlimited')) + '</a>' +
          '</div>' +
          '<div class="vp-total-row">' +
            '<span class="vp-total-approx">' + esc(P.formatApproxCurrencies(calc.best.total, RATES)) + '</span>' +
            '<span class="vp-total-amd" data-offer-total="' + calc.best.total + '">' + esc(P.formatAmd(calc.best.total, lang)) + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--vp-ink-muted);margin-top:6px">' + esc(I.t(lang, 'ratesNote', { date: RATES.date })) + '</div>' +
          '<div class="vp-cta-row">' +
            '<button type="button" class="vp-btn vp-btn--primary" data-nav="checkout">' +
              esc(I.t(lang, 'dayProceedCheckout', { sum: P.formatAmd(calc.best.total, lang) })) +
            '</button>' +
          '</div>' +
        '</section>' +
      '</main>'
    );
  }

  function renderCheckoutScreen(st) {
    var lang = st.lang;
    var payload = currentCheckoutPayload(st);
    var pending = S.getPendingAttempt();
    var alreadyPaidOrderId = S.getPaidKeyOrder(payload.fingerprint);
    var retryLocked = pending && (pending.outcome === 'unknown' || pending.outcome === 'waiting');

    if (payload.lines.length === 0 && !pending && !ui.checkoutFeedback) {
      return (
        '<main class="vp-wrap vp-screen" id="main-content">' +
          '<div class="vp-screen-head">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
            '<h1 class="vp-screen-title">' + esc(I.t(lang, 'checkoutTitle')) + '</h1>' +
          '</div>' +
          '<div class="vp-panel"><p>' + esc(I.t(lang, 'checkoutEmpty')) + '</p><a class="vp-btn vp-btn--primary" href="#/tickets">' + esc(I.t(lang, 'ticketsDirectTitle')) + '</a></div>' +
        '</main>'
      );
    }

    var linesHtml = payload.lines.map(function (line) {
      var desc;
      if (line.kind === 'package') desc = I.t(lang, 'unitPackage', { size: line.packageSize }) + ' × ' + line.quantity;
      else if (line.kind === 'unlimited') desc = I.t(lang, 'unitUnlimited') + ' — ' + line.recipientLabel;
      else desc = I.t(lang, 'unitTicket') + ': ' + ((DATA.rides.find(function (x) { return x.slug === line.rideSlug; }) || {}).name || {})[lang] + ' × ' + line.quantity;
      return '<li class="vp-offer-line"><span>' + esc(desc) + '</span><strong>' + esc(P.formatAmd(line.subtotal, lang)) + '</strong></li>';
    }).join('');

    var feedbackHtml = '';
    if (ui.checkoutFeedback && ui.checkoutFeedback.busy) {
      feedbackHtml = '<div class="vp-outcome vp-outcome--waiting" role="alert"><strong>' + esc(I.t(lang, 'checkoutBusyNotice')) + '</strong></div>';
    } else if (pending) {
      var pKind = pending.outcome === 'unknown' ? 'unknown' : 'waiting';
      feedbackHtml = (
        '<div class="vp-outcome vp-outcome--' + pKind + '" data-payment-outcome="' + pKind + '" role="status">' +
          '<strong>' + esc(I.t(lang, pKind === 'unknown' ? 'checkoutOutcomeUnknown' : 'checkoutOutcomeWaiting')) + '</strong>' +
          '<div class="vp-switch-row">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-check-pending="true">' + esc(I.t(lang, 'checkoutCheckStatusBtn')) + '</button>' +
          '</div>' +
        '</div>'
      );
    } else if (ui.checkoutFeedback) {
      var fk = ui.checkoutFeedback.kind;
      var msgKey = {
        success: 'checkoutOutcomeSuccess',
        cancel: 'checkoutOutcomeCancel',
        error: 'checkoutOutcomeError'
      }[fk];
      if (msgKey) {
        feedbackHtml = (
          '<div class="vp-outcome vp-outcome--' + fk + '" data-payment-outcome="' + fk + '" role="status">' +
            '<strong>' + esc(I.t(lang, msgKey)) + '</strong>' +
            (fk === 'success' && ui.checkoutFeedback.orderId
              ? '<div><button type="button" class="vp-btn vp-btn--sm vp-btn--primary" data-open-order="' + esc(ui.checkoutFeedback.orderId) + '">' + esc(I.t(lang, 'checkoutOpenTicketBtn')) + '</button></div>'
              : '') +
          '</div>'
        );
      }
    }

    var alreadyHtml = alreadyPaidOrderId && (!ui.checkoutFeedback || ui.checkoutFeedback.orderId !== alreadyPaidOrderId) ? (
      '<div class="vp-outcome vp-outcome--success" data-idempotent-notice="true">' +
        '<strong>' + esc(I.t(lang, 'checkoutOrderAlreadyPaid', { id: alreadyPaidOrderId })) + '</strong>' +
        '<div><button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-open-order="' + esc(alreadyPaidOrderId) + '">' + esc(I.t(lang, 'checkoutOpenTicketBtn')) + '</button></div>' +
      '</div>'
    ) : '';

    var outcomes = ['success', 'cancel', 'error', 'waiting', 'unknown'];
    var simButtons = outcomes.map(function (oc) {
      return '<button type="button" class="vp-chip" data-sim-outcome="' + oc + '" aria-pressed="' + (st.checkoutOutcomeSim === oc ? 'true' : 'false') + '">' + esc(I.t(lang, 'checkoutOutcomes.' + oc)) + '</button>';
    }).join('');

    var terms = I.DICT[lang].checkoutTermsItems.map(function (item) {
      return '<li style="margin-bottom:6px">' + esc(item) + '</li>';
    }).join('');

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="' + (payload.source === 'day' ? 'day' : 'tickets') + '">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'checkoutTitle')) + '</h1>' +
        '</div>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'checkoutDemoBanner')) + '</div>' +
        feedbackHtml +
        alreadyHtml +
        '<section class="vp-panel">' +
          '<ul class="vp-offer-lines">' + linesHtml + '</ul>' +
          '<div class="vp-total-row">' +
            '<span class="vp-total-approx">' + esc(P.formatApproxCurrencies(payload.total, RATES)) + '</span>' +
            '<span class="vp-total-amd" data-checkout-total="' + payload.total + '">' + esc(P.formatAmd(payload.total, lang)) + '</span>' +
          '</div>' +
        '</section>' +
        '<section class="vp-panel">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-toggle-terms="true" aria-expanded="' + (ui.termsExpanded ? 'true' : 'false') + '" style="margin-bottom:10px">' +
            esc(I.t(lang, 'checkoutTermsToggle')) +
          '</button>' +
          (ui.termsExpanded
            ? '<h2 class="vp-panel-title" style="margin:2px 0 8px">' + esc(I.t(lang, 'checkoutTermsTitle')) + '</h2>' +
              '<ul style="padding-left:18px;margin:0;font-size:13.5px;color:var(--vp-ink-muted);line-height:1.5">' + terms + '</ul>'
            : '') +
        '</section>' +
        '<section class="vp-panel">' +
          '<div class="vp-panel-title" style="font-size:14px;margin-bottom:10px">' + esc(I.t(lang, 'checkoutSimTitle')) + '</div>' +
          '<div class="vp-switch-row">' + simButtons + '</div>' +
          '<div class="vp-cta-row">' +
            '<button type="button" class="vp-btn vp-btn--primary" data-pay-demo="true"' + (retryLocked || payload.total <= 0 ? ' disabled' : '') + '>' +
              esc(retryLocked ? I.t(lang, 'checkoutRetryLocked') : I.t(lang, 'checkoutPayBtn', { sum: P.formatAmd(payload.total, lang) })) +
            '</button>' +
          '</div>' +
        '</section>' +
      '</main>'
    );
  }

  function renderTicketsScreen(st) {
    var lang = st.lang;
    var direct = computeDirectOrder(st);
    var tab = ui.ticketsTab || 'packages';

    var body = '';
    if (tab === 'packages') {
      body = P.PKG_SIZES.map(function (sz) {
        var key = 'package' + sz;
        var qty = Number(st.directCart[key] || 0);
        return (
          '<div class="vp-guest-row">' +
            '<div><strong>' + esc(I.t(lang, 'unitPackage', { size: sz })) + '</strong><div style="font-size:13px;color:var(--vp-cobalt)">' + esc(P.formatAmd(sz * P.PKG_UNIT_PRICE, lang)) + '</div></div>' +
            '<div class="vp-stepper">' +
              '<button type="button" data-direct-delta="' + key + ':-1" aria-label="-">−</button>' +
              '<strong>' + qty + '</strong>' +
              '<button type="button" data-direct-delta="' + key + ':1" aria-label="+">+</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    } else if (tab === 'unlimited') {
      var recipientOpts = st.party.map(function (p, i) {
        var lbl = I.t(lang, 'participantPrefix') + ' ' + (i + 1);
        return '<option value="' + esc(lbl) + '">' + esc(lbl) + '</option>';
      }).join('') + '<option value="' + esc(I.t(lang, 'unlimitedAssignLater')) + '">' + esc(I.t(lang, 'unlimitedAssignLater')) + '</option>';
      var addedHtml = (st.directUnlimited || []).map(function (u) {
        return '<li class="vp-offer-line"><span>' + esc(u.recipientLabel) + ' · ' + esc(P.formatAmd(P.PERSONAL_UNLIMITED_PRICE, lang)) + '</span><button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-remove-unlimited="' + esc(u.id) + '">' + esc(I.t(lang, 'dayRemoveRide')) + '</button></li>';
      }).join('');
      body = (
        '<p style="margin:0 0 8px;font-size:14px">' + esc(I.t(lang, 'unlimitedCardDesc')) + '</p>' +
        '<div class="vp-notice">' + esc(I.t(lang, 'unlimitedExcludedLabel')) + '</div>' +
        '<label style="display:block;margin-bottom:10px"><strong>' + esc(I.t(lang, 'unlimitedRecipientLabel')) + '</strong><br>' +
          '<select class="vp-select" data-unlimited-recipient="true" style="width:100%;margin-top:4px">' + recipientOpts + '</select>' +
        '</label>' +
        '<button type="button" class="vp-btn vp-btn--cobalt" data-add-unlimited="true">' + esc(I.t(lang, 'unlimitedAddBtn')) + '</button>' +
        (addedHtml ? '<h3 style="margin:12px 0 6px;font-size:14px">' + esc(I.t(lang, 'unlimitedAddedList')) + '</h3><ul class="vp-offer-lines">' + addedHtml + '</ul>' : '')
      );
    } else {
      body = DATA.rides.map(function (r) {
        var key = 'ticket:' + r.slug;
        var qty = Number(st.directCart[key] || 0);
        return (
          '<div class="vp-guest-row">' +
            '<div><strong>' + esc(r.name[lang] || r.name.ru) + '</strong><div style="font-size:13px;color:var(--vp-cobalt)">' + esc(P.formatAmd(r.price, lang)) + '</div></div>' +
            '<div class="vp-stepper">' +
              '<button type="button" data-direct-delta="' + esc(key) + ':-1" aria-label="-">−</button>' +
              '<strong>' + qty + '</strong>' +
              '<button type="button" data-direct-delta="' + esc(key) + ':1" aria-label="+">+</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'ticketsDirectTitle')) + '</h1>' +
        '</div>' +
        '<p style="margin:0 0 12px;font-size:14px;color:var(--vp-ink-muted)">' + esc(I.t(lang, 'ticketsDirectLead')) + '</p>' +
        '<div class="vp-switch-row" style="margin-bottom:14px">' +
          '<button type="button" class="vp-chip" data-tickets-tab="packages" aria-pressed="' + (tab === 'packages' ? 'true' : 'false') + '">' + esc(I.t(lang, 'ticketsTabPackages')) + '</button>' +
          '<button type="button" class="vp-chip" data-tickets-tab="unlimited" aria-pressed="' + (tab === 'unlimited' ? 'true' : 'false') + '">' + esc(I.t(lang, 'ticketsTabUnlimited')) + '</button>' +
          '<button type="button" class="vp-chip" data-tickets-tab="single" aria-pressed="' + (tab === 'single' ? 'true' : 'false') + '">' + esc(I.t(lang, 'ticketsTabSingle')) + '</button>' +
        '</div>' +
        '<section class="vp-panel">' + body + '</section>' +
        (direct.count > 0 ? '<div class="vp-cta-row"><button type="button" class="vp-btn vp-btn--primary" data-direct-checkout="true">' + esc(I.t(lang, 'ticketsGoCheckout', { sum: P.formatAmd(direct.total, lang) })) + '</button></div>' : '') +
      '</main>'
    );
  }

  function renderLogScreen(st) {
    var lang = st.lang;
    var events = S.getEvents();
    var consent = S.getConsent() || 'not_set';
    var rows = events.length
      ? events.slice().reverse().map(function (ev) {
          return '<li class="vp-offer-line"><span><strong>' + esc(ev.event) + '</strong> · ' + esc(JSON.stringify(ev.data)) + '</span><span style="font-size:11px;color:var(--vp-ink-muted)">' + esc(ev.ts.slice(11, 19)) + '</span></li>';
        }).join('')
      : '<p style="font-size:13px;color:var(--vp-ink-muted)">' + esc(I.t(lang, 'logEmpty')) + '</p>';
    return (
      '<main class="vp-wrap vp-screen vp-screen--narrow" id="main-content">' +
        '<div class="vp-screen-head">' +
          '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-go-back="home">← ' + esc(I.t(lang, 'back')) + '</button>' +
          '<h1 class="vp-screen-title">' + esc(I.t(lang, 'logTitle')) + '</h1>' +
        '</div>' +
        '<div class="vp-panel">' +
          '<p style="margin:0 0 10px;font-size:13px">' + esc(I.t(lang, 'logConsentState', { state: consent })) + ' (' + events.length + ')</p>' +
          '<div class="vp-switch-row" style="margin-bottom:12px">' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--cobalt" data-consent="yes">' + esc(I.t(lang, 'consentYes')) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-consent="no">' + esc(I.t(lang, 'consentNo')) + '</button>' +
            '<button type="button" class="vp-btn vp-btn--sm vp-btn--ghost" data-clear-log="true">' + esc(I.t(lang, 'logClear')) + '</button>' +
          '</div>' +
          '<ul class="vp-offer-lines" data-event-log-list="true">' + rows + '</ul>' +
        '</div>' +
      '</main>'
    );
  }

  function renderModal(st) {
    if (!ui.modal) return '<div class="vp-backdrop" hidden></div>';
    var lang = st.lang;

    if (ui.modal === 'qr') {
      return (
        '<div class="vp-backdrop" data-modal-backdrop="true">' +
          '<div class="vp-sheet" role="dialog" aria-modal="true" aria-labelledby="vp-modal-title">' +
            '<div class="vp-sheet-head">' +
              '<h2 id="vp-modal-title">' + esc(I.t(lang, 'ticketZoomQr')) + '</h2>' +
              '<button type="button" class="vp-icon-btn" data-close-modal="true" aria-label="' + esc(I.t(lang, 'menuClose')) + '">✕</button>' +
            '</div>' +
            '<div style="width:260px;height:260px;margin:12px auto">' + S.renderQrSvg(ui.qrZoomPayload, 7) + '</div>' +
            '<div class="vp-mono-code" style="text-align:center">' + esc(ui.qrZoomPayload) + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    if (ui.modal === 'menu') {
      var links = [
        ['home', 'menuItems.home'],
        ['all', 'menuItems.all'],
        ['day', 'menuItems.day'],
        ['tickets', 'menuItems.tickets'],
        ['sessions', 'menuItems.sessions'],
        ['topup', 'menuItems.topup'],
        ['history', 'menuItems.history'],
        ['visit', 'menuItems.visit'],
        ['zones/dino-park', 'menuItems.dino'],
        ['zones/zoozoo-land', 'menuItems.zoo'],
        ['zones/food-and-drinks', 'menuItems.food'],
        ['log', 'menuItems.log']
      ];
      return (
        '<div class="vp-backdrop" data-modal-backdrop="true">' +
          '<div class="vp-sheet" role="dialog" aria-modal="true" aria-labelledby="vp-modal-title">' +
            '<div class="vp-sheet-head">' +
              '<h2 id="vp-modal-title">' + esc(I.t(lang, 'menuTitle')) + '</h2>' +
              '<button type="button" class="vp-icon-btn" data-close-modal="true" aria-label="' + esc(I.t(lang, 'menuClose')) + '">✕</button>' +
            '</div>' +
            '<nav class="vp-menu-list">' +
              links.map(function (pair) {
                return '<button type="button" class="vp-btn vp-btn--ghost" style="justify-content:flex-start" data-menu-nav="' + pair[0] + '">' + esc(I.t(lang, pair[1])) + '</button>';
              }).join('') +
            '</nav>' +
            '<div class="vp-demo-footer" style="margin:0">' +
              '<div><strong>' + esc(I.t(lang, 'firstHitToggleLabel')) + '</strong></div>' +
              '<div class="vp-switch-row">' +
                '<button type="button" class="vp-btn vp-btn--sm ' + (st.firstHit === 'passes' ? 'vp-btn--cobalt' : 'vp-btn--ghost') + '" data-first-hit="passes">' + esc(I.t(lang, 'firstHitPasses')) + '</button>' +
                '<button type="button" class="vp-btn vp-btn--sm ' + (st.firstHit === 'autodrom' ? 'vp-btn--cobalt' : 'vp-btn--ghost') + '" data-first-hit="autodrom">' + esc(I.t(lang, 'firstHitAutodrom')) + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // Company sheet (Block 08)
    var curCount = st.party.length;
    var quickBtns = [1, 2, 3, 4].map(function (n) {
      return '<button type="button" class="vp-chip" data-party-count="' + n + '" aria-pressed="' + (curCount === n ? 'true' : 'false') + '">' + n + '</button>';
    }).join('');
    var ageKeys = ['none', 'under3', 'age3_4', 'age5_9', 'age10_17', 'adult'];
    var guestRows = st.party.map(function (p, idx) {
      var opts = ageKeys.map(function (ak) {
        var val = ak === 'none' ? '' : ak;
        var sel = (p.ageBand || '') === val ? ' selected' : '';
        return '<option value="' + val + '"' + sel + '>' + esc(I.t(lang, 'ageBands.' + ak)) + '</option>';
      }).join('');
      return (
        '<div class="vp-guest-row">' +
          '<strong>' + esc(I.t(lang, 'participantPrefix') + ' ' + (idx + 1)) + '</strong>' +
          '<select class="vp-select" data-guest-age="' + esc(p.id) + '" aria-label="' + esc(I.t(lang, 'sheetAgeLabel')) + '">' + opts + '</select>' +
        '</div>'
      );
    }).join('');

    return (
      '<div class="vp-backdrop" data-modal-backdrop="true">' +
        '<div class="vp-sheet" role="dialog" aria-modal="true" aria-labelledby="vp-modal-title">' +
          '<div class="vp-sheet-handle" aria-hidden="true"></div>' +
          '<div class="vp-sheet-head">' +
            '<h2 id="vp-modal-title">' + esc(I.t(lang, 'sheetTitle')) + '</h2>' +
            '<button type="button" class="vp-icon-btn" data-close-modal="true" aria-label="' + esc(I.t(lang, 'menuClose')) + '">✕</button>' +
          '</div>' +
          '<p style="margin:0 0 10px;font-size:13px;color:var(--vp-ink-muted)">' + esc(I.t(lang, 'sheetSubtitle')) + '</p>' +
          '<div style="font-size:13px;font-weight:700">' + esc(I.t(lang, 'sheetQuickCounts')) + '</div>' +
          '<div class="vp-quick-counts">' +
            quickBtns +
            '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px">' +
              '<span>' + esc(I.t(lang, 'sheetOther')) + ':</span>' +
              '<input type="number" class="vp-input" data-party-manual="true" min="1" max="12" value="' + curCount + '" style="width:74px">' +
            '</label>' +
          '</div>' +
          '<div>' + guestRows + '</div>' +
          '<button type="button" class="vp-btn vp-btn--primary" style="width:100%;margin-top:14px" data-close-modal="true">' + esc(I.t(lang, 'sheetApply')) + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function resizeParty(st, targetCount) {
    var n = Math.max(1, Math.min(12, Math.floor(targetCount)));
    var next = [];
    for (var i = 0; i < n; i++) {
      var prev = st.party[i];
      next.push(prev ? prev : { id: 'g' + (i + 1), label: 'Участник ' + (i + 1), ageBand: null });
    }
    st.party = next;
  }

  function closeModal() {
    var sel = ui.lastTriggerSelector;
    ui.modal = null;
    ui.lastTriggerSelector = null;
    render();
    if (sel) {
      var target = document.querySelector(sel);
      if (target && typeof target.focus === 'function') {
        try { target.focus(); } catch (_) {}
      }
    }
  }

  function setupSkipObserver() {
    if (skipObserver) { skipObserver.disconnect(); skipObserver = null; }
    if (typeof IntersectionObserver !== 'function') return;
    var cards = document.querySelectorAll('[data-ride-card]');
    if (!cards.length) return;
    var seen = {};
    skipObserver = new IntersectionObserver(function (entries) {
      var st = S.getState();
      entries.forEach(function (ent) {
        var slug = ent.target.getAttribute('data-ride-card');
        if (ent.isIntersecting) {
          seen[slug] = true;
          if (!trackedImpressions[slug]) {
            trackedImpressions[slug] = true;
            S.track('card_impression', { slug: slug });
          }
        } else if (seen[slug] && ent.boundingClientRect.bottom < 0 && st.hearts.indexOf(slug) < 0 && !skippedTracked[slug]) {
          skippedTracked[slug] = true;
          S.track('card_skip', { slug: slug });
        }
      });
    }, { threshold: 0.4 });
    cards.forEach(function (c) { skipObserver.observe(c); });
  }

  function render() {
    var st = S.getState();
    var r = parseRoute();
    var root = document.getElementById('app-root');
    if (!root) return;

    var ctx = { st: st, I: I, P: P, S: S, DATA: DATA, RATES: RATES, ASSET_BASE: ASSET_BASE, renderRideCard: renderRideCard };
    var mainHtml = '';
    if (r.head === 'day') mainHtml = renderDayScreen(st);
    else if (r.head === 'checkout') mainHtml = renderCheckoutScreen(st);
    else if (r.head === 'tickets') mainHtml = renderTicketsScreen(st);
    else if (r.head === 'all') mainHtml = EX.renderAll35Screen(ctx);
    else if (r.head === 'ticket') mainHtml = EX.renderTicketScreen(ctx, r.arg || ui.ticketOrderId, ui.ticketIndex, ui.transferPreview, ui.qrZoomPayload);
    else if (r.head === 'share') mainHtml = EX.renderShareScreen(ctx, r.params.get('t') || '');
    else if (r.head === 'sessions') mainHtml = EX.renderSessionsScreen(ctx);
    else if (r.head === 'topup') mainHtml = EX.renderTopupScreen(ctx, ui.topupError, ui.latestTopup);
    else if (r.head === 'history') mainHtml = EX.renderHistoryScreen(ctx, ui.historyTab);
    else if (r.head === 'visit') mainHtml = EX.renderVisitScreen(ctx);
    else if (r.head === 'zones') mainHtml = EX.renderZoneScreen(ctx, r.arg || 'dino-park', ui.dinoQty);
    else if (r.head === 'log') {
      if (ui.lastTrackedHead !== 'log') {
        ui.lastTrackedHead = 'log';
        S.track('log_view', {});
      }
      mainHtml = renderLogScreen(st);
    }
    else mainHtml = renderHome(st);

    if (r.head !== 'log') ui.lastTrackedHead = r.head;

    var dockHtml = renderDock(st, r.head);
    document.body.classList.toggle('vp-no-dock', !dockHtml);
    root.innerHTML = renderHeader(st) + mainHtml + dockHtml + renderModal(st);

    if (r.head === 'home') setupSkipObserver();
    if (ui.modal) {
      var closeBtn = root.querySelector('[data-close-modal]');
      if (closeBtn) closeBtn.focus();
    }
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('button, a, [data-modal-backdrop]');
    if (!el) return;

    if (el.hasAttribute('data-modal-backdrop') && ev.target === el) { closeModal(); return; }
    if (el.hasAttribute('data-close-modal')) { closeModal(); return; }
    if (el.hasAttribute('data-open-modal')) {
      var mName = el.getAttribute('data-open-modal');
      ui.lastTriggerSelector = '[data-open-modal="' + mName + '"]';
      ui.modal = mName;
      render();
      return;
    }
    if (el.hasAttribute('data-menu-nav')) {
      var dest = el.getAttribute('data-menu-nav');
      ui.modal = null;
      navigate(dest);
      return;
    }
    if (el.hasAttribute('data-nav')) {
      ev.preventDefault();
      var navDest = el.getAttribute('data-nav');
      if (navDest === 'checkout') {
        ui.checkoutSource = 'day';
        S.mutateSilent(function (st) { st.checkoutSource = 'day'; });
        ui.checkoutFeedback = null;
        S.track('checkout_open', { source: 'day' });
      }
      navigate(navDest);
      return;
    }
    if (el.hasAttribute('data-go-back')) {
      var fb = el.getAttribute('data-go-back');
      if (window.history.length > 1 && window.location.hash && window.location.hash !== '#/') window.history.back();
      else navigate(fb);
      return;
    }
    if (el.hasAttribute('data-heart')) {
      var slug = el.getAttribute('data-heart');
      S.mutate(function (st) {
        var idx = st.hearts.indexOf(slug);
        if (idx >= 0) {
          st.hearts.splice(idx, 1);
          S.track('heart_off', { slug: slug });
        } else {
          st.hearts.push(slug);
          S.track('heart_on', { slug: slug, totalHearts: st.hearts.length });
        }
      });
      return;
    }
    if (el.hasAttribute('data-react')) {
      var parts = el.getAttribute('data-react').split(':');
      S.mutate(function (st) {
        st.reactions[parts[0]] = (st.reactions[parts[0]] === parts[1]) ? null : parts[1];
        S.track('reaction_toggle', { slug: parts[0], reaction: st.reactions[parts[0]] });
      });
      return;
    }
    if (el.hasAttribute('data-toggle-open')) {
      S.mutate(function (st) {
        st.onlyOpen = !st.onlyOpen;
        S.track('filter_open_toggle', { onlyOpen: st.onlyOpen });
      });
      return;
    }
    if (el.hasAttribute('data-toggle-all-home')) {
      S.mutate(function (st) { st.showAllHome = !st.showAllHome; });
      return;
    }
    if (el.hasAttribute('data-first-hit')) {
      var fm = el.getAttribute('data-first-hit');
      S.mutate(function (st) { st.firstHit = fm === 'autodrom' ? 'autodrom' : 'passes'; });
      return;
    }
    if (el.hasAttribute('data-consent')) {
      S.setConsent(el.getAttribute('data-consent'));
      return;
    }
    if (el.hasAttribute('data-clear-log')) {
      S.track('log_clear', {});
      S.clearEvents();
      return;
    }
    if (el.hasAttribute('data-company-tag')) {
      var tag = el.getAttribute('data-company-tag');
      S.mutate(function (st) {
        if (tag === 'solo') st.companyTags = st.companyTags.indexOf('solo') >= 0 ? [] : ['solo'];
        else {
          st.companyTags = st.companyTags.filter(function (x) { return x !== 'solo'; });
          var idx = st.companyTags.indexOf(tag);
          if (idx >= 0) st.companyTags.splice(idx, 1);
          else st.companyTags.push(tag);
        }
        st.party = S.partyFromTags(st.companyTags, st.party);
        S.track('company_change', { tags: st.companyTags.slice(), partySize: st.party.length });
      });
      return;
    }
    if (el.hasAttribute('data-party-count')) {
      var cnt = Number(el.getAttribute('data-party-count'));
      S.mutate(function (st) {
        resizeParty(st, cnt);
        S.track('company_change', { manualCount: st.party.length });
      });
      return;
    }
    if (el.hasAttribute('data-dock-cta')) {
      var ctaRoute = el.getAttribute('data-dock-cta');
      if (ctaRoute === 'day') S.track('day_open', { hearts: S.getState().hearts.length });
      if (ctaRoute === 'tickets') S.track('direct_tickets', { source: 'dock_cta' });
      if (ctaRoute === 'checkout') { ui.checkoutFeedback = null; S.track('checkout_open', {}); }
      navigate(ctaRoute);
      return;
    }
    if (el.hasAttribute('data-direct-tickets')) {
      ev.preventDefault();
      S.track('direct_tickets', { source: 'dock_link' });
      navigate('tickets');
      return;
    }
    if (el.hasAttribute('data-matrix-delta')) {
      var mp = el.getAttribute('data-matrix-delta').split(':');
      S.mutate(function (st) {
        if (!st.matrix[mp[0]]) st.matrix[mp[0]] = {};
        var cur = Number(st.matrix[mp[0]][mp[1]] || 0);
        st.matrix[mp[0]][mp[1]] = Math.max(0, Math.min(20, cur + Number(mp[2])));
      });
      return;
    }
    if (el.hasAttribute('data-remove-ride')) {
      var delSlug = el.getAttribute('data-remove-ride');
      S.mutate(function (st) {
        var idx = st.hearts.indexOf(delSlug);
        if (idx >= 0) {
          st.lastRemoved = { slug: delSlug, index: idx, matrixEntry: JSON.parse(JSON.stringify(st.matrix[delSlug] || {})) };
          st.hearts.splice(idx, 1);
          S.track('heart_off', { slug: delSlug, source: 'day' });
        }
      });
      return;
    }
    if (el.hasAttribute('data-undo-remove')) {
      S.mutate(function (st) {
        if (!st.lastRemoved) return;
        var item = st.lastRemoved;
        if (st.hearts.indexOf(item.slug) < 0) {
          st.hearts.splice(Math.min(item.index, st.hearts.length), 0, item.slug);
          st.matrix[item.slug] = item.matrixEntry;
        }
        st.lastRemoved = null;
      });
      return;
    }
    if (el.hasAttribute('data-tickets-tab')) {
      ui.ticketsTab = el.getAttribute('data-tickets-tab');
      render();
      return;
    }
    if (el.hasAttribute('data-direct-delta')) {
      var dp = el.getAttribute('data-direct-delta').split(':');
      var dKey = dp.slice(0, dp.length - 1).join(':');
      var dDelta = Number(dp[dp.length - 1]);
      S.mutate(function (st) {
        var cur = Number(st.directCart[dKey] || 0);
        var next = Math.max(0, Math.min(20, cur + dDelta));
        if (next === 0) delete st.directCart[dKey];
        else st.directCart[dKey] = next;
      });
      return;
    }
    if (el.hasAttribute('data-add-unlimited')) {
      var selEl = document.querySelector('[data-unlimited-recipient]');
      var recipient = selEl ? selEl.value : I.t(S.getState().lang, 'unlimitedAssignLater');
      S.mutate(function (st) {
        st.directUnlimited.push({ id: P.safeId('unl'), recipientLabel: recipient });
      });
      return;
    }
    if (el.hasAttribute('data-remove-unlimited')) {
      var uid = el.getAttribute('data-remove-unlimited');
      S.mutate(function (st) {
        st.directUnlimited = st.directUnlimited.filter(function (u) { return u.id !== uid; });
      });
      return;
    }
    if (el.hasAttribute('data-direct-checkout')) {
      ui.checkoutSource = 'direct';
      S.mutateSilent(function (st) { st.checkoutSource = 'direct'; });
      ui.checkoutFeedback = null;
      S.track('checkout_open', { source: 'direct' });
      navigate('checkout');
      return;
    }
    if (el.hasAttribute('data-toggle-terms')) {
      ui.termsExpanded = !ui.termsExpanded;
      S.track('terms_toggle', { expanded: ui.termsExpanded });
      render();
      return;
    }
    if (el.hasAttribute('data-sim-outcome')) {
      var oc = el.getAttribute('data-sim-outcome');
      S.mutate(function (st) { st.checkoutOutcomeSim = oc; });
      return;
    }
    if (el.hasAttribute('data-pay-demo')) {
      var pendingGuard = S.getPendingAttempt();
      if (pendingGuard && (pendingGuard.outcome === 'unknown' || pendingGuard.outcome === 'waiting')) return;
      var stNow = S.getState();
      var payload = currentCheckoutPayload(stNow);
      if (payload.total <= 0) return;
      // Idempotency guard across clicks & tabs
      var existingId = S.getPaidKeyOrder(payload.fingerprint);
      if (existingId) {
        ui.checkoutFeedback = { kind: 'success', orderId: existingId };
        render();
        return;
      }
      S.withActionLock('checkout-pay', function () {
        var stLock = S.getState();
        var freshPayload = currentCheckoutPayload(stLock);
        var already = S.getPaidKeyOrder(freshPayload.fingerprint);
        if (already) {
          ui.checkoutFeedback = { kind: 'success', orderId: already };
          render();
          return;
        }
        var outcome = stLock.checkoutOutcomeSim || 'success';
        S.track('payment_start', { total: freshPayload.total, outcomeSim: outcome });
        if (outcome === 'success') {
          var snap = buildOrderSnapshot(stLock, freshPayload);
          S.saveOrder(snap);
          S.recordPaidKey(freshPayload.fingerprint, snap.id);
          S.setPendingAttempt(null);
          S.track('payment_outcome', { outcome: 'success', orderId: snap.id });
          S.track('ticket_issued', { orderId: snap.id, count: snap.tickets.length });
          ui.checkoutFeedback = { kind: 'success', orderId: snap.id };
          ui.ticketOrderId = snap.id;
          ui.ticketIndex = 0;
        } else if (outcome === 'cancel' || outcome === 'error') {
          S.track('payment_outcome', { outcome: outcome });
          ui.checkoutFeedback = { kind: outcome };
        } else {
          // waiting or unknown: persist pending attempt so retry stays LOCKED until checked!
          var pendingRec = {
            id: P.safeId('ATT').toUpperCase(),
            outcome: outcome,
            payload: freshPayload,
            createdAt: new Date().toISOString()
          };
          S.setPendingAttempt(pendingRec);
          S.track('payment_outcome', { outcome: outcome, attemptId: pendingRec.id });
          ui.checkoutFeedback = null;
        }
        render();
      }).then(function (res) {
        if (res && res.busy) {
          ui.checkoutFeedback = { busy: true };
          render();
        }
      });
      return;
    }
    if (el.hasAttribute('data-check-pending')) {
      var pend = S.getPendingAttempt();
      if (!pend) return;
      S.withActionLock('checkout-pay', function () {
        var curPend = S.getPendingAttempt();
        if (!curPend) return;
        var snap = buildOrderSnapshot(S.getState(), curPend.payload);
        S.saveOrder(snap);
        S.recordPaidKey(curPend.payload.fingerprint, snap.id);
        S.setPendingAttempt(null);
        S.track('payment_outcome', { outcome: 'resolved_success', orderId: snap.id });
        S.track('ticket_issued', { orderId: snap.id, count: snap.tickets.length });
        ui.checkoutFeedback = { kind: 'success', orderId: snap.id };
        ui.ticketOrderId = snap.id;
        ui.ticketIndex = 0;
        render();
      });
      return;
    }
    if (el.hasAttribute('data-open-order')) {
      var oid = el.getAttribute('data-open-order');
      ui.ticketOrderId = oid;
      ui.ticketIndex = 0;
      ui.transferPreview = null;
      S.track('ticket_reopen', { orderId: oid });
      navigate('ticket/' + oid);
      return;
    }
    if (el.hasAttribute('data-ticket-select')) {
      var sp = el.getAttribute('data-ticket-select').split(':');
      ui.ticketOrderId = sp[0];
      ui.ticketIndex = Number(sp[1] || 0);
      ui.transferPreview = null;
      render();
      return;
    }
    if (el.hasAttribute('data-zoom-qr')) {
      ui.lastTriggerSelector = '[data-zoom-qr]';
      ui.qrZoomPayload = el.getAttribute('data-zoom-qr');
      ui.modal = 'qr';
      render();
      return;
    }
    if (el.hasAttribute('data-copy-text')) {
      var txt = el.getAttribute('data-copy-text');
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(txt).catch(function () {});
      }
      el.textContent = I.t(S.getState().lang, 'ticketCopied');
      return;
    }
    if (el.hasAttribute('data-save-ticket')) {
      var stp = el.getAttribute('data-save-ticket').split(':');
      var ord1 = S.getOrderById(stp[0]);
      if (!ord1) return;
      var tk1 = ord1.tickets[Number(stp[1] || 0)];
      if (!tk1) return;
      var curLang1 = S.getState().lang;
      var html1 = S.buildStandaloneHtml('Victory Park Ticket ' + tk1.code, [tk1], I.t(curLang1, 'ticketDemoStamp'), curLang1);
      S.downloadHtmlFile('victory-ticket-' + tk1.code + '.html', html1);
      return;
    }
    if (el.hasAttribute('data-save-order')) {
      var ordAll = S.getOrderById(el.getAttribute('data-save-order'));
      if (!ordAll) return;
      var curLangAll = S.getState().lang;
      var htmlAll = S.buildStandaloneHtml('Victory Park Order #' + ordAll.id, ordAll.tickets, I.t(curLangAll, 'ticketDemoStamp'), curLangAll);
      S.downloadHtmlFile('victory-order-' + ordAll.id + '.html', htmlAll);
      return;
    }
    if (el.hasAttribute('data-print-tickets')) {
      window.print();
      return;
    }
    if (el.hasAttribute('data-ticket-transfer')) {
      var trp = el.getAttribute('data-ticket-transfer').split(':');
      var ordTr = S.getOrderById(trp[0]);
      if (!ordTr) return;
      var tIdx = Number(trp[1] || 0);
      var tkTr = ordTr.tickets[tIdx];
      if (!tkTr || !tkTr.transferable) return;
      var tok = S.encodeTransferTicket(tkTr, ordTr);
      var shareUrl = window.location.origin + window.location.pathname + '#/share?t=' + encodeURIComponent(tok);
      ui.transferPreview = { orderId: ordTr.id, idx: tIdx, url: shareUrl };
      render();
      return;
    }
    // Sessions handlers
    if (el.hasAttribute('data-session-mode')) {
      var sm = el.getAttribute('data-session-mode');
      S.mutate(function (st) { st.sessionDraft.mode = sm; st.sessionDraft.step = 1; });
      return;
    }
    if (el.hasAttribute('data-session-step')) {
      var stepN = Number(el.getAttribute('data-session-step'));
      S.mutate(function (st) { st.sessionDraft.step = stepN; });
      return;
    }
    if (el.hasAttribute('data-session-event')) {
      var eid = el.getAttribute('data-session-event');
      S.mutate(function (st) { st.sessionDraft.eventId = eid; });
      return;
    }
    if (el.hasAttribute('data-session-time')) {
      var tm = el.getAttribute('data-session-time');
      S.mutate(function (st) { st.sessionDraft.time = tm; });
      return;
    }
    if (el.hasAttribute('data-session-seat')) {
      var sc = el.getAttribute('data-session-seat');
      S.mutate(function (st) {
        var idx = st.sessionDraft.seats.indexOf(sc);
        if (idx >= 0) st.sessionDraft.seats.splice(idx, 1);
        else st.sessionDraft.seats.push(sc);
      });
      return;
    }
    if (el.hasAttribute('data-session-guests')) {
      var gn = Number(el.getAttribute('data-session-guests'));
      S.mutate(function (st) { st.sessionDraft.guests = gn; });
      return;
    }
    if (el.hasAttribute('data-book-session')) {
      var sst = S.getState();
      var sd = sst.sessionDraft;
      var evMeta = EX.EVENTS_DATA[sd.eventId] || EX.EVENTS_DATA.show;
      var sTotal = evMeta.seated ? (sd.seats.length * evMeta.price) : (sd.guests * evMeta.price);
      if (sTotal <= 0) return;
      var sRec = {
        id: P.safeId('SES').toUpperCase(),
        code: P.safeId('VP-SES').toUpperCase(),
        eventId: evMeta.id,
        title: evMeta.title[sst.lang] || evMeta.title.ru,
        date: sd.date,
        time: sd.time,
        detail: evMeta.seated
          ? (I.t(sst.lang, 'seatsLabel') + ': ' + sd.seats.join(', '))
          : I.t(sst.lang, 'guestsOpenLabel', { n: sd.guests }),
        total: sTotal,
        createdAt: new Date().toISOString()
      };
      S.saveSession(sRec);
      ui.historyTab = 'sessions';
      navigate('history');
      return;
    }
    // Top-up handlers
    if (el.hasAttribute('data-topup-quick')) {
      var qa = Number(el.getAttribute('data-topup-quick'));
      ui.topupError = '';
      S.mutate(function (st) { st.topupDraft.amount = qa; });
      return;
    }
    if (el.hasAttribute('data-submit-topup')) {
      var tst = S.getState();
      var cardClean = String(tst.topupDraft.card || '').replace(/\s+/g, '');
      var amt = Number(tst.topupDraft.amount);
      if (!/^\d{6,16}$/.test(cardClean)) {
        ui.topupError = I.t(tst.lang, 'topupCardError');
        render();
        return;
      }
      if (!Number.isInteger(amt) || amt < 500 || amt > 200000) {
        ui.topupError = I.t(tst.lang, 'topupAmountError');
        render();
        return;
      }
      ui.topupError = '';
      var dedupKey = 'topup:' + cardClean + ':' + amt + ':' + Math.floor(Date.now() / 15000);
      S.withActionLock('card-topup', function () {
        if (S.getPaidKeyOrder(dedupKey)) return;
        var rec = {
          id: P.safeId('TOP').toUpperCase(),
          card: cardClean,
          amount: amt,
          chargeStatus: 'charged',
          creditStatus: tst.topupDraft.delayCredit ? 'pending' : 'credited',
          createdAt: new Date().toISOString()
        };
        S.recordPaidKey(dedupKey, rec.id);
        S.saveOrUpdateTopup(rec);
        ui.latestTopup = rec;
        render();
      });
      return;
    }
    if (el.hasAttribute('data-recover-topup')) {
      var tid = el.getAttribute('data-recover-topup');
      var found = S.getTopups().find(function (x) { return x.id === tid; });
      if (found) {
        found.creditStatus = 'credited';
        S.saveOrUpdateTopup(found);
        ui.latestTopup = found;
        render();
      }
      return;
    }
    // History & Dino handlers
    if (el.hasAttribute('data-history-tab')) {
      ui.historyTab = el.getAttribute('data-history-tab');
      render();
      return;
    }
    if (el.hasAttribute('data-dino-qty')) {
      ui.dinoQty = Number(el.getAttribute('data-dino-qty') || 1);
      render();
      return;
    }
    if (el.hasAttribute('data-buy-dino')) {
      var dQty = Number(el.getAttribute('data-buy-dino') || 1);
      var dst = S.getState();
      var dinoCopy = dst.lang === 'en'
        ? { name: 'Dino Park', unit: 'Separate zone demo entry', validity: '1 day (demo)', included: 'Dino Park zone (separate from 35 rides)' }
        : dst.lang === 'hy'
          ? { name: 'Դինո Պարկ', unit: 'Առանձին գոտու դեմո մուտք', validity: '1 օր (դեմո)', included: 'Դինո Պարկ գոտի (առանձին 35 ատրակցիոնից)' }
          : { name: 'Дино Парк', unit: 'Демо-билет отдельной зоны', validity: '1 день (демо)', included: 'Зона Дино Парк (отдельно от 35 аттракционов)' };
      var dinoOrderId = P.safeId('DINO').toUpperCase();
      var dinoCode = P.safeId('VP-DINO').toUpperCase();
      var dinoSnap = {
        id: dinoOrderId,
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        total: dQty * 3000,
        summaryText: dinoCopy.name + ' × ' + dQty,
        tickets: [{
          code: dinoCode,
          qrPayload: 'VP-DEMO|' + dinoOrderId + '|' + dinoCode,
          shortTitle: dinoCopy.name + ' × ' + dQty,
          title: dinoCopy.name + ' (' + dQty + ')',
          unit: dinoCopy.unit,
          recipient: I.t(dst.lang, 'companyPeopleCount', { n: dQty }),
          validity: dinoCopy.validity,
          included: dinoCopy.included,
          price: dQty * 3000,
          transferable: true
        }]
      };
      S.saveOrder(dinoSnap);
      ui.ticketOrderId = dinoSnap.id;
      ui.ticketIndex = 0;
      navigate('ticket/' + dinoSnap.id);
      return;
    }
  });

  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (el.hasAttribute('data-topup-card')) {
      S.mutateSilent(function (st) { st.topupDraft.card = el.value; });
    } else if (el.hasAttribute('data-topup-amount')) {
      var num = Number(el.value);
      S.mutateSilent(function (st) { st.topupDraft.amount = num; });
      var submitBtn = document.querySelector('[data-submit-topup]');
      if (submitBtn) submitBtn.textContent = I.t(S.getState().lang, 'topupSubmitBtn', { sum: P.formatAmd(num || 0, S.getState().lang) });
    }
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.hasAttribute('data-party-manual')) {
      var val = Number(el.value);
      if (Number.isInteger(val) && val >= 1 && val <= 12) S.mutate(function (st) { resizeParty(st, val); });
    } else if (el.hasAttribute('data-guest-age')) {
      var pid = el.getAttribute('data-guest-age');
      var band = el.value || null;
      S.mutate(function (st) {
        var g = st.party.find(function (p) { return p.id === pid; });
        if (g) g.ageBand = band;
      });
    } else if (el.hasAttribute('data-session-date')) {
      S.mutateSilent(function (st) { st.sessionDraft.date = el.value; });
    } else if (el.hasAttribute('data-topup-card')) {
      S.mutateSilent(function (st) { st.topupDraft.card = el.value; });
    } else if (el.hasAttribute('data-topup-amount')) {
      S.mutateSilent(function (st) { st.topupDraft.amount = Number(el.value); });
    } else if (el.hasAttribute('data-topup-delay')) {
      S.mutateSilent(function (st) { st.topupDraft.delayCredit = Boolean(el.checked); });
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (!ui.modal) return;
    if (ev.key === 'Escape') { ev.preventDefault(); closeModal(); return; }
    if (ev.key === 'Tab') {
      var sheet = document.querySelector('.vp-sheet');
      if (!sheet) return;
      var focusables = Array.from(sheet.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')).filter(function (n) { return !n.disabled; });
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });

  window.addEventListener('hashchange', render);
  S.subscribe(render);
  initFromUrl();
  render();
})();

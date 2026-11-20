/* Clean pricing engine and tariff helpers for Victory Park prototype (from scratch). */
(function (global) {
  'use strict';

  var PKG_SIZES = [3, 5, 10, 20, 30, 40, 60, 80, 100];
  var PKG_UNIT_PRICE = 800;
  var PERSONAL_UNLIMITED_PRICE = 9900;
  var UNLIMITED_EXCLUDED = ['vr-2', 'dark-vr', 'tir', 'avtomaty'];

  function safeId(prefix) {
    var base = (prefix || 'id') + '-' + Date.now().toString(36) + '-';
    try {
      if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
        var bytes = new Uint8Array(6);
        global.crypto.getRandomValues(bytes);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return base + hex;
      }
    } catch (_) {}
    return base + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  }

  // Exact coin-change decomposition for target package ride capacity C using PKG_SIZES.
  // Minimizes total package line count, breaking ties by preferring larger single packages.
  function decomposeCapacity(targetCap) {
    if (targetCap === 0) return [];
    var dp = new Array(targetCap + 1);
    dp[0] = { count: 0, packs: [] };
    for (var cap = 1; cap <= targetCap; cap++) {
      var best = null;
      for (var i = PKG_SIZES.length - 1; i >= 0; i--) {
        var sz = PKG_SIZES[i];
        if (sz > cap || !dp[cap - sz]) continue;
        var candCount = dp[cap - sz].count + 1;
        var candPacks = dp[cap - sz].packs.concat([sz]);
        if (!best || candCount < best.count) {
          best = { count: candCount, packs: candPacks };
        }
      }
      dp[cap] = best;
    }
    if (!dp[targetCap]) return null;
    var counts = {};
    dp[targetCap].packs.forEach(function (sz) {
      counts[sz] = (counts[sz] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (k) { return { size: Number(k), qty: counts[k] }; })
      .sort(function (a, b) { return b.size - a.size; });
  }

  /**
   * Optimize purchase lines for a ride-assignment matrix on the shared connectedPrices demo tariff base.
   *
   * @param {Array<{slug:string, price:number, name?:object}>} catalogRides
   * @param {Array<{id:string, label:string, role?:string, ageBand?:string|null}>} party
   * @param {Object<string, Object<string, number>>} matrix - { [rideSlug]: { [personId]: rideCount } }
   * @returns {Object} retail, best, alternatives, demandCount, lines, total, saving
   */
  function calculateForMatrix(catalogRides, party, matrix) {
    var bySlug = {};
    catalogRides.forEach(function (r) { bySlug[r.slug] = r; });

    var unitEntries = [];
    var byPersonRide = [];
    Object.keys(matrix || {}).forEach(function (slug) {
      var ride = bySlug[slug];
      if (!ride) return;
      var perPerson = matrix[slug] || {};
      party.forEach(function (person) {
        var cnt = Number(perPerson[person.id] || 0);
        if (!Number.isInteger(cnt) || cnt <= 0) return;
        byPersonRide.push({ slug: slug, personId: person.id, count: cnt, unitPrice: ride.price });
        for (var k = 0; k < cnt; k++) {
          unitEntries.push({ slug: slug, personId: person.id, price: ride.price });
        }
      });
    });

    if (unitEntries.length === 0) {
      return {
        demandCount: 0,
        retailTotal: 0,
        best: { kind: 'empty', total: 0, saving: 0, packageCapacity: 0, packageUsed: 0, packageRemaining: 0, lines: [] },
        retailOffer: { kind: 'retail', total: 0, saving: 0, packageCapacity: 0, packageUsed: 0, packageRemaining: 0, lines: [] },
        alternatives: []
      };
    }

    // Sort individual ride units by descending single-ticket price so packages always cover the priciest rides first.
    var sortedUnits = unitEntries.slice().sort(function (a, b) {
      if (b.price !== a.price) return b.price - a.price;
      if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
      return a.personId < b.personId ? -1 : 1;
    });

    var retailTotal = sortedUnits.reduce(function (s, u) { return s + u.price; }, 0);
    var n = sortedUnits.length;

    function buildOffer(cap) {
      var packs = decomposeCapacity(cap);
      if (!packs) return null;
      var covered = Math.min(cap, n);
      var uncoveredUnits = sortedUnits.slice(covered);
      var pkgCost = cap * PKG_UNIT_PRICE;
      var ticketCost = uncoveredUnits.reduce(function (s, u) { return s + u.price; }, 0);
      var total = pkgCost + ticketCost;

      var lines = [];
      packs.forEach(function (p) {
        lines.push({
          kind: 'package',
          productId: 'package' + p.size,
          packageSize: p.size,
          rideSlug: null,
          personId: null,
          quantity: p.qty,
          unitPrice: p.size * PKG_UNIT_PRICE,
          subtotal: p.qty * p.size * PKG_UNIT_PRICE
        });
      });

      // Group uncovered tickets by (slug, personId) preserving stable order
      var ticketGroups = {};
      var ticketOrder = [];
      uncoveredUnits.forEach(function (u) {
        var key = u.slug + '::' + u.personId;
        if (!ticketGroups[key]) {
          ticketGroups[key] = {
            kind: 'ticket',
            productId: 'ticket',
            packageSize: null,
            rideSlug: u.slug,
            personId: u.personId,
            quantity: 0,
            unitPrice: u.price,
            subtotal: 0
          };
          ticketOrder.push(key);
        }
        ticketGroups[key].quantity += 1;
        ticketGroups[key].subtotal += u.price;
      });
      ticketOrder.forEach(function (k) { lines.push(ticketGroups[k]); });

      return {
        kind: cap === 0 ? 'retail' : (uncoveredUnits.length === 0 ? 'package' : 'mixed'),
        id: 'cap-' + cap,
        total: total,
        saving: Math.max(0, retailTotal - total),
        packageCapacity: cap,
        packageUsed: covered,
        packageRemaining: Math.max(0, cap - covered),
        lines: lines
      };
    }

    var retailOffer = buildOffer(0);
    var candidates = [retailOffer];
    var maxCap = Math.min(n + 5, 300);
    for (var cap = 3; cap <= maxCap; cap++) {
      var offer = buildOffer(cap);
      if (offer) candidates.push(offer);
    }

    // Choose optimal offer:
    // 1. Lowest total cost (AMD)
    // 2. Fewer unused leftover package rides (don't waste extra rides at same price)
    // 3. Higher packageUsed (flexible 30-day shared rides beat locked single tickets at equal cost)
    // 4. Fewer checkout lines
    candidates.sort(function (a, b) {
      if (a.total !== b.total) return a.total - b.total;
      if (a.packageRemaining !== b.packageRemaining) return a.packageRemaining - b.packageRemaining;
      if (b.packageUsed !== a.packageUsed) return b.packageUsed - a.packageUsed;
      return a.lines.length - b.lines.length;
    });

    var best = candidates[0];
    var alternatives = [];
    if (best.kind !== 'retail') {
      alternatives.push(retailOffer);
    } else {
      var smallestPkg = candidates.find(function (c) { return c.packageCapacity >= 3; });
      if (smallestPkg) alternatives.push(smallestPkg);
    }

    // Also compute unified real-catalog personal unlimited comparison (31/35 rides, 9 900 AMD per guest)
    var unlExcludedSet = {};
    UNLIMITED_EXCLUDED.forEach(function (s) { unlExcludedSet[s] = true; });
    var activeParticipants = {};
    var excludedUnits = [];
    sortedUnits.forEach(function (u) {
      activeParticipants[u.personId] = true;
      if (unlExcludedSet[u.slug]) excludedUnits.push(u);
    });
    var participantCount = Object.keys(activeParticipants).length || Math.max(1, party.length);
    var unlimitedBaseTotal = participantCount * PERSONAL_UNLIMITED_PRICE;
    var excludedCost = excludedUnits.reduce(function (s, u) { return s + u.price; }, 0);

    return {
      demandCount: n,
      retailTotal: retailTotal,
      best: best,
      retailOffer: retailOffer,
      alternatives: alternatives,
      unlimitedComparison: {
        pricePerPerson: PERSONAL_UNLIMITED_PRICE,
        participantCount: participantCount,
        passesTotal: unlimitedBaseTotal,
        excludedTicketsTotal: excludedCost,
        combinedTotal: unlimitedBaseTotal + excludedCost,
        excludedSlugsInSelection: Array.from(new Set(excludedUnits.map(function (u) { return u.slug; })))
      }
    };
  }

  function formatAmd(amount, lang) {
    var num = Math.round(Number(amount || 0));
    var s = String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    return s + '\u00A0֏';
  }

  function formatApproxCurrencies(amountAmd, rates) {
    if (!rates || !rates.RUB || !rates.USD || !amountAmd) return '';
    var rub = Math.round(amountAmd / rates.RUB);
    var usd = (amountAmd / rates.USD).toFixed(amountAmd / rates.USD >= 20 ? 0 : 1);
    var rubStr = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
    return '≈ ' + rubStr + '\u00A0₽ · $' + usd;
  }

  global.VPFullPricing = {
    PKG_SIZES: PKG_SIZES,
    PKG_UNIT_PRICE: PKG_UNIT_PRICE,
    PERSONAL_UNLIMITED_PRICE: PERSONAL_UNLIMITED_PRICE,
    UNLIMITED_EXCLUDED: UNLIMITED_EXCLUDED,
    safeId: safeId,
    decomposeCapacity: decomposeCapacity,
    calculateForMatrix: calculateForMatrix,
    formatAmd: formatAmd,
    formatApproxCurrencies: formatApproxCurrencies
  };
})(typeof window !== 'undefined' ? window : globalThis);

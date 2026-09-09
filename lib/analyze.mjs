// Phase 4: profit-margin calculation (parameterized version of analyze_final.mjs)
const VAT = 1.19;

export function analyzeMargins(vehicle, listings, opts = {}) {
  const costAllIn = opts.costAllIn ?? vehicle.endPriceEur;
  const costFull = opts.costFull ?? (costAllIn ? costAllIn + (opts.portFee ?? 700) : null);
  const costNet = costAllIn ? Math.round(costAllIn / VAT) : null;
  const kmPct = opts.kmPct ?? 0.2;
  const pricePct = opts.pricePct ?? 0.15;
  const kmRef = vehicle.mileage;

  const rows = (listings || [])
    .map((l) => {
      const g = l.gross ?? l.price;
      const spreadA = costAllIn ? g - costAllIn : null;
      const spreadB = costFull ? g - costFull : null;
      const spreadNet = spreadA !== null ? Math.round(spreadA / VAT) : null;
      return {
        id: l.id, url: l.url, title: l.titleRaw || l.id, ez: l.ez, km: l.km, ps: l.ps, fuel: l.fuel,
        price: l.price, netto: l.netto, sellerPrivate: l.sellerPrivate, gross: g, srcQuery: l.srcQuery,
        score: l.score, digitHits: l.digitHits,
        spreadA, spreadB, spreadNet,
        marginPct: g ? Math.round((spreadA / g) * 1000) / 10 : null,
        inCore: !!(kmRef && kmRef * (1 - kmPct) <= l.km && l.km <= kmRef * (1 + kmPct) &&
                   costAllIn && costAllIn * (1 - pricePct) <= g && g <= costAllIn * (1 + pricePct)),
      };
    })
    .sort((a, b) => a.gross - b.gross);

  const arr = (f) => rows.map(f).filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);
  const spreadA = arr((r) => r.spreadA);
  const priceG = arr((r) => r.gross);

  const stats = {
    count: rows.length,
    coreCount: rows.filter((r) => r.inCore).length,
    priceRange: priceG.length ? [priceG[0], priceG[priceG.length - 1]] : null,
    priceMedian: med(priceG),
    spreadAMin: spreadA.length ? spreadA[0] : null,
    spreadAMax: spreadA.length ? spreadA[spreadA.length - 1] : null,
    spreadAMedian: med(spreadA),
    positiveCount: rows.filter((r) => r.spreadA !== null && r.spreadA > 0).length,
  };
  const assumptions = {
    costAllIn,
    costFull,
    costNet,
    vat: '19 %',
    portFeeNet: opts.portFee ?? 700,
    coreRule: `km ±${Math.round(kmPct * 100)} % (${kmRef ? Math.round(kmRef * (1 - kmPct)).toLocaleString('de-DE') : '?'}–${kmRef ? Math.round(kmRef * (1 + kmPct)).toLocaleString('de-DE') : '?'} km) und Preis ±${Math.round(pricePct * 100)} % um Endpreis`,
    note: 'Preise sind mobile.de-Angebotspreise (brutto = inkl. MwSt.; Händler-Nettoinserate +19 %). „ab“-Endpreis Koreacars; €700 netto Hafenpauschale separat. Verhandlungs-/Exportpreise möglich.',
  };
  return { vehicleId: vehicle.id, cost: assumptions, stats, rows };
}

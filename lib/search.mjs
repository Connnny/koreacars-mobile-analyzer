// Phase 2/3: mobile.de search via render proxy + card parsing (generic)
import { fetchHTML, parseCards } from '../mobilede_search.mjs';
import { llmCheckListings } from './llm.mjs';

const FUEL_DE = { Petrol: 'Benzin', Diesel: 'Diesel', Electric: 'Elektro', Hybrid: 'Hybrid', LPG: 'Autogas' };
// fuel equivalence groups – mobile.de labels PHEVs sometimes "Hybrid", sometimes "Benzin"/"Plug-in-Hybrid"
const FUEL_GROUP = {
  Petrol: ['benzin'],
  Diesel: ['diesel'],
  Electric: ['elektro', 'electric'],
  Hybrid: ['hybrid', 'benzin', 'elektro', 'electric'],
  LPG: ['autogas', 'lpg', 'erdgas'],
};
const fuelMatches = (want, listingFuel) => {
  const g = FUEL_GROUP[want];
  const lf = String(listingFuel || '').toLowerCase();
  return g ? g.some((k) => lf.includes(k)) : lf === String(want || '').toLowerCase();
};

const kmStep = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return n;
  if (n < 10000) return Math.round(n);
  const steps = [];
  for (let s = 10000; s < 100000; s += 10000) steps.push(s);
  for (let s = 100000; s <= 1000000; s += 25000) steps.push(s);
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - n) <= Math.abs(best - n)) best = s;
  return best;
};

const fuelEnFromDe = (s) => {
  const t = String(s || '').toLowerCase();
  if (/benzin|petrol/.test(t)) return 'Petrol';
  if (/diesel/.test(t)) return 'Diesel';
  if (/hybrid/.test(t)) return 'Hybrid';
  if (/elektro|electric|e-tron|ev\b/.test(t)) return 'Electric';
  if (/lpg|autogas/.test(t)) return 'LPG';
  return null;
};

// KI-Suchplan (von lib/llm.mjs) auf die Parameter anwenden – nur wenn der Nutzer nichts Eigenes gesetzt hat
export function applySearchPlan(vehicle, params) {
  const plan = vehicle && vehicle.search && vehicle.search.llmPlan;
  if (!plan || process.env.LLM_DISABLE === '1') return;
  const d = params._def || {};
  const eq = (cur, dv) => String(cur ?? '') === String(dv ?? '');
  const set = (k, pv) => {
    if (pv === null || pv === undefined || pv === '') return;
    if (eq(params[k], d[k])) params[k] = pv;
  };
  set('make', plan.marke);
  const rawModel = String(plan.modell || '').trim();
  // normalisieren: "C/Coupe", "C-Klasse", "E 63" -> reine Baureihenbuchstaben
  const normModel = rawModel.replace(/^([A-Za-z]{1,4})-Klasse$/i, '$1')
    .replace(/\/.*$/, '')
    .replace(/\s+63.*$/i, '')
    .trim();
  if (normModel) set('model', normModel);
  const fe = fuelEnFromDe(plan.kraftstoff);
  if (fe) set('fuel', fe);
  if (Array.isArray(plan.varianten) && plan.varianten.length) set('modelVariant', String(plan.varianten[0]));
  set('bodyType', plan.fahrzeugtyp);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
  const a = num(plan.jahrVon), b = num(plan.jahrBis);
  if (a) set('yearFrom', a);
  if (b) set('yearTo', b);
  const c = num(plan.kmVon), e2 = num(plan.kmBis);
  if (c) set('kmFrom', c);
  if (e2) set('kmTo', e2);
  if (!(params.queries || []).length && eq(params.model, d.model) && Array.isArray(plan.suchbegriffe) && plan.suchbegriffe.length) {
    params.queries = plan.suchbegriffe.map(String).filter(Boolean).slice(0, 3);
  }
}

function cleanTag(t) { return t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }

export function parseListing(card) {
  const full = card.text;
  const t = full.slice(0, 700);
  const ez = t.match(/EZ\s+(\d{2})\/(\d{4})/);
  const km = t.match(/([\d.]+)\s*km/);
  const psM = t.match(/([\d.,]+)\s*kW\s*\(\s*(\d+)\s*PS\s*\)/);
  const fuelM = t.match(/(?:•|\|)\s*(Benzin|Diesel|Elektro|Hybrid|Plug-in-Hybrid|Erdgas)/i) || t.match(/\b(Benzin|Diesel|Elektro|Hybrid)\b/i);
  const auto = /Automatik/i.test(t);
  const manual = /Schaltgetriebe/i.test(t) || /Handschalter/i.test(t);
  const netto = /(netto|zzgl\.?\s*MwSt|zzgl\.?\s*USt|exkl\.?\s*MwSt|\bMwSt\.?\s*ausweisbar)/i.test(full);
  const sellerPrivate = /Privatanbieter/i.test(full);
  const titleM = card.title || (t.match(/^.{0,120}?€/) ? t.slice(0, 100) : '');
  return {
    id: card.id,
    url: `https://suchen.mobile.de/fahrzeuge/details.html?id=${card.id}`,
    zone: card.kind,
    titleRaw: titleM,
    ez: ez ? `${ez[1]}/${ez[2]}` : null,
    ezYear: ez ? Number(ez[2]) : null,
    ezMonth: ez ? Number(ez[1]) : null,
    km: km ? Number(km[1].replace(/\./g, '')) : null,
    kw: psM ? Number(psM[1].replace(/\./g, '').replace(',', '.')) : null,
    ps: psM ? Number(psM[2]) : null,
    fuel: fuelM ? fuelM[1] : null,
    automatic: auto && !manual,
    netto,
    sellerPrivate,
    price: card.price ?? null,
    text: full.slice(0, 500),
  };
}

const gross = (r, VAT = 1.19) => (r.netto && !r.sellerPrivate ? Math.round(r.price * VAT) : r.price);

function tokensOf(s) { return (s || '').toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length >= 2 && !/^[а-яё]+$/.test(w)); }

export function scoreListing(r, hints) {
  const expect = new Set(tokensOf(hints));
  const have = new Set(tokensOf(r.titleRaw + ' ' + r.text.slice(0, 300)));
  let hits = 0;
  for (const w of expect) if (have.has(w)) hits++;
  // spacing/punctuation tolerant matching: "428i" must also match a title "428 i …"
  const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const raw = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const hayRaw = raw(r.titleRaw + ' ' + r.text.slice(0, 400));
  const hayCompact = compact(r.titleRaw + ' ' + r.text.slice(0, 400));
  const digitExp = [...expect].filter((w) => /\d/.test(w));
  const digitHave = digitExp.filter((w) => hayCompact.includes(compact(w))).length;
  // "strong" tokens = model codes containing letters AND digits (640i, 428i, C350e, S450, GV80, CLA250)
  const strong = digitExp.filter((w) => /[a-z]/i.test(w));
  const matchesStrong = (code) => {
    const cm = compact(code);
    if (!/[a-z]/.test(code[0])) return hayCompact.includes(cm);            // digit-start: 428i / 640i (substring ok)
    const m = cm.match(/^([a-z]+)(\d+)([a-z]+)?$/);                        // letter+digits: require real class letters
    if (!m) return hayRaw.includes(cm);
    // "c 350 e" yes, "glc 350 e" no: class letters must start at a word boundary
    return new RegExp('(^|[^a-z])' + m[1] + '[ -]*' + m[2] + (m[3] ? '[ -]*' + m[3] : '') + '(?=$|[^a-z0-9])').test(hayRaw);
  };
  const strongHits = strong.filter((w) => matchesStrong(w)).length;
  return { score: expect.size ? hits / expect.size : 0, digitHits: digitHave, digitTotal: digitExp.length, strongHits, strongTotal: strong.length };
}

// Build the auto query set from carmaker + model (mobile.de keyword search is token-OR, so we add
// precise AND broad variants: full model + engine code, compact codes, numeric core and the bare model)
export function buildAutoQueries(make, model, hintQuery, codes = []) {
  const modelTxt = String(model || '').trim();
  const words = modelTxt.split(/\s+/).filter(Boolean);
  const lowerWords = words.map((w) => w.toLowerCase());
  const out = [];
  const push = (s) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s && !out.includes(s)) out.push(s); };
  if (make && modelTxt) {
    // engine code(s) from the extraction stay in the query but NOT in the visible model field
    const extra = codes.find((c) => !lowerWords.includes(String(c).toLowerCase())) || null;
    push(`${make} ${modelTxt}${extra ? ' ' + extra : ''}`);
    const isMB = /mercedes|benz/i.test(make);
    const AMG_NUMS = new Set(['35', '43', '45', '53', '55', '63', '65', '73']);
    if (codes.length) {
      for (const cd of codes.slice(0, 2)) {
        if (!out.includes(`${make} ${cd}`)) push(`${make} ${cd}`);
        if (/^\d/.test(cd)) { // numeric-start codes (640i, 428i) -> also search the bare core (640, 428)
          const coreM = cd.match(/^(\d{2,})[A-Za-z]*$/);
          if (coreM && !out.includes(`${make} ${coreM[1]}`)) push(`${make} ${coreM[1]}`);
        }
        // AMG-Schreibweise wie bei mobile.de: "C63 AMG" / "C 63 AMG" (nur bei echten AMG-Nummern)
        if (isMB) {
          const m = String(cd).match(/^([A-Za-z]{1,4})(\d{2,3})([A-Za-z]{1,2})?$/);
          if (m && AMG_NUMS.has(m[2])) {
            if (!out.includes(`${make} ${m[1]}${m[2]}${m[3] || ''} AMG`)) push(`${make} ${m[1]}${m[2]}${m[3] || ''} AMG`);
            if (!out.includes(`${make} ${m[1]} ${m[2]}${m[3] ? ' ' + m[3] : ''} AMG`)) push(`${make} ${m[1]} ${m[2]}${m[3] ? ' ' + m[3] : ''} AMG`);
          }
        }
      }
    } else {
      const digitWords = words.filter((w) => /\d/.test(w));
      const code = digitWords.find((w) => /\d{3,}/.test(w)) || digitWords[0] || null;
      const coreM = code ? code.match(/^(\d{2,})[A-Za-z]*$/) || code.match(/^[A-Za-z]+(\d{2,})[A-Za-z]*$/) : null;
      const core = coreM ? coreM[1] : null;
      if (code && !out.includes(`${make} ${code}`)) push(`${make} ${code}`);
      if (core && core !== code && !out.includes(`${make} ${core}`)) push(`${make} ${core}`);
      const alpha = words.filter((w) => !/\d/.test(w));
      if (!digitWords.length && alpha.length === words.length) push(modelTxt);
    }
  } else if (modelTxt && !make) {
    push(modelTxt);
  }
  if (!out.length && hintQuery) push(hintQuery);
  return out.slice(0, 4);
}

export function defaultSearchParams(vehicle) {
  const y0 = vehicle.ez ? Number(vehicle.ez.split('/')[1]) : vehicle.yearMonth ? Number(String(vehicle.yearMonth).slice(0, 4)) : null;
  const km = vehicle.mileage ?? null;
  const make = vehicle.make || String(vehicle.title || '').split(/\s+/)[0] || '';
  const model = (vehicle.search && vehicle.search.model) || '';
  const hint = (vehicle.search && vehicle.search.query) || '';
  const yF = y0 ? y0 - 1 : null;
  const yT = y0 ? y0 + 1 : null;
  const kF = km ? kmStep(Math.round(km * 0.8)) : null;
  const kT = km ? kmStep(km + 30000) : null;
  const out = {
    make,
    model,
    codes: (vehicle.search && vehicle.search.codes) || [],
    queries: [], // empty = auto-build from make+model below
    yearFrom: yF,
    yearTo: yT,
    kmFrom: kF,
    kmTo: kT,
    priceMax: null,
    fuel: vehicle.fuelEn || null, // 'Petrol' etc
    psMin: null,
    psMax: null,
    _hint: hint,
    notes: (vehicle.search && vehicle.search.note) || '',
    _def: { make, model, fuel: vehicle.fuelEn || null, yearFrom: yF, yearTo: yT, kmFrom: kF, kmTo: kT, bodyType: '', modelVariant: '' },
  };
  return out;
}

export async function runMobileSearch(vehicle, params, { onProgress } = {}) {
  applySearchPlan(vehicle, params); // KI-Suchplan (falls vorhanden) anwenden
  let qs = (params.queries || []).map((q) => String(q).trim()).filter(Boolean);
  const autoMode = qs.length === 0;
  if (autoMode) {
    const auto = buildAutoQueries(params.make, params.model, params._hint, params.codes || []);
    qs = auto;
  }
  if (!qs.length) throw new Error('Kein Suchbegriff. Bitte oben Hersteller/Modell eintragen oder Keywords angeben.');
  if (onProgress && autoMode) onProgress(`Auto-Suche: „${params.make || ''} ${params.model || ''}“ (+ Varianten) · ${qs.length} Suchlauf/Läufe`);
  const fetched = [];
  const MAX_PAGES = 6;
  const YEAR_HIT_TARGET = 12; // stoppen, sobald genug Inserate im gewünschten EZ-Fenster da sind
  const wantYLo = params.yearFrom ? Number(params.yearFrom) : null;
  const wantYHi = params.yearTo ? Number(params.yearTo) : null;
  let yearHits = 0;
  outer:
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i].trim();
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (yearHits >= YEAR_HIT_TARGET) break outer;
      if (onProgress) onProgress(page === 1 ? `Suche ${i + 1}/${qs.length}: "${q}" …` : `Suche ${i + 1}/${qs.length}: "${q}" · Seite ${page}/${MAX_PAGES} …`);
      // NOTE: no server-side km/year bound – mobile.de may ignore it or cut candidates;
      // km/year/fuel are filtered client-side below (Jahr bleibt immer erhalten).
      const html = await fetchHTML({
        q,
        ...(page > 1 ? { pageNumber: String(page) } : {}),
        ...(params.priceMax ? { p: `:${params.priceMax}` } : {}),
      });
      let addedInYear = 0;
      for (const c of parseCards(html)) {
        if (c.kind === 'srx') continue; // sponsored "NEU" block, not used-car organic listings
        const l = parseListing(c);
        if (l.price === null || l.km === null || l.ezYear === null) continue;
        if (wantYLo && l.ezYear < wantYLo) continue;
        if (wantYHi && l.ezYear > wantYHi) continue;
        addedInYear++;
        fetched.push({ ...l, srcQuery: q });
      }
      yearHits += addedInYear;
    }
  }
  // dedupe, prefer organic 'base'
  const map = new Map();
  const rank = (k) => (k === 'base' ? 0 : k === 'top' ? 1 : 2);
  for (const l of fetched) {
    const ex = map.get(l.id);
    if (!ex || rank(l.zone) < rank(ex.zone)) map.set(l.id, l);
  }
  let list = [...map.values()];

  const fYearLo = params.yearFrom ? Number(params.yearFrom) : null;
  const fYearHi = params.yearTo ? Number(params.yearTo) : null;
  const fKmLo = params.kmFrom ? Number(params.kmFrom) : null;
  const fKmHi = params.kmTo ? Number(params.kmTo) : null;
  const wantFuel = params.fuel || null;
  const hints = [params.make, params.model, ...(params.codes || [])].filter(Boolean).join(' ')
    || params._hint || (vehicle.search && vehicle.search.query) || '';
  const BODY_TABLE = {
    Limousine: { include: null, exclude: /cabrio|cabriolet|convertible|coup|gran turismo|\bgt\b|roadster|active tourer|kombi|van|shooting brake/i },
    Kombi: { include: /kombi|touring|avant|estate|break|sportbrake|sw\b/i, exclude: null },
    'Coupé': { include: /coup/i, exclude: /cabrio|cabriolet|convertible/i },
    Cabrio: { include: /cabrio|cabriolet|convertible/i, exclude: null },
    GT: { include: /gran turismo|shooting brake|\bgt\b/i, exclude: /cabrio|cabriolet|convertible/i },
    SUV: { include: /suv|sav|sportage|tucson|sorento|carnival|palisade|kona|stonic|ev\d|glc|gle|gls|gla|glb|x1|x2|x3|x4|x5|x6|x7|q[2-9]|gv\d|g\d0|cayenne|macan|range rover|discovery|defender|outback|forester|cr-v|rav4|hilux|xc\d\d/i, exclude: /cabrio|cabriolet|convertible|coup/i },
    Van: { include: /van|tourer|multivan|transporter|caddy|carnival|kombi|prima?/i, exclude: null },
    Roadster: { include: /roadster|z4|slk|slc|tt\b|boxster|mx-5/i, exclude: null },
  };
  const byBody = (l) => {
    const m = String(params.model || '');
    const wantGT = /gran turismo/i.test(m) || /(^|\s)gt(\s|$)/i.test(m);
    const wantCoup = /coup/i.test(m);
    const wantCab = /cabrio|convertible/i.test(m);
    const txt = ((l.text || '') + ' ' + (l.titleRaw || '')).slice(0, 240);
    const isCoup = /gran coup|(^|\s)coupe(\s|$)|coupé/i.test(txt);
    const isCab = /cabrio|cabriolet|convertible/i.test(txt);
    if (wantGT && isCoup) return false;
    if (wantCoup && !isCoup) return false;
    if (wantCab && !isCab) return false;
    // optional explicit Fahrzeugtyp filter
    const bt = String(params.bodyType || '');
    const rule = BODY_TABLE[bt];
    if (rule) {
      const hay = ((l.text || '') + ' ' + (l.titleRaw || '')).toLowerCase();
      if (rule.include && !rule.include.test(hay)) return false;
      if (rule.exclude && rule.exclude.test(hay)) return false;
    }
    return true;
  };
  const VARIANT_RE = {
    'm sport-paket': /(^|[^a-z0-9])(m[\s-]*(sport|paket)|msport)(?=$|[^a-z0-9])/i,
    'm sport': /(^|[^a-z0-9])(m[\s-]*(sport|paket)|msport)(?=$|[^a-z0-9])/i,
    'm paket': /(^|[^a-z0-9])(m[\s-]*(sport|paket)|msport)(?=$|[^a-z0-9])/i,
    'm performance': /(^|[^a-z0-9])m[\s-]*performance/i,
    'amg line': /amg[\s-]*line/i,
    'amg paket': /amg[\s-]*(paket|package)/i,
    amg: /(^|[^a-z0-9])amg(?=$|[^a-z0-9])/i,
    avantgarde: /avant-?garde/i,
    exclusive: /\bexclusive\b/i,
    designo: /designo/i,
    'sport line': /sport[\s-]*line/i,
    's line': /(^|[^a-z0-9])s[\s-]*line/i,
    'black edition': /black[\s-]*edition/i,
    premium: /premium/i,
    komfort: /komfort|comfort/i,
    selection: /selection/i,
    sport: /(^|[^a-z0-9])sport(?=$|[^a-z0-9])/i,
  };
  const byVariant = (l) => {
    const v = String(params.modelVariant || '').trim().toLowerCase();
    if (!v) return true;
    const keys = Object.keys(VARIANT_RE).sort((a, b) => b.length - a.length);
    const key = keys.find((k) => v.includes(k) || k.includes(v)) || null;
    const re = key ? VARIANT_RE[key] : new RegExp('(^|[^a-z0-9])' + v.split(/\s+/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]*'), 'i');
    return re.test(((l.text || '') + ' ' + (l.titleRaw || '')).slice(0, 500));
  };
  const byStrong = (l) => !(l.strongTotal > 0 && l.strongHits === 0);
  const byFuel = (l) => !wantFuel || fuelMatches(wantFuel, l.fuel);
  const byYear = (l) => (!fYearLo || l.ezYear >= fYearLo) && (!fYearHi || l.ezYear <= fYearHi);
  const byKm = (l) => (!fKmLo || l.km >= fKmLo) && (!fKmHi || l.km <= fKmHi);

  const targetText = [params.make, params.model, ...(params.codes || []), ...((vehicle.search && vehicle.search.motor) || [])]
    .filter(Boolean).join(' ')
    + ` · EZ ${fYearLo || '…'}–${fYearHi || '…'} · ${params.fuel ? (FUEL_DE[params.fuel] || params.fuel) : 'Kraftstoff egal'}`
    + (params.modelVariant ? ` · Variante ${params.modelVariant}` : '')
    + (params.bodyType ? ` · Fahrzeugtyp ${params.bodyType}` : '');
  const refine = async (res) => {
    if (!res.length || process.env.LLM_DISABLE === '1') return res;
    try {
      if (onProgress) onProgress('🧠 Lokales LLM prüft die Treffer …');
      const map = await llmCheckListings(targetText, res);
      if (map && map.size) res = res.filter((l) => map.get(String(l.id)) !== false);
    } catch { /* LLM nicht verfügbar -> Regeln gelten */ }
    return res;
  };
  list = list.map((l) => ({ ...l, gross: gross(l), ...scoreListing(l, hints) }));
  const strict = list.filter((l) => byYear(l) && byKm(l) && byFuel(l) && byStrong(l) && byBody(l) && byVariant(l))
    .sort((a, b) => (b.score - a.score) || (a.gross - b.gross));
  if (strict.length) return refine(strict);
  // Kein Treffer im km-Fenster? -> km (und Variante) lockern, das JAHR bleibt aber erhalten (EZ-Filter).
  if (list.length && (fKmLo || fKmHi)) {
    const sameYear = list.filter((l) => byYear(l) && byFuel(l) && byStrong(l) && byBody(l))
      .sort((a, b) => (b.score - a.score) || (a.gross - b.gross));
    if (sameYear.length) {
      if (onProgress) onProgress(`⚠️ Kein Treffer im km-Fenster – km-Filter wurde erweitert (EZ bleibt ${fYearLo || '…'}–${fYearHi || '…'}).`);
      return refine(sameYear);
    }
  }
  // Im richtigen Baujahr nichts im km-Fenster -> Fahrzeugtyp/Variante lockern (KI prüft die Karosserie)
  const sameYearAny = list.filter((l) => byYear(l) && byFuel(l) && byStrong(l));
  if (sameYearAny.length) {
    if (onProgress) onProgress('⚠️ Fahrzeugtyp/Variante wurden gelockert (EZ & Kraftstoff bleiben) – lokale KI prüft, ob die Karosserie passt …');
    return refine(sameYearAny);
  }
  // Auch mit gleichem Baujahr nichts? -> klar melden statt falsche Baujahre zu liefern
  if (list.length && (fYearLo || fYearHi)) {
    if (onProgress) onProgress(`ℹ️ Keine passenden Autos mit EZ ${fYearLo || '…'}–${fYearHi || '…'} im aktuellen Ergebnis – bitte Jahr-Filter anpassen (z. B. größere Spanne) oder Suchbegriffe ändern.`);
  }
  return strict;
}

export { gross as grossPrice };

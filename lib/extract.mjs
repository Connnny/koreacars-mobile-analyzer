// Phase-1 extraction: Encar readside API (fast) + koreacars.de SPA render (display fields)
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { analyzeTemplate } from './templates.mjs';
import { llmParseVehicle, llmSearchPlan } from './llm.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36';
const ENCAR = 'https://api.encar.com/v1/readside';
const RESULT_DIR = path.join(process.cwd(), 'results');

export function ensureDirs() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'cache'), { recursive: true });
  return RESULT_DIR;
}

// Schema-Version der Fahrzeug-Caches: ältere Einträge werden automatisch neu extrahiert
const CACHE_VERSION = 12;

const FUEL = {
  '가솔린': 'Petrol', '디젤': 'Diesel', '전기': 'Electric', '하이브리드': 'Hybrid', 'LPG': 'LPG', '수소': 'Hydrogen',
  '가솔린+전기': 'Hybrid', '전기+가솔린': 'Hybrid', '디젤+전기': 'Hybrid', '전기+디젤': 'Hybrid',
  '가솔린+LPG': 'LPG', 'LPG+가솔린': 'LPG', '휘발유': 'Petrol', '경유': 'Diesel',
};
const GEAR = { '오토': 'Automatic', '수동': 'Manual', '자동': 'Automatic' };

const encarHeaders = { 'User-Agent': UA, Referer: 'https://www.encar.com/' };

async function encarGet(p) {
  const res = await fetch(ENCAR + p, { headers: encarHeaders, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('Encar HTTP ' + res.status);
  return res.json();
}

// KRW(만원 units from Encar) -> EUR using the site's published tier rates
const TIERS = [{ upTo: 10000, rate: 1460 }, { upTo: 20000, rate: 1500 }, { upTo: 100000, rate: 1580 }];
export function krwManToEur(manwon) {
  const krw = manwon * 10000;
  if (!krw) return null;
  for (const t of TIERS) { const eur = krw / t.rate; if (eur <= t.upTo) return Math.round(eur); }
  return Math.round(krw / TIERS[TIERS.length - 1].rate);
}
export const KRW_EUR_DISPLAY = 1630; // rate used on the koreacars.de history section

export async function fetchEncarVehicle(id) {
  const d = await encarGet(`/vehicle/${id}`);
  const cat = d.category || {};
  const spec = d.spec || {};
  const adv = d.advertisement || {};
  const fuelRaw = spec.fuelName || '';
  return {
    encarVehicleId: d.vehicleId || id,
    vin: d.vin || null,
    vehicleNo: d.vehicleNo || null,
    make: cat.manufacturerEnglishName || cat.manufacturerName || null,
    modelGroupEn: cat.modelGroupEnglishName || null,
    gradeEn: cat.gradeEnglishName || cat.gradeName || null,
    modelKorean: cat.modelName || null,
    formYear: cat.formYear || null,
    yearMonth: cat.yearMonth || null, // YYYYMM
    mileage: spec.mileage ?? null,
    displacement: spec.displacement ?? null,
    fuelRaw,
    fuelEn: FUEL[fuelRaw] || (fuelRaw || null),
    colorRaw: spec.colorName || null,
    gearRaw: spec.transmissionName || null,
    gearEn: GEAR[spec.transmissionName] || (spec.transmissionName || null),
    seatCount: spec.seatCount ?? null,
    priceManwon: adv.price ?? null,        // in 10.000 KRW
    adStatus: adv.status || null,
    registrationDate: d.manage?.registDateTime || null,
    photos: (d.photos || []).map((p) => p.path || p).slice(0, 8),
    contents: d.contents?.text || null,
    dealerName: d.partnership?.dealer?.firm?.name || null,
    dealerCity: d.contact?.address || null,
    raw: d,
  };
}

export async function fetchEncarRecord(vehicle) {
  if (!vehicle.encarVehicleId || !vehicle.vehicleNo) return null;
  try {
    const rec = await encarGet(`/record/vehicle/${vehicle.encarVehicleId}/open?vehicleNo=${encodeURIComponent(vehicle.vehicleNo)}`);
    const toEur = (krw) => (krw ? Math.round(krw / KRW_EUR_DISPLAY) : null);
    return {
      owners: rec.ownerChangeCnt ?? null,
      ownerDates: rec.ownerChanges || [],
      claimsOwn: rec.myAccidentCnt ?? null,
      claimsOther: rec.otherAccidentCnt ?? null,
      accidentsTotal: rec.accidentCnt ?? null,
      totalLoss: rec.totalLossCnt ?? null,
      flood: rec.floodTotalLossCnt ?? null,
      myAccidentCostKRW: rec.myAccidentCost ?? null,
      myAccidentCostEUR: toEur(rec.myAccidentCost),
      otherAccidentCostKRW: rec.otherAccidentCost ?? null,
      otherAccidentCostEUR: toEur(rec.otherAccidentCost),
      accidents: (rec.accidents || []).map((a) => ({ date: a.date, insuranceBenefitKRW: a.insuranceBenefit })),
      raw: rec,
    };
  } catch {
    return null;
  }
}

// ---- koreacars.de SPA render (puppeteer + installed Chrome) ----
async function renderKoreacars(url) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1440,2000'],
    defaultViewport: { width: 1440, height: 2000 },
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'de-DE,de;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 75000 });
    await new Promise((r) => setTimeout(r, 6000));
    const data = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const qa = (s) => Array.from(document.querySelectorAll(s));
      const ld = qa('script[type="application/ld+json"]').map((el) => { try { return JSON.parse(el.textContent); } catch { return null; } }).filter(Boolean);
      const imgs = qa('img').map((i) => i.currentSrc || i.src).filter(Boolean);
      // first (= hero) image as shown on koreacars.de: first en-car photo, not the logo
      const hero = imgs.find((s) => s.includes('ci.encar.com')) ||
                   imgs.find((s) => /carpicture|\.jpg/i.test(s) && !/logo/i.test(s)) || null;
      return {
        title: document.title,
        h1: qa('h1').map((e) => e.innerText.trim()),
        bodyText: document.body.innerText,
        ld,
        imgs,
        heroImg: hero,
      };
    });
    return data;
  } finally {
    await browser.close();
  }
}

const FONT_LATIN = /[A-Za-z0-9]/;

export function parseGermanEquipment(bodyText) {
  const groups = ['Sicherheit', 'Komfort & Multimedia', 'Sitze', 'Außen & Innen'];
  const start = bodyText.lastIndexOf('Technische Daten');
  const i0 = start >= 0 ? bodyText.indexOf('Ausstattung', start) : bodyText.indexOf('Ausstattung');
  const i1 = bodyText.indexOf('Importkostenrechner', i0);
  if (i0 < 0 || i1 < 0 || i1 <= i0) return {};
  const region = bodyText.slice(i0, i1).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = {};
  let cur = null;
  for (const line of region) {
    if (line === 'Ausstattung') continue;
    if (groups.includes(line)) { cur = line; out[cur] = []; continue; }
    if (/^\d+$/.test(line)) continue;                 // count chips
    if (cur && line && !/[가-힣]/.test(line)) out[cur].push(line);
  }
  return out;
}

export function parsePrices(bodyText, ld) {
  let koreaEur = null;
  for (const item of ld || []) {
    if (item['@type'] === 'Car' && item.offers?.price) koreaEur = Number(item.offers.price);
  }
  const m1 = bodyText.match(/PREIS IN KOREA\s*€?\s*([\d.]+)/);
  if (koreaEur === null && m1) koreaEur = Number(m1[1].replace(/\./g, ''));
  let endEur = null;
  const m2 = bodyText.match(/Endpreis\s+(?:in\s+DE\s*)?(?:ab\s*)?€?\s*([\d.]+)/);
  if (m2) endEur = Number(m2[1].replace(/\./g, ''));
  else { const m3 = bodyText.match(/ENDPREIS IN DE\s*(?:ab)?€?\s*([\d.]+)/); if (m3) endEur = Number(m3[1].replace(/\./g, '')); }
  return { koreaEur, endEur };
}

export function makeSearchHints(v, pageTitle) {
  const gradeWords = (v.gradeEn || '').split(/[^A-Za-z0-9.]+/).filter(Boolean);
  const groupWords = (v.modelGroupEn || '').split(/[^A-Za-z0-9.]+/).filter(Boolean);
  const modelLatin = ((v.modelKorean || '').match(/[A-Za-z0-9]+(?:\s*[A-Za-z0-9]+)*/g) || []).map((s) => s.trim()).filter((s) => s.length >= 2);
  const STOP = new Set(['m', 'sport', 'line', 'style', 'limited', 'exclusive', 'classic', 'modern', 'dynamic', 'business', 'edition', 'signature', 'design', 'premium', 'luxury', 'special', 'new', 'the', 'all', 'class', 'plus', 'avantgarde', 'urban', 'amg-line', 'komfort', 'progressiv', 'package', 'pack', 'paket', '패키지', 'kit', 'option', 'selection', 'aero', 'aerodynamik', 'competition', 'track', 'first']);
  const DROP = new Set(['2wd', '4wd', 'awd', 'fwd', 'rwd', '4x4', 'diesel', 'benzin', 'petrol', 'benzine', 'lpg', 'gdi', 'tgdi', 't-gdi', 'cr', 'crdi', 'cdi', 'tdi', 'vgt']);
  const KEEP_DRIVE = new Set(['xdrive', '4matic', 'quattro']);
  const BRANDS = new Set(['bmw', 'hyundai', 'kia', 'genesis', 'mercedes', 'mercedes-benz', 'benz', 'mini', 'chevrolet', 'renault', 'renault-korea', 'daewoo', 'gm', 'samsung', 'audi', 'volkswagen', 'vw', 'porsche', 'opel', 'seat', 'skoda', 'toyota', 'nissan', 'mazda', 'honda', 'subaru', 'mitsubishi', 'volvo', 'ford', 'peugeot', 'citroen', 'fiat', 'alfa-romeo', 'alfa', 'romeo', 'lancia', 'jeep', 'dodge', 'chrysler', 'tesla', 'polestar', 'lexus', 'infiniti', 'acura', 'jaguar', 'land-rover', 'range-rover', 'bentley', 'rolls-royce', 'ferrari', 'lamborghini', 'aston-martin', 'mclaren', 'maserati', 'smart', 'dacia', 'cupra', 'mg', 'byd', 'nio', 'xpeng', 'saic']);
  // common Korean romanization -> German market spelling
  const CORRECT = { santafe: 'Santa Fe', 'santa-fe': 'Santa Fe', tuscon: 'Tucson' };
  // English body/trim words that German listings write differently
  const BODY_DE = { convertible: 'Cabrio', cabriolet: 'Cabrio', cabrio: 'Cabrio', softtop: 'Cabrio' };
  const clean = (w) => w.replace(/[^A-Za-z0-9.]/g, '');
  const codeLike = (c) => /^[A-Za-z]+\d/.test(c) || /^\d+[A-Za-z]{1,4}$/.test(c); // 640i, K7, GV80, CLA250
  const chassisLike = (c) => /^[A-Za-z]\d{2,3}$/.test(c);
  const isAlpha = (c) => /^[A-Za-z]{3,}$/.test(c);
  const useful = (w) => {
    const c = clean(w);
    if (!c || /[가-힣]/.test(w)) return false;
    const l = c.toLowerCase();
    if (l.length < 2) return false;
    if (STOP.has(l) || DROP.has(l) || BRANDS.has(l) || BODY_DE[l] === 'Cabrio') return false;
    if (/\d/.test(c)) return !chassisLike(c);
    return l.length >= 4 || KEEP_DRIVE.has(l);
  };

  // --- legacy token query (single AND-ish line) ---
  const seen = new Set();
  const add = (w) => { if (useful(w) && !seen.has(clean(w).toLowerCase())) { seen.add(clean(w).toLowerCase()); return clean(w); } return null; };
  const out = [];
  for (const w of [...gradeWords, ...groupWords, ...modelLatin]) { const t = add(w); if (t) out.push(t); }
  const titleWords = ((pageTitle || v.title || '').split(/[^A-Za-z0-9.]+/)).filter(Boolean);
  for (const w of titleWords) {
    const l = clean(w).toLowerCase();
    if (BRANDS.has(l) || !FONT_LATIN.test(w)) continue;
    const t = add(w);
    if (t && !out.includes(t)) out.push(t);
  }
  const query = out.join(' ');

  // --- make + model for the carmaker/model filter UI (German-market terms) ---
  const isMB = /mercedes|benz/i.test(`${v.make || ''} ${pageTitle || v.title || ''}`);
  const codesRaw = new Set(); // kompakte Codes für starkes Matching: E63, S450, C350e, 640i …
  const modelWords = []; // Modellwörter für Nicht-Mercedes (BMW/Audi/…)
  const addM = (s) => { if (s && !modelWords.some((x) => x.toLowerCase() === s.toLowerCase())) modelWords.push(s); };
  // typical Mercedes model numbers (160..600er) incl. AMG – chassis codes like W223/C118 are NOT in it
  const MB_NUMS = new Set([160, 180, 200, 220, 250, 260, 280, 300, 320, 350, 380, 400, 420, 450, 500, 550, 560, 580, 600, 35, 43, 45, 53, 55, 63, 65, 73]);
  const isMBchassis = (c) => {
    const m = c.match(/^([A-Za-z]{1,4})(\d{2,})([A-Za-z]{1,2})?$/);
    return m ? !MB_NUMS.has(Number(m[2])) : chassisLike(c); // E63(63)=Modell, W223(223)=Chassis
  };
  // Mercedes: Modell = NUR Baureihen-Buchstaben (E, C, S, CLA, GLC …), Zahl = Motorisierung (63, 300, 450 …)
  const mbSplit = (c) => {
    const m = c.match(/^([A-Za-z]{1,4})(\d{2,3})([A-Za-z]{1,2})?$/);
    return m ? [m[1], m[2]] : [c];
  };
  const lettersMB = [];
  const motorMB = [];
  const addLetter = (s) => { s = String(s || '').trim(); if (!/^[A-Z]/.test(s) || /\d/.test(s)) return; if (!lettersMB.some((x) => x.toLowerCase() === s.toLowerCase())) lettersMB.push(s); };
  const addMotor = (n) => { n = String(n || ''); if (!/^\d{1,4}$/.test(n)) return; if (!motorMB.includes(n)) motorMB.push(n); };
  const MB_BODY_WORDS = /^(coupe|coupé|cabrio|cabriolet|convertible|gran|turismo|limousine|sedan|saloon|roadster|spider|shooting|brake|targa|combi|kombi|van)$/i;

  for (let i = 0; i < titleWords.length; i++) {
    const w = titleWords[i];
    const c = clean(w);
    const l = c.toLowerCase();
    if (!c || /[가-힣]/.test(w)) continue;
    if (BRANDS.has(l) || STOP.has(l) || DROP.has(l) || KEEP_DRIVE.has(l)) continue;
    // "4-Series"/"Series 4" -> "4er"; a bare "Series" is dropped (relevant für BMW/Audi)
    if (l === 'series') {
      const nxt = i + 1 < titleWords.length ? clean(titleWords[i + 1]) : '';
      if (/^\d{1,2}$/.test(nxt)) { addM(nxt + 'er'); i++; }
      continue;
    }
    if (/^\d{1,2}$/.test(c) && i + 1 < titleWords.length && clean(titleWords[i + 1]).toLowerCase() === 'series') {
      addM(c + 'er'); i++; continue;
    }
    // English body words -> bei Nicht-Mercedes ins Modell (Cabrio/GT), bei Mercedes nicht (eigenes Feld)
    if (BODY_DE[l]) { if (!isMB) addM(BODY_DE[l]); continue; }
    const corr = CORRECT[l];
    if (corr) { if (!isMB) addM(corr); continue; }

    if (isMB) {
      // "AMG" als eigenes Wort: bei AMG-GT-Modellen Baureihe, sonst gehört es in die Modellvariante
      if (l === 'amg') {
        const nxt = i + 1 < titleWords.length ? clean(titleWords[i + 1]).toLowerCase() : '';
        if (nxt === 'gt') { addLetter('AMG GT'); i++; }
        continue;
      }
      const numeric = /^\d{1,4}$/.test(c);
      const codeTok = codeLike(c) && !isMBchassis(c);
      if (codeTok) {
        codesRaw.add(c);
        const parts = mbSplit(c);
        addLetter(parts[0] || '');
        if (parts[1]) addMotor(parts[1]);
        continue;
      }
      if (numeric) { // "S 450": Zahl nach Baureihen-Buchstabe -> Motorisierung + kompakter Code
        const L = lettersMB[lettersMB.length - 1] || '';
        if (L) {
          addMotor(c);
          const comp = L + c;
          if (!codesRaw.has(comp)) codesRaw.add(comp);
        }
        continue;
      }
      if (/^[A-Za-z]{1,5}$/.test(c) && !MB_BODY_WORDS.test(c)) { addLetter(c); continue; } // Baureihen-Buchstaben: E, C, S, CLA, GLC …
      continue; // sonstige Wörter (Pakete/Ausstattung) gehören NICHT ins Mercedes-Modell
    }

    // ---- Nicht-Mercedes (BMW/Audi/Hyundai …) ----
    const codeTok = codeLike(c) && !chassisLike(c);
    if (isAlpha(c)) addM(c);
    else if (codeTok) { codesRaw.add(c); addM(c); }
  }

  if (isMB) {
    // kompakte Codes für die Suche sicherstellen (spaced Schreibweise "E 63" -> Code E63)
    if (lettersMB.length) for (const n of motorMB) if (!codesRaw.has(lettersMB[0] + n)) codesRaw.add(lettersMB[0] + n);
    const model = lettersMB.join(' ');
    const note = !query && !model ? 'Kein Modell-Token automatisch ableitbar – Suchbegriff bitte selbst eingeben.' : '';
    return { query, model, note, codes: [...codesRaw], motor: motorMB };
  }

  // ---- Nicht-Mercedes: alte Bereinigung (Motorcodes aus dem sichtbaren Modell entfernen) ----
  const digitWords = modelWords.filter((w) => /\d/.test(w));
  const modelClean = modelWords.filter((w) => !(digitWords.some((cd) => cd !== w && cd.toLowerCase().startsWith(w.toLowerCase()) && !/\d/.test(w))));
  const ENGINE_BADGES = new Set(['tfsi', 'tdi', 'tsi', 'gti', 'gtd', 'gdi', 'gte', 'gtie', 'crdi', 'cdi', 'bluetec', 'bluetec?', 'efficientdynamics', 'iperformance', 'edrive', 'e-performance', 'mpower', 'v6', 'v8']);
  const isMotorTok = (w) => {
    const c = w.toLowerCase();
    if (ENGINE_BADGES.has(c)) return true;
    if (/^(x|s)?drive\d+[a-z]{0,3}$/i.test(c)) return true;         // xDrive40e, sDrive18d
    if (/^\d{2,5}[a-z]{1,3}$/.test(c)) return true;                  // 40e, 428i, 520d, 640i (Motorcodes)
    return false;
  };
  const baseTokens = modelClean.filter((w) => !isMotorTok(w));
  const model = baseTokens.length ? baseTokens.join(' ') : modelClean.join(' ');
  const note = !query && !model ? 'Kein Modell-Token automatisch ableitbar – Suchbegriff bitte selbst eingeben.' : '';
  return { query, model, note, codes: [...codesRaw], motor: [] };
}

export async function extractVehicle(idOrUrl) {
  ensureDirs();
  const rawId = String(idOrUrl).trim();
  const m = rawId.match(/(\d{5,})/);
  if (!m) throw new Error('Bitte eine koreacars.de-Katalog-URL oder -ID angeben (z. B. 41838631).');
  const id = m[1];
  const dir = path.join(RESULT_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const cacheFile = path.join(dir, 'vehicle.json');
  if (fs.existsSync(cacheFile)) {
    const prev = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (prev && prev._v === CACHE_VERSION) return { ...prev, cached: true };
    fs.rmSync(dir, { recursive: true, force: true }); // alte Cache-Version -> frisch extrahieren
    fs.mkdirSync(dir, { recursive: true });
  }
  const url = `https://koreacars.de/#/catalog/${id}`;

  // 1) fast: Encar readside
  let encar = null;
  try { encar = await fetchEncarVehicle(id); } catch (e) { encar = null; console.warn('Encar failed:', e.message); }

  // 2) koreacars.de render (title/prices/equipment/status)
  let page = null;
  try { page = await renderKoreacars(url); } catch (e) { console.warn('Render failed:', e.message); }
  const bodyText = page?.bodyText || '';
  const prices = page && page.ld ? parsePrices(bodyText, page.ld) : { koreaEur: null, endEur: null };

  // owners/history from Encar record endpoint
  let history = null;
  if (encar) { try { history = await fetchEncarRecord(encar); } catch { history = null; } }

  const yearMonth = encar?.yearMonth || (bodyText.match(/ERSTZULASSUNG\s*(\d{2})\/(\d{4})/) ? `${bodyText.match(/ERSTZULASSUNG\s*(\d{2})\/(\d{4})/)[2]}${bodyText.match(/ERSTZULASSUNG\s*(\d{2})\/(\d{4})/)[1]}` : null);
  const mileage = encar?.mileage ?? (Number(((bodyText.match(/KILOMETERSTAND\s*([\d.]+)/) || [])[1] || '').replace(/\./g, '')) || null);
  const h1 = page?.h1?.[0] || '';
  const titleEn = [encar?.make, encar?.gradeEn].filter(Boolean).join(' ');

  const koreaEur = prices.koreaEur ?? (encar ? krwManToEur(encar.priceManwon) : null);
  const endEur = prices.endEur;

  const hints = makeSearchHints(encar || { gradeEn: titleEn, modelGroupEn: '', modelKorean: '', modelName: '' }, h1);
  const template = analyzeTemplate({
    make: encar?.make || (h1.split(/\s+/)[0] || ''),
    modelKorean: encar?.modelKorean || '',
    gradeEn: encar?.gradeEn || '',
    title: h1 || titleEn,
    search: { model: hints.model },
    contents: encar?.contents || '',
  });
  if (!hints.model && template.series) hints.model = template.series; // Zwischenfilter-Fallback ohne gerenderte Seite

  // optional: lokales LLM verfeinert Modell/Variante/Motorisierung (kein Eingriff, wenn es nicht läuft)
  if (process.env.LLM_DISABLE !== '1') {
    try {
      const llm = await llmParseVehicle({
        make: encar?.make || (h1.split(/\s+/)[0] || ''),
        title: h1 || titleEn,
        gradeEn: encar?.gradeEn || '',
        modelKorean: encar?.modelKorean || '',
        fuelRaw: encar?.fuelRaw || encar?.fuelEn || '',
      });
      if (llm && typeof llm === 'object') {
        if (typeof llm.modell === 'string' && llm.modell.trim()) {
          hints.model = llm.modell.trim().replace(/^([A-Za-z]{1,4})-Klasse$/i, '$1'); // C-Klasse -> C
        }
        if (Array.isArray(llm.varianten)) {
          const v = llm.varianten.map(String).filter(Boolean);
          if (v.length) template.packages = v;
        }
        const mot = String(llm.motorisierung || '').trim();
        if (mot && mot !== 'null') hints.motor = [mot];
      }
      // kompletter KI-Suchplan (Marke/Modell/Motor/Typ/Kraftstoff/Jahr/km/Suchbegriffe)
      const plan = await llmSearchPlan({
        make: encar?.make || (h1.split(/\s+/)[0] || ''),
        title: h1 || titleEn,
        gradeEn: encar?.gradeEn || '',
        modelKorean: encar?.modelKorean || '',
        ez: yearMonth ? `${yearMonth.slice(4, 6)}/${yearMonth.slice(0, 4)}` : (page?.bodyText?.match(/ERSTZULASSUNG\s*(\d{2})\/(\d{4})/) || [])[0] || '',
        mileage,
        fuelRaw: encar?.fuelRaw || encar?.fuelEn || '',
      });
      if (plan && typeof plan === 'object') hints.llmPlan = plan;
    } catch { /* LLM aus/Fehler -> Regeln bleiben */ }
  }
  const eq = parseGermanEquipment(bodyText);

  const driveGuess = (encar?.gradeEn || h1).match(/(xDrive|AWD|4WD|4MATIC|Quattro|Allrad|\b4X4\b)/i)?.[0] || null;

  // --- photos: koreacars main (hero) image first, exactly as the site shows it ---
  const PHOTO_POLICY = '?impolicy=heightRate&rh=768&cw=1280&ch=768&cg=Center';
  const toAbs = (p) => (p && p.startsWith('http') ? p : p ? 'https://ci.encar.com' + p : null);
  const pageCarImgs = [...new Set((page?.imgs || []).map(toAbs).filter((s) => s && /ci\.encar\.com/i.test(s) && !/\/logo/i.test(s)))];
  const heroImg = page?.heroImg || pageCarImgs[0] || (encar?.photos?.[0] ? toAbs(encar.photos[0]) + PHOTO_POLICY : null);
  const gallery = [heroImg, ...pageCarImgs.filter((s) => s !== heroImg)].filter(Boolean).slice(0, 12);

  const vehicle = {
    id,
    url,
    cached: false,
    title: h1 || titleEn || `${encar?.make || ''} ${encar?.modelGroupEn || ''}`.trim(),
    titleEn,
    make: encar?.make || null,
    modelGroupEn: encar?.modelGroupEn || null,
    gradeEn: encar?.gradeEn || null,
    yearMonth,
    ez: yearMonth ? `${yearMonth.slice(4, 6)}/${yearMonth.slice(0, 4)}` : null,
    mileage,
    displacement: encar?.displacement ?? null,
    fuelEn: encar?.fuelEn || null,
    color: page?.bodyText?.match(/FARBE\s*\n([^\n]+)/)?.[1]?.trim() || encar?.colorRaw || null,
    gearEn: encar?.gearEn || bodyText.match(/GETRIEBE\s*\n(Automatik|Manuell)/)?.[1] || null,
    drive: driveGuess || bodyText.match(/Antrieb\s*\n(Allrad|Front|Heck)/)?.[1] || null,
    vin: encar?.vin || bodyText.match(/[A-HJ-NPR-Z0-9]{17}/)?.[0] || null,
    koreaPriceManwon: encar?.priceManwon ?? null,
    koreaPriceEur: koreaEur,
    endPriceEur: endEur,
    available: /Verfügbar/.test(bodyText),
    accidentFreeBadge: /Unfallfrei/.test(bodyText),
    equipment: eq,
    inspectionText: null, // reserved
    history,
    contents: encar?.contents || null,
    dealer: encar?.dealerName ? { name: encar.dealerName, city: encar.dealerCity } : null,
    heroImg,
    photos: gallery,
    search: hints,
    template,
    _v: CACHE_VERSION,
    fetchedAt: new Date().toISOString(),
    hasPage: !!page,
    hasEncar: !!encar,
  };
  fs.writeFileSync(cacheFile, JSON.stringify(vehicle, null, 2), 'utf8');
  return vehicle;
}

export function listCached() {
  ensureDirs();
  const out = [];
  for (const f of fs.readdirSync(RESULT_DIR)) {
    const p = path.join(RESULT_DIR, f, 'vehicle.json');
    if (fs.existsSync(p)) {
      try { out.push(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch { /* skip */ }
    }
  }
  return out.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));
}

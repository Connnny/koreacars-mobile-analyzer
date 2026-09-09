// Zwischenfilter / Template: koreanische Modell- und Paketnamen -> deutsche (mobile.de-)Bezeichnungen
// für Audi, Mercedes-Benz und BMW. Wird bei der Extraktion auf Encar-Daten angewendet.

const BMW_SERIES = [
  ['1시리즈', '1er'], ['2시리즈', '2er'], ['3시리즈', '3er'], ['4시리즈', '4er'],
  ['5시리즈', '5er'], ['6시리즈', '6er'], ['7시리즈', '7er'], ['8시리즈', '8er'],
  ['X1', 'X1'], ['X2', 'X2'], ['X3', 'X3'], ['X4', 'X4'], ['X5', 'X5'], ['X6', 'X6'], ['X7', 'X7'], ['XM', 'XM'],
  ['Z4', 'Z4'], ['i3', 'i3'], ['i4', 'i4'], ['i5', 'i5'], ['i7', 'i7'], ['iX1', 'iX1'], ['iX3', 'iX3'], ['iX', 'iX'],
  ['M2', 'M2'], ['M3', 'M3'], ['M4', 'M4'], ['M5', 'M5'], ['M8', 'M8'],
];

// (koreanisch | englisch/deutsch) -> Anzeigelabel für die Modellvariante
const PACKAGES = {
  BMW: [
    [/m\s*스포츠\s*패키지|m\s*팩|m\s*paket|m스포츠팩|m sport paket/i, 'M Paket'],
    [/m\s*스포츠|m sport|msport/i, 'M Paket'],
    [/럭셔리\s*라인|luxury line/i, 'Luxury Line'],
    [/스포츠\s*라인|sport line|sports line/i, 'Sport Line'],
    [/블랙\s*에디션|black edition/i, 'Black Edition'],
    [/프리미엄|premium/i, 'Premium'],
    [/m\s*performance|(^|[^a-z])m[\s-]*퍼포먼스|m퍼포먼스/i, 'M Performance'],
  ],
  'Mercedes-Benz': [
    [/아방가르드|avant-?garde/i, 'Avantgarde'],
    [/amg\s*라인|amg line/i, 'AMG Line'],
    [/amg\s*팩|amg\s*패키지|amg paket/i, 'AMG Paket'],
    [/익스클루시브|exclusive/i, 'Exclusive'],
    [/디자인오|designo/i, 'Designo'],
    [/sport|스포츠/i, 'Sport'],
  ],
  Audi: [
    [/s\s*라인|s\s*line|sline/i, 'S line'],
    [/블랙\s*에디션|black edition/i, 'Black Edition'],
    [/컴포트|comfort/i, 'Komfort'],
    [/프리미엄|premium/i, 'Premium'],
    [/셀렉션|selection/i, 'Selection'],
    [/스포츠|sport/i, 'Sport'],
  ],
};

const MB_PREFIX = /(^|[^A-Z])(A|C|E|S|G|V|CLA|CLS|CLE|GLA|GLB|GLC|GLE|GLS|EQA|EQB|EQC|EQE|EQS|SL|SLC|AMG\s*GT)(-|_)?(클래스|CLASS|Class|클라스)?/;
const MB_KLASSE = new Set(['A', 'C', 'E', 'S', 'G', 'V']);

export function detectBMWSeries(text) {
  for (const [kr, de] of BMW_SERIES) {
    if (text.includes(kr)) return de;
  }
  // englische Schreibweise "5 Series"/"5-Series"/"5er"
  const m = String(text || '').match(/(\d|X[1-7]|XM|Z4|i[0-9X]+|M[0-9]+)[ -]*(?:Series|시리즈|SERIES)?/i);
  return m ? m[1].replace(/^(\d)$/, (d) => d + 'er').replace(/^(\d{1,2})$/, (d) => d + 'er') : null;
}

function detectMBSeries(text) {
  const m = String(text || '').match(MB_PREFIX);
  if (!m) return null;
  const pre = m[2];
  if (pre === 'AMG') return 'AMG GT';
  return MB_KLASSE.has(pre) ? pre + '-Klasse' : pre;
}

export function detectSeries(brand, text) {
  if (/bmw/i.test(brand)) return detectBMWSeries(text);
  if (/mercedes|benz/i.test(brand)) return detectMBSeries(text);
  // Audi: Modellnamen (A6, Q5, RS4 …) sind international identisch
  const m = String(text || '').match(/\b((?:S|RS|SQ)?[A-Q][0-9]|e-tron\s*GT|Q[0-9]\s*e-tron|A[0-9]\s*e-tron|TT|R8)\b/i);
  return m ? m[1].toUpperCase() : null;
}

export function detectPackages(brand, ...texts) {
  const joined = texts.filter(Boolean).join(' \u0001 ');
  const rules = PACKAGES[brand] || [];
  const out = [];
  for (const [re, label] of rules) {
    if (re.test(joined) && !out.includes(label)) out.push(label);
  }
  // Mercedes: nacktes "AMG" hinter Modellcode (E63 AMG, C63 S AMG) = Variante "AMG" (außer beim Modell AMG GT)
  if (/mercedes|benz/i.test(brand)) {
    const hasAmgWord = /(^|[^a-z])amg($|[^a-z0-9])/i.test(joined);
    const isAmgGt = /amg[\s-]*gt/i.test(joined);
    if (hasAmgWord && !isAmgGt && !out.includes('AMG')) out.push('AMG');
  }
  return out;
}

// Kombiniert: liefert Baureihe (deutsch), erkannte Pakete und Herkunft der Infos
export function analyzeTemplate(vehicle) {
  const brand = String(vehicle.make || '');
  const modelKorean = vehicle.modelKorean || '';
  const grade = [vehicle.gradeEn, vehicle.title, vehicle.search && vehicle.search.model].filter(Boolean).join(' \u0001 ');
  const series = detectSeries(brand, modelKorean + ' \u0001 ' + vehicle.title || '');
  const packages = detectPackages(brand, modelKorean, vehicle.gradeEn, vehicle.title, vehicle.contents);
  return { brand, series, packages, modelKorean };
}

// Bausteine für die UI: mögliche Pakete je Marke (Anzeige/Vorschläge)
export function possiblePackages(brand) {
  if (/bmw/i.test(brand)) return ['M Paket', 'M Sport', 'Luxury Line', 'Sport Line', 'Black Edition', 'Premium', 'M Performance'];
  if (/mercedes|benz/i.test(brand)) return ['Avantgarde', 'AMG Line', 'AMG Paket', 'Exclusive', 'Designo', 'Sport'];
  if (/audi/i.test(brand)) return ['S line', 'Black Edition', 'Komfort', 'Premium', 'Selection', 'Sport'];
  return [];
}

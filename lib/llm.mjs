// Kleines lokales LLM (Ollama) als Helfer: Namens-Zerlegung + Treffer-Check.
// Alles bleibt optional – wenn Ollama nicht läuft, arbeitet der Regelweg weiter.
const BASE = 'http://127.0.0.1:11434';
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';
let cacheOk = null;
let cacheAt = 0;

export async function llmAvailable() {
  if (Date.now() - cacheAt < 20000 && cacheOk !== null) return cacheOk;
  try {
    const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) { cacheOk = false; cacheAt = Date.now(); return false; }
    const j = await r.json();
    const models = j.models || [];
    cacheOk = models.length > 0; // jedes geladene lokale Modell genügt (wir rufen es beim Chat namentlich auf)
    cacheAt = Date.now();
    return cacheOk;
  } catch {
    cacheOk = false; cacheAt = Date.now(); return false;
  }
}

// Freie Frage an das lokale Modell (für den KI-Assistenten im Bot)
export async function llmChat(system, user, timeout = 120000) {
  if (!(await llmAvailable())) return null;
  try { return await chat(system, user, timeout); } catch { return null; }
}

async function chat(system, user, timeout = 90000) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      options: { temperature: 0, num_ctx: 4096 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
  const j = await res.json();
  return (j.message && j.message.content) || '';
}

function extractJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// 1) Fahrzeug -> strukturierte mobile.de-Filterwerte
export async function llmParseVehicle(info) {
  if (!(await llmAvailable())) return null;
  const sys = [
    'Du bist Experte für deutsche Automodell-Bezeichnungen und die Suchfilter von mobile.de.',
    'Zerlege das Fahrzeug. Regeln:',
    '- modell = NUR die Baureihe/Serie in der Schreibweise der Händler (Mercedes: C, E, S, CLA, GLC … bzw. C-Klasse; BMW: 1er/3er/5er/X5/4er; Audi: A6/A7/RS6/Q5). KEINE Motorcode-Zahl, keine Pakete, keine Karosseriewörter (Cabrio/Coupé/Limousine).',
    '- motorisierung = Motor-/Leistungskennung OHNE Füllworte, z. B. "200", "300", "250", "43", "63", "350", "530i", "40e" (oder null, wenn keine bekannt).',
    '- varianten = Ausstattungspakete wie "M Paket", "AMG", "AMG Line", "Avantgarde", "S line", "Luxury Line", "Sport Line" … (ohne die, die nur Technik wie 4MATIC/xDrive sind).',
    '- fahrzeugtyp = Limousine, Kombi, Coupé, Cabrio, GT, SUV, Van oder Roadster (null wenn egal).',
    '- kraftstoff = Benzin, Diesel, Hybrid oder Elektro.',
    'Antworte NUR mit gültigem JSON, keine Erklärungen: {"marke":"","modell":"","motorisierung":"","varianten":[],"fahrzeugtyp":"","kraftstoff":""}',
  ].join('\n');
  const user = `Fahrzeug-Daten:\nMarke: ${info.make || '?'}\nTitel: ${info.title || ''}\nAusstattungsbezeichnung: ${info.gradeEn || ''}\nModell (koreanisch): ${info.modelKorean || ''}\nKraftstoff (Roh): ${info.fuelRaw || ''}\n`;
  try {
    return extractJson(await chat(sys, user, 60000));
  } catch { return null; }
}

// 2) Liste von mobile.de-Treffern -> welche passen wirklich zum Ziel?
export async function llmCheckListings(target, listings) {
  if (!(await llmAvailable())) return null;
  const rows = (listings || []).slice(0, 30).map((l) => ({ id: String(l.id), titel: String(l.titleRaw || l.id).slice(0, 90), ez: l.ez || '', km: l.km, ps: l.ps || '' }));
  if (!rows.length) return null;
  const sys = [
    'Du prüfst, ob mobile.de-Inserate zum Ziel-Fahrzeug passen (gleiche Marke, gleiche Modellreihe/Motorvariante).',
    'Nur grobe Fehlpassungen ablehnen (andere Marke/Serie/Motor, falsche Generation). Kleinigkeiten wie andere Ausstattung ignorieren.',
    'Antworte NUR mit JSON: {"ergebnis":[{"id":"…","pass":true|false}]}',
  ].join('\n');
  const user = `Ziel: ${target}\n\nInserate:\n${rows.map((r) => `${r.id} | ${r.titel} | EZ ${r.ez} | ${r.km}km | ${r.ps}PS`).join('\n')}\n`;
  try {
    const j = extractJson(await chat(sys, user, 90000));
    if (!j || !Array.isArray(j.ergebnis)) return null;
    const map = new Map();
    for (const e of j.ergebnis) map.set(String(e.id), e.pass === true);
    return map;
  } catch { return null; }
}

// 3) Kompletter Suchplan: LLM liest die Fahrzeugdaten und erstellt die mobile.de-Suchparameter
export async function llmSearchPlan(info) {
  if (!(await llmAvailable())) return null;
  const sys = [
    'Du erstellst den kompletten mobile.de-Suchplan für ein Fahrzeug. Regeln wie gehabt:',
    '- marke = Hersteller in Händlerschreibweise (z. B. Mercedes-Benz, BMW, Audi).',
    '- modell = NUR Baureihe (Mercedes: C/E/S/CLA/GLC … oder C-Klasse; BMW: 1er/3er/5er/X5; Audi: A6/A7/RS6/Q5). KEINE Motorcode-Zahl, keine Pakete, KEINE Karosserie-Wörter (nie "Coupé", "C/Coupe", "AMG" anhängen).',
    '- motorisierung = Motor-/Leistungskennung ohne Füllworte (200/300/250/350/43/63/530i/40e …) oder null.',
    '- varianten = Pakete wie "M Paket", "AMG", "AMG Line", "Avantgarde", "S line" … (nicht 4MATIC/xDrive).',
    '- fahrzeugtyp = Limousine, Kombi, Coupé, Cabrio, GT, SUV, Van oder Roadster (null wenn egal).',
    '- kraftstoff = Benzin, Diesel, Hybrid oder Elektro.',
    '- jahrVon/jahrBis = GENAU Erstzulassungsjahr ± 1 Jahr (EZ 2018 -> jahrVon 2017, jahrBis 2019).',
    '- kmVon = 80 % des Kilometerstands, kmBis = Kilometerstand + 30.000. Beide auf nette Stufen runden (unter 10.000 exakt, sonst 10k/25k-Schritte). Beispiel: km 7.945 -> kmVon 6356, kmBis 37945 (gerundet 40000).',
    '- suchbegriffe = bis zu 3 typische mobile.de-Formulierungen für die Suche (z. B. für C63 AMG Coupé: "Mercedes-Benz C 63 AMG Coupe", "Mercedes-Benz C63 AMG Coupe", "Mercedes-AMG C 63 Coupe"). Keine Jahres-/km-Angaben.',
    'Antworte NUR mit gültigem JSON, keine Erklärungen: {"marke":"","modell":"","motorisierung":"","varianten":[],"fahrzeugtyp":"","kraftstoff":"","jahrVon":0,"jahrBis":0,"kmVon":0,"kmBis":0,"suchbegriffe":[]}',
  ].join('\n');
  const user = [
    `Fahrzeug-Daten:`,
    `Marke: ${info.make || '?'}`,
    `Titel: ${info.title || ''}`,
    `Ausstattungsbezeichnung: ${info.gradeEn || ''}`,
    `Modell (koreanisch): ${info.modelKorean || ''}`,
    `Erstzulassung: ${info.ez || ''}`,
    `Kilometerstand: ${info.mileage ?? '?'}`,
    `Kraftstoff (Roh): ${info.fuelRaw || ''}`,
  ].join('\n');
  try {
    return extractJson(await chat(sys, user, 90000));
  } catch { return null; }
}

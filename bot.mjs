// Telegram-Bot für den Koreacars -> mobile.de Analysator
// Start:  $env:TELEGRAM_BOT_TOKEN="..." ; node bot.mjs     (oder Token in bot_token.txt)
// Selbsttest (offline): node bot.mjs --selftest
import fs from 'node:fs';
import path from 'node:path';
import { extractVehicle, listCached, ensureDirs } from './lib/extract.mjs';
import { runMobileSearch, defaultSearchParams, buildAutoQueries, applySearchPlan } from './lib/search.mjs';
import { analyzeMargins } from './lib/analyze.mjs';
import { llmChat, llmAvailable } from './lib/llm.mjs';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || (fs.existsSync('bot_token.txt') ? fs.readFileSync('bot_token.txt', 'utf8').trim() : '');
const API = 'https://api.telegram.org/bot' + TOKEN;

const HELP = [
  '🤖 <b>Koreacars Analyzer Bot</b>',
  '',
  'Schicke eine koreacars.de-URL oder einfach die Katalog-ID, z. B. <code>41838631</code> – ich lade das Fahrzeug, zeige das erste Foto und alle Details.',
  '',
  '<b>Befehle</b>',
  '/start · /hilfe — diese Hilfe',
  '/auto &lt;ID oder URL&gt; — Fahrzeug laden',
  '/details — technische Daten & Preise',
  '/preis — Preis in Korea + Endpreis DE & Kostenbasis',
  '/ausstattung — Ausstattungsliste',
  '/historie — Vorbesitzer & Versicherungs-/Unfallhistorie',
  '/vergleich — Vergleichsfahrzeuge auf mobile.de suchen (automatisch: Hersteller + Modell)',
  '/vergleich &lt;Hersteller, Modell&gt; — überschreiben, z. B. /vergleich Audi, A7',
  '  Mit Filtern: /vergleich BMW, 5er; Variante: M Paket; Motor: Benzin; Typ: Limousine; Jahr: 2017-2019; km: 100k-150k',
  '  (Vor dem Suchen zeigt der Bot immer den kompletten Such-Plan mit Filtern & Suchläufen.)',
  '/marge — Margen-Analyse gegen den Endpreis für die gefundenen Autos',
  '/export — Ergebnisse / Margen als CSV herunterladen',
  '/autos — bereits analysierte Fahrzeuge',
  '/ki &lt;Frage&gt; — KI-Assistent (lokales Modell): z. B. „Worauf beim Kauf achten?“, „Ist der Preis fair?“',
  '  (englische Aliase: /ai, /frage)',
  '',
  'Die Inline-Buttons unter Fahrzeug/Nachrichten machen dasselbe.',
  '',
  'Hinweis: Der erste Abruf eines Autos dauert ~15–25 s, /vergleich ~20–90 s – der Bot zeigt währenddessen „tippt…“.',
].join('\n');

function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const num = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : '€ ' + num(n, 0));
// Kilometerstand in gerundeten Stufen: <10k exakt, <100k in 10er-, ab 100k in 25er-Schritten
function kmShort(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  if (km < 10000) return num(km, 0) + ' km';
  const steps = [];
  for (let s = 10000; s < 100000; s += 10000) steps.push(s);
  for (let s = 100000; s <= 1000000; s += 25000) steps.push(s);
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - km) <= Math.abs(best - km)) best = s;
  return (best / 1000) + 'k';
}
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

let chain = Promise.resolve();
function run(fn) { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; }

const state = new Map(); // chatId -> { vehicle, listings, analysis }
function st(chatId) { if (!state.has(chatId)) state.set(chatId, {}); return state.get(chatId); }

// ---------- Telegram-Transport ----------
async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) console.warn('tg error', method, j.description || res.status);
  return j;
}
async function send(chatId, text, kb, opts = {}) {
  const payload = { chat_id: chatId, text, parse_mode: 'HTML', ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}), link_preview_options: { is_disabled: true }, ...opts };
  return tg('sendMessage', payload);
}
async function typing(chatId) { tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {}); }
async function photo(chatId, url, caption) {
  if (!url) return;
  await tg('sendPhoto', { chat_id: chatId, photo: url, caption: String(caption || '').slice(0, 1000), parse_mode: 'HTML' });
}
async function sendDoc(chatId, filename, content, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([content], { type: 'text/csv' }), filename);
  if (caption) form.append('caption', caption);
  const res = await fetch(`${API}/sendDocument`, { method: 'POST', body: form });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) console.warn('tg doc error', j.description || res.status);
  return j;
}
async function answerCb(id, text) { tg('answerCallbackQuery', { callback_query_id: id, text: text || '' }).catch(() => {}); }

// ---------- Formatierung ----------
function specLines(v) {
  const L = [];
  L.push(`<b>${esc(v.title || v.titleEn || v.id)}</b>`);
  if (v.available) L.push('✅ Verfügbar' + (v.accidentFreeBadge ? ' · 🛡️ „Unfallfrei“ (lt. Anzeige)' : ''));
  L.push(`📅 EZ ${esc(v.ez || '—')}  ·  📏 ${kmShort(v.mileage)}`);
  L.push(`🛢️ ${v.displacement ? num(v.displacement) + ' cm³' : '—'} ${esc(v.fuelEn || '')}${v.gearEn ? ' · ' + esc(v.gearEn) : ''}${v.drive ? ' · ' + esc(v.drive) : ''}`);
  if (v.search && v.search.motor && v.search.motor.length) L.push(`⚙️ Motorisierung: <b>${esc(v.search.motor.join(' / '))}</b>`);
  L.push(`🎨 ${esc(v.color || '—')}${v.vin ? '  ·  FIN <code>' + esc(v.vin) + '</code>' : ''}`);
  const tpl = v.template || {};
  if (tpl.series || (tpl.packages && tpl.packages.length)) {
    L.push(`🗂️ Reihe (KR→DE): <b>${esc(tpl.series || '—')}</b>${tpl.packages && tpl.packages.length ? ' · Pakete: ' + esc(tpl.packages.join(', ')) : ''}`);
  }
  return L.join('\n');
}
function priceLines(v) {
  const L = ['<b>Preise</b>'];
  L.push(`🇰🇷 Preis in Korea (koreacars): <b>${eur(v.koreaPriceEur)}</b>${v.koreaPriceManwon ? ' (' + num(v.koreaPriceManwon * 10000, 0) + ' KRW)' : ''}`);
  L.push(`🇩🇪 Endpreis DE „ab“: <b>${eur(v.endPriceEur)}</b>`);
  if (v.endPriceEur) L.push('   inkl. 19 % MwSt., 10 % Zoll, Lieferung Hamburg · + 700 € netto Hafenpauschale & optionale Umbauten');
  L.push(`\n<b>Annahmen</b>: Marge = mobile.de-Bruttopreis − ${eur(v.endPriceEur || null)}; Netto-Spanne ÷1,19.`);
  return L.join('\n');
}
function vehicleSummary(v) {
  return specLines(v) + '\n\n' + priceLines(v).split('\n').slice(0, 3).join('\n');
}
const KB_CAR = [[{ text: '🔎 Auf mobile.de vergleichen', callback_data: 'compare' }],
  [{ text: '⚙️ Ausstattung', callback_data: 'equipment' }, { text: '📜 Historie', callback_data: 'history' }, { text: '💶 Preis', callback_data: 'price' }]];
const KB_LIST = [[{ text: '💰 Margen', callback_data: 'margin' }, { text: '⬇️ CSV', callback_data: 'csv' }]];

function equipmentText(v) {
  const eq = v.equipment || {};
  const keys = Object.keys(eq);
  if (!keys.length) return 'Keine Ausstattungsliste verfügbar.';
  return keys.map((k) => `<b>${esc(k)}</b>\n${(eq[k] || []).map((i) => '• ' + esc(i)).join('\n') || '—'}`).join('\n\n');
}
function historyText(v) {
  const h = v.history;
  if (!h) return 'Kein koreanischer Besitzer-/Versicherungsdatensatz verfügbar.';
  const L = ['<b>Historie & Zustand</b>'];
  L.push(`👤 Vorbesitzer: <b>${h.owners ?? '—'}</b>`);
  L.push(`🚑 Versicherungsfälle (dieses Fahrzeug): <b>${h.claimsOwn ?? '—'}</b> · (anderes Fahrzeug): ${h.claimsOther ?? '—'}`);
  if (h.myAccidentCostEUR) L.push(`💰 Schadenssummen (≈, @1630 KRW/€): dieses Fahrzeug ${eur(h.myAccidentCostEUR)} · anderes ${eur(h.otherAccidentCostEUR)}`);
  L.push(`💥 Totalschaden: ${h.totalLoss ?? 0} · Hochwasser: ${h.flood ?? 0}`);
  if (h.accidents && h.accidents.length) L.push('📅 Schäden: ' + h.accidents.map((a) => esc(a.date)).join(', '));
  if (h.ownerDates && h.ownerDates.length) L.push('🔄 Besitzerwechsel: ' + h.ownerDates.slice(-6).map((d) => esc(d)).join(', '));
  return L.join('\n');
}

function listingLine(i, l) {
  return `${i}) <b>${esc(String(l.titleRaw || 'Inserat ' + l.id).slice(0, 60))}</b>\n`
    + `   ${eur(l.gross)}${l.netto ? ' (netto→brutto)' : ''} · ${esc(l.ez || '')} · ${kmShort(l.km)}${l.ps ? ' · ' + l.ps + ' PS' : ''}\n`
    + `   <a href="${esc(l.url)}">mobile.de ↗</a>`;
}
function listingsText(listings) {
  if (!listings || !listings.length) return 'Keine Inserate – zuerst /vergleich ausführen.';
  return `<b>${listings.length} Vergleichsfahrzeuge auf mobile.de gefunden</b>\n\n` + listings.slice(0, 24).map((l, i) => listingLine(i + 1, l)).join('\n\n');
}
function marginText(a) {
  const s = a.stats;
  const L = [`<b>Margen-Analyse</b> — gegen Endpreis ${eur(a.cost.costAllIn)}`];
  L.push(`Anzahl: ${s.count} (⭐ Kern ${s.coreCount}) · Median Brutto ${eur(s.priceMedian)} · Spanne Median ${eur(s.spreadAMedian)} (min ${eur(s.spreadAMin)}, max ${eur(s.spreadAMax)}), positiv ${s.positiveCount}/${s.count}`);
  for (const [i, r] of a.rows.slice(0, 15).entries()) {
    const sign = r.spreadA >= 0 ? '+' : '';
    L.push(`${r.inCore ? '⭐' : ''}${i + 1}) ${eur(r.gross)} → ${sign}${eur(r.spreadA)} (${num(r.marginPct, 1)} %) · ${esc(String(r.title || r.id).slice(0, 40))}`);
  }
  return L.join('\n');
}

function csvOf(rows) {
  const head = ['id;url;titel;ez;km;ps;kraftstoff;preisBrutto;netto;spanneEndpreis;nettoSpanne;margeProzent;kern'];
  const body = rows.map((r) => [r.id, r.url, String(r.title || '').replace(/;/g, ','), r.ez || '', r.km ?? '', r.ps ?? '', r.fuel || '', r.gross ?? '', r.netto ? 1 : 0, r.spreadA ?? '', r.spreadNet ?? '', r.marginPct ?? '', r.inCore ? 1 : 0].join(';'));
  return '\uFEFF' + head.concat(body).join('\n');
}

// ---------- Aktionen ----------
async function loadVehicle(chatId, ref) {
  await typing(chatId);
  const s = st(chatId);
  try {
    const v = await run(() => extractVehicle(ref));
    s.vehicle = v; delete s.listings; delete s.analysis;
    if (v.heroImg) await photo(chatId, v.heroImg, `<b>${esc(v.title || v.id)}</b>\n${eur(v.koreaPriceEur)} in Korea · ${eur(v.endPriceEur)} Endpreis DE`);
    await send(chatId, vehicleSummary(v), KB_CAR);
    await send(chatId, 'Sende <b>/vergleich</b>, um Vergleichsfahrzeuge auf mobile.de zu suchen, oder tippe auf den Button.');
  } catch (e) {
    await send(chatId, `❌ „${esc(ref)}“ konnte nicht geladen werden: ${esc(e.message)}\n\nNutze eine koreacars.de-URL oder Katalog-ID, z. B. <code>41838631</code>.`);
  }
}

// ---------- Filter-Vorschau & strukturierte Parameter ----------
const FUEL_LABEL = { Petrol: 'Benzin', Diesel: 'Diesel', Hybrid: 'Hybrid', Electric: 'Elektro', LPG: 'Autogas' };
const fuelLabel = (en) => FUEL_LABEL[en] || en || 'egal';
function mapFuelInput(t) {
  const s = String(t || '').toLowerCase();
  if (/benzin|petrol/.test(s)) return 'Petrol';
  if (/diesel/.test(s)) return 'Diesel';
  if (/hybrid/.test(s)) return 'Hybrid';
  if (/elektro|electric|e-tron|ev\b/.test(s)) return 'Electric';
  if (/lpg|autogas/.test(s)) return 'LPG';
  return null;
}
function mapBodyInput(t) {
  const s = String(t || '').toLowerCase();
  if (/cabrio|cabriolet|convertible/.test(s)) return 'Cabrio';
  if (/limousine|sedan|saloon/.test(s)) return 'Limousine';
  if (/kombi|touring|estate|avant/.test(s)) return 'Kombi';
  if (/coup/.test(s)) return 'Coupé';
  if (/gran turismo|\bgt\b/.test(s)) return 'GT';
  if (/suv|gelände|offroad/.test(s)) return 'SUV';
  if (/van|bus/.test(s)) return 'Van';
  if (/roadster|spider/.test(s)) return 'Roadster';
  return null;
}
function parseRange(t, kilo) {
  const a = [];
  for (const part of String(t || '').split(/[-–—]|bis/)) {
    const m = part.match(/(\d[\d.,]*)\s*(k|km)?/i);
    if (!m) continue;
    let v = Number(m[1].replace(/\./g, '').replace(',', '.'));
    if ((m[2] || '').toLowerCase() === 'k') v *= 1000;
    a.push(Math.round(v));
  }
  return a;
}
function guessBody(v) {
  const txt = String((v.title || '') + ' ' + ((v.search && v.search.model) || '') + ' ' + (v.gradeEn || '')).toLowerCase();
  if (/cabrio|cabriolet|convertible/.test(txt)) return 'Cabrio';
  if (/gran turismo|shooting brake|(^|\s)gt(\s|$)/.test(txt)) return 'GT';
  if (/coup/.test(txt)) return 'Coupé';
  if (/kombi|touring|estate/.test(txt)) return 'Kombi';
  if (/suv|sportage|tucson|glc|gle|gls|x[3-7]\b|q[3-9]\b|gv\d|cayenne|macan/.test(txt)) return 'SUV';
  return null;
}
function applyOverride(params, text) {
  const segs = String(text || '').split(';').map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return;
  if (!String(text).includes(';')) {
    const parts = segs[0].split(',').map((s) => s.trim());
    if (parts.length >= 2) { params.make = parts[0]; params.model = parts.slice(1).join(' '); }
    else params.queries = [segs[0]];
    return;
  }
  const first = segs.shift().split(',').map((s) => s.trim());
  if (first.length >= 2) { params.make = first[0]; params.model = first.slice(1).join(' '); }
  else if (first[0]) params.queries = [first[0]];
  for (const seg of segs) {
    const kv = seg.match(/^(variante|variant|paket|motor|kraftstoff|typ|karosserie|jahr|ez|km|kilometer|ps)\s*[:=]\s*(.+)$/i);
    const key = kv ? kv[1].toLowerCase() : null;
    const val = kv ? kv[2].trim() : seg;
    if (key === 'variante' || key === 'variant' || key === 'paket') params.modelVariant = val;
    else if (key === 'motor' || key === 'kraftstoff') { const f = mapFuelInput(val); if (f) params.fuel = f; }
    else if (key === 'typ' || key === 'karosserie') { const b = mapBodyInput(val); if (b) params.bodyType = b; }
    else if (key === 'jahr' || key === 'ez') { const r = parseRange(val); if (r[0]) params.yearFrom = r[0]; if (r[1]) params.yearTo = r[1]; }
    else if (key === 'km' || key === 'kilometer') { const r = parseRange(val, true); if (r[0]) params.kmFrom = r[0]; if (r[1]) params.kmTo = r[1]; }
    else if (key === 'ps') { const r = parseRange(val); if (r[0]) params.psMin = r[0]; if (r[1]) params.psMax = r[1]; }
    else if (!params.queries.length) params.queries.push(seg);
  }
}
function planText(v, params, queries) {
  const L = [];
  L.push(`🔎 <b>Such-Plan für</b> ${esc(String(v.title || v.id).slice(0, 60))}`);
  L.push(`• Marke: <b>${esc(params.make || '—')}</b>`);
  L.push(`• Modell: <b>${esc(params.model || '—')}</b>` + ((v.search && v.search.motor && v.search.motor.length) ? ` · Kennung: ${esc(v.search.motor.join('/'))}` : ''));
  const packs = (v.template && v.template.packages) || [];
  L.push(`• Modellvariante: <b>${esc(params.modelVariant || (packs.length ? packs[0] : '—'))}</b>`);
  L.push(`• Motorisierung: <b>${fuelLabel(params.fuel)}</b>`);
  L.push(`• Fahrzeugtyp: <b>${esc(params.bodyType || guessBody(v) || 'egal')}</b>`);
  L.push(`• EZ: <b>${params.yearFrom || '…'}–${params.yearTo || '…'}</b> · km: <b>${kmShort(params.kmFrom)}–${kmShort(params.kmTo)}</b>${params.priceMax ? ` · max. ${eur(params.priceMax)}` : ''}`);
  L.push('');
  L.push(`<b>Suchläufe (${queries.length}):</b>`);
  L.push(queries.map((q) => `• <code>${esc(q)}</code>`).join('\n'));
  return L.join('\n');
}

function aiContext(v, listings) {
  const L = [];
  L.push(`Auto: ${String(v.title || v.id)}`);
  const m = (v.search && v.search.model) || '?';
  L.push(`Marke: ${v.make || '?'} · Modell: ${m}${(v.search && v.search.motor && v.search.motor.length) ? ` · Kennung/Motor: ${v.search.motor.join('/')}` : ''}`);
  if (v.template && v.template.packages && v.template.packages.length) L.push(`Ausstattungslinien/Pakete: ${v.template.packages.join(', ')}`);
  L.push(`EZ: ${v.ez || '?'} · km: ${v.mileage ?? '?'} · Kraftstoff: ${v.fuelEn || '?'} · Antrieb: ${v.drive || '?'}`);
  L.push(`Preis in Korea: ${eur(v.koreaPriceEur)} · Endpreis DE „ab“: ${eur(v.endPriceEur)}`);
  if (v.history) L.push(`Vorbesitzer: ${v.history.owners ?? '?'} · Versicherungsfälle: ${v.history.claimsOwn ?? 0}/${v.history.claimsOther ?? 0}`);
  if (v.contents) L.push(`Anbieter-Text (Auszug): ${String(v.contents).replace(/\s+/g, ' ').slice(0, 600)}`);
  if (listings && listings.length) {
    const g = listings.map((l) => l.gross).filter(Boolean).sort((a, b) => a - b);
    const mid = g[Math.floor(g.length / 2)];
    L.push(`Aktuelle Vergleichstreffer auf mobile.de: ${listings.length} (Median ${eur(mid)}, min ${eur(g[0])}, max ${eur(g[g.length - 1])})`);
  }
  return L.join('\n');
}

async function doCompare(chatId, override) {
  const s = st(chatId);
  if (!s.vehicle) { await send(chatId, 'Lade zuerst ein Fahrzeug: schicke eine koreacars.de-Katalog-ID/URL oder nutze /auto.'); return; }
  await typing(chatId);
  const params = defaultSearchParams(s.vehicle);
  applyOverride(params, override);
  // KI-Suchplan (vom LLM erstellt) anwenden – ersetzt Standard-Werte, wenn der Nutzer nichts Eigenes gesetzt hat
  applySearchPlan(s.vehicle, params);
  const queries = params.queries.length ? params.queries : buildAutoQueries(params.make, params.model, params._hint, params.codes || []);
  await send(chatId, planText(s.vehicle, params, queries));
  if (await llmAvailable()) await send(chatId, '🤖 Lokale KI ist aktiv und prüft Filter/Treffer – kann etwas dauern …');
  try {
    const listings = await run(() => runMobileSearch(s.vehicle, params, { onProgress: () => typing(chatId) }));
    s.listings = listings; delete s.analysis;
    if (!listings.length) { await send(chatId, '⚠️ Keine Vergleichsfahrzeuge mit den aktuellen Filtern gefunden.\nPrüfe Hersteller-/Modell-Schreibweise für mobile.de (koreacars „Santafe“ → mobile.de „Santa Fe“) oder nutze /vergleich &lt;Hersteller&gt;, &lt;Modell&gt;.'); return; }
    for (const part of chunk(listingsText(listings).split('\n\n'), 30)) await send(chatId, part.join('\n\n'));
    await send(chatId, 'Ergebnisse oben · tippe auf <b>💰 Margen</b> oder sende /marge', KB_LIST);
  } catch (e) {
    await send(chatId, '❌ Vergleich fehlgeschlagen: ' + esc(e.message));
  }
}

async function doMargin(chatId) {
  const s = st(chatId);
  if (!s.vehicle) { await send(chatId, 'Lade zuerst ein Fahrzeug (/auto oder ID schicken).'); return; }
  if (!s.listings || !s.listings.length) { await send(chatId, 'Noch keine Ergebnisse – zuerst /vergleich ausführen.'); return; }
  await typing(chatId);
  const a = await run(() => analyzeMargins(s.vehicle, s.listings, { costAllIn: s.vehicle.endPriceEur || undefined }));
  s.analysis = a;
  const text = marginText(a);
  for (const part of chunk(text.split('\n'), 40)) await send(chatId, part.join('\n'));
  await send(chatId, '⬇️ /export lädt alle Zeilen als Tabelle herunter.', KB_LIST);
}

async function doCsv(chatId) {
  const s = st(chatId);
  const rows = s.analysis ? s.analysis.rows : (s.listings || []).map((l) => ({ ...l, title: l.titleRaw, gross: l.gross, netto: l.netto, spreadA: '', spreadNet: '', marginPct: '', inCore: false }));
  if (!rows.length) { await send(chatId, 'Noch nichts zum Exportieren – zuerst /vergleich ausführen.'); return; }
  const id = s.vehicle ? s.vehicle.id : 'ergebnisse';
  await sendDoc(chatId, `analyse_${id}.csv`, csvOf(rows), `Koreacars-Analysator · ${s.vehicle ? esc(s.vehicle.title || '') : ''}`);
}

async function listCars(chatId) {
  const items = listCached();
  if (!items.length) { await send(chatId, 'In diesem Arbeitsbereich wurden noch keine Fahrzeuge analysiert.'); return; }
  const text = ['<b>Bereits analysiert</b>', ...items.map((v) => `<code>${esc(v.id)}</code> — ${esc(String(v.title).slice(0, 60))} · ${eur(v.koreaPriceEur)}`), '', 'Sende /auto &lt;ID&gt;, um eines erneut zu laden.'].join('\n');
  await send(chatId, text);
}

async function handleCallback(chatId, data, cbId) {
  await answerCb(cbId, 'ok');
  if (data === 'compare') return doCompare(chatId, null);
  if (data === 'margin') return doMargin(chatId);
  if (data === 'csv') return doCsv(chatId);
  const s = st(chatId);
  if (!s.vehicle) { await send(chatId, 'Lade zuerst ein Fahrzeug.'); return; }
  if (data === 'specs') await send(chatId, specLines(s.vehicle) + '\n\n' + priceLines(s.vehicle));
  if (data === 'price') await send(chatId, priceLines(s.vehicle));
  if (data === 'equipment') { for (const part of chunk(equipmentText(s.vehicle).split('\n\n'), 30)) await send(chatId, part.join('\n\n')); }
  if (data === 'history') await send(chatId, historyText(s.vehicle));
}

// englische Befehle als Alias -> deutsch (kanonisch)
function canon(cmd) {
  const map = { '/help': '/hilfe', '/car': '/auto', '/specs': '/details', '/price': '/preis', '/equipment': '/ausstattung', '/history': '/historie', '/compare': '/vergleich', '/margin': '/marge', '/csv': '/export', '/cars': '/autos', '/ai': '/ki', '/frage': '/ki' };
  return map[cmd.toLowerCase()] || cmd.toLowerCase();
}

async function handleMessage(chatId, text) {
  const t = String(text || '').trim();
  if (!t) return;
  if (t.startsWith('/')) {
    const [rawCmd, ...rest] = t.split(/\s+/);
    const cmd = canon(rawCmd);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case '/start': case '/hilfe': return send(chatId, HELP);
      case '/auto': return arg ? loadVehicle(chatId, arg) : send(chatId, 'Nutzung: /auto &lt;koreacars-Katalog-ID oder -URL&gt;');
      case '/details': case '/preis': case '/ausstattung': case '/historie': {
        const s = st(chatId);
        if (!s.vehicle) return send(chatId, 'Lade zuerst ein Fahrzeug (ID schicken oder /auto).');
        const map = { '/details': specLines(s.vehicle) + '\n\n' + priceLines(s.vehicle), '/preis': priceLines(s.vehicle), '/ausstattung': equipmentText(s.vehicle), '/historie': historyText(s.vehicle) };
        const out = map[cmd];
        for (const part of chunk(out.split('\n\n'), 30)) await send(chatId, part.join('\n\n'));
        return;
      }
      case '/vergleich': return doCompare(chatId, arg || null);
      case '/marge': return doMargin(chatId);
      case '/export': return doCsv(chatId);
      case '/autos': return listCars(chatId);
      case '/ki': {
        if (!arg) return send(chatId, 'Nutzung: /ki &lt;Frage&gt;, z. B. „Worauf muss ich bei diesem Auto achten?“');
        const s2 = st(chatId);
        if (!s2.vehicle) return send(chatId, 'Lade zuerst ein Fahrzeug (ID schicken), damit die KI Kontext hat.');
        await typing(chatId);
        const ctx = aiContext(s2.vehicle, s2.listings || null);
        const sys = 'Du bist ein hilfreicher Auto- und Gebrauchtwagen-Experte. Antworte auf Deutsch, kurz und klar. Nutze die Fahrzeugdaten; wenn eine Info fehlt, sage das ehrlich statt zu raten.';
        const answer = await llmChat(sys, `Fahrzeug-Kontext:\n${ctx}\n\nFrage des Nutzers: ${arg}`);
        if (!answer) return send(chatId, '⚠️ Das lokale KI-Modell ist gerade nicht erreichbar – die Regeln laufen weiter, aber ohne KI-Antwort.');
        const clean = esc(answer);
        for (const part of chunk(clean.split('\n'), 30)) await send(chatId, part.join('\n').slice(0, 4000));
        return;
      }
      default: return send(chatId, 'Unbekannter Befehl. /hilfe zeigt alle Befehle.');
    }
  }
  // Klartext = koreacars-Referenz
  if (/\d{5,}/.test(t) || t.includes('koreacars.de')) return loadVehicle(chatId, t);
  return send(chatId, 'Schicke eine koreacars.de-URL/Katalog-ID, z. B. <code>41838631</code>, oder nutze /hilfe.');
}

// ---------- Polling ----------
async function pollOnce(offset) {
  const res = await fetch(`${API}/getUpdates?timeout=25&offset=${offset}`, { signal: AbortSignal.timeout(40000) });
  const j = await res.json();
  if (!j.ok) { console.warn('getUpdates fehlgeschlagen', j.description); return offset; }
  let max = offset;
  for (const u of j.result || []) {
    max = Math.max(max, u.update_id + 1);
    const msg = u.message || u.edited_message || u.channel_post;
    try {
      if (u.callback_query) {
        const cq = u.callback_query;
        await handleCallback(cq.message.chat.id, cq.data, cq.id);
      } else if (msg && msg.chat && msg.text) {
        await handleMessage(msg.chat.id, msg.text);
      }
    } catch (e) { console.warn('Handler-Fehler', e.message); }
  }
  return max;
}

export async function runBot() {
  ensureDirs();
  if (!TOKEN) throw new Error('Kein Token. TELEGRAM_BOT_TOKEN setzen oder in bot_token.txt ablegen');
  console.log('Koreacars-Analysator-Bot läuft (Polling) …');
  let offset = 0;
  for (;;) {
    try { offset = await pollOnce(offset); }
    catch (e) { console.warn('Poll-Fehler', e.message); await new Promise((r) => setTimeout(r, 3000)); }
  }
}

// ---------- Selbsttest (offline) ----------
export async function selftest() {
  ensureDirs();
  const file = path.join('results', '41838631', 'vehicle.json');
  if (!fs.existsSync(file)) { console.log('Selbsttest: kein gecachtes Fahrzeug gefunden (vorher eine Extraktion ausführen)'); return; }
  const v = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('--- vehicleSummary ---'); console.log(vehicleSummary(v));
  console.log('--- priceLines ---'); console.log(priceLines(v).split('\n').slice(0, 5).join('\n'));
  console.log('--- equipment preview ---'); console.log(equipmentText(v).split('\n').slice(0, 6).join('\n'));
  console.log('--- history preview ---'); console.log(historyText(v).split('\n').slice(0, 5).join('\n'));
  console.log('--- HELP ---'); console.log(HELP.slice(0, 300));
  console.log('\nSelbsttest OK');
}

if (process.argv.includes('--selftest')) {
  selftest().catch((e) => { console.error(e); process.exit(1); });
} else if (process.argv[1]?.endsWith('bot.mjs')) {
  runBot().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
}

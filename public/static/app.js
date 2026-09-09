'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const eur = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : '€ ' + num(n, 0));
// mileage in rounded steps: <10k exact, <100k every 10k, >=100k every 25k (10k,20k…90k,100k,125k,150k,175k,200k…)
function kmSteps() {
  const steps = [];
  for (let s = 10000; s < 100000; s += 10000) steps.push(s);
  for (let s = 100000; s <= 1000000; s += 25000) steps.push(s);
  return steps;
}
function kmShort(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '—';
  if (km < 10000) return num(km, 0) + ' km';
  const steps = kmSteps();
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - km) <= Math.abs(best - km)) best = s;
  return (best / 1000) + 'k';
}
// Filter-Vorgaben auf dieselbe Stufe runden: 100791 -> 100000, 155989 -> 150000
function kmFilterValue(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '';
  if (km < 10000) return Math.round(km);
  const steps = kmSteps();
  let best = steps[0];
  for (const s of steps) if (Math.abs(s - km) <= Math.abs(best - km)) best = s;
  return best;
}
const imgOf = (p) => (p && p.startsWith('http') ? p : p ? 'https://ci.encar.com' + p : null);

// ---- Marken-/Modell-Katalog (mobile.de-orientierte Bezeichnungen) ----
const MAKES = {
  BMW: { models: ['1er', '2er', '3er', '4er', '5er', '6er', '7er', '8er', 'X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'XM', 'Z4', 'i4', 'i5', 'i7', 'iX', 'iX1', 'iX3', 'M2', 'M3', 'M4', 'M5', 'M8'] },
  'Mercedes-Benz': { models: ['A-Klasse', 'B-Klasse', 'C-Klasse', 'CLA', 'CLS', 'CLE', 'E-Klasse', 'S-Klasse', 'GLA', 'GLB', 'GLC', 'GLE', 'GLS', 'G-Klasse', 'V-Klasse', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'SL', 'SLC', 'AMG GT', 'Maybach'] },
  Audi: { models: ['A1', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'Q4 e-tron', 'Q6 e-tron', 'e-tron GT', 'TT', 'R8', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'SQ5', 'SQ7', 'RS3', 'RS4', 'RS5', 'RS6', 'RS7', 'RS Q3', 'RS e-tron GT'] },
  Hyundai: { models: ['i10', 'i20', 'i30', 'Bayon', 'Kona', 'Tucson', 'Santa Fe', 'Sonata', 'Grandeur', 'Palisade', 'Ioniq 5', 'Ioniq 6', 'Staria'] },
  Kia: { models: ['Picanto', 'Rio', 'Ceed', 'XCeed', 'Niro', 'Sportage', 'Sorento', 'Carnival', 'EV3', 'EV6', 'EV9', 'Stinger', 'ProCeed', 'Stonic'] },
  Genesis: { models: ['G70', 'G80', 'G90', 'GV60', 'GV70', 'GV80', 'GV90'] },
  Volkswagen: { models: ['Polo', 'Golf', 'T-Roc', 'Tiguan', 'Touareg', 'Passat', 'Arteon', 'ID.3', 'ID.4', 'ID.5', 'ID.7', 'ID.Buzz', 'Multivan', 'Caddy'] },
  Porsche: { models: ['911', '718 Boxster', '718 Cayman', 'Panamera', 'Taycan', 'Cayenne', 'Macan'] },
  Mini: { models: ['Cooper', 'Cooper S', 'Cooper SE', 'Countryman', 'Clubman', 'JCW'] },
  Toyota: { models: ['Aygo', 'Yaris', 'Corolla', 'Camry', 'C-HR', 'RAV4', 'Highlander', 'Land Cruiser', 'Proace', 'bZ4X'] },
  Lexus: { models: ['LBX', 'UX', 'NX', 'RX', 'ES', 'LS', 'LC', 'RZ'] },
  Volvo: { models: ['S60', 'S90', 'V60', 'V90', 'XC40', 'XC60', 'XC90', 'EX30', 'EX90', 'C40'] },
  Tesla: { models: ['Model 3', 'Model Y', 'Model S', 'Model X'] },
  Ford: { models: ['Fiesta', 'Focus', 'Puma', 'Kuga', 'S-Max', 'Galaxy', 'Mustang', 'Explorer'] },
  Opel: { models: ['Corsa', 'Astra', 'Insignia', 'Mokka', 'Grandland', 'Combo', 'Zafira'] },
  Mazda: { models: ['2', '3', '6', 'CX-3', 'CX-5', 'CX-30', 'CX-60', 'MX-5'] },
  Nissan: { models: ['Micra', 'Juke', 'Qashqai', 'X-Trail', 'Ariya', 'Leaf'] },
  Honda: { models: ['Civic', 'CR-V', 'HR-V', 'Jazz', 'e:Ny1'] },
  Skoda: { models: ['Fabia', 'Scala', 'Octavia', 'Superb', 'Kamiq', 'Karoq', 'Kodiaq', 'Enyaq'] },
  SEAT: { models: ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco'] },
  Cupra: { models: ['Leon', 'Formentor', 'Born', 'Ateca', 'Tavascan'] },
  Peugeot: { models: ['208', '308', '508', '2008', '3008', '5008', 'e-208', 'e-308'] },
  'Renault': { models: ['Clio', 'Megane', 'Captur', 'Arkana', 'Austral', 'Scenic', 'Espace'] },
  'Chevrolet': { models: ['Spark', 'Aveo', 'Cruze', 'Malibu', 'Trax', 'Equinox', 'Traverse'] },
  Smart: { models: ['fortwo', 'forfour', '#1', '#3'] },
  BYD: { models: ['Dolphin', 'Seal', 'Atto 3', 'Han', 'Tang', 'Sealion 7'] },
  Polestar: { models: ['2', '3', '4'] },
  'Land Rover': { models: ['Discovery', 'Discovery Sport', 'Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Range Rover Velar', 'Defender'] },
  Jaguar: { models: ['XE', 'XF', 'F-Pace', 'E-Pace', 'I-Pace', 'F-Type'] },
};
const VARIANTS = ['M Paket', 'M Sport', 'M Sport-Paket', 'Sport Line', 'Luxury Line', 'AMG Line', 'AMG Paket', 'Avantgarde', 'Exclusive', 'Designo', 'S line', 'Black Edition', 'GT-Line', 'N-Line', 'R-Line', 'Style', 'Ambition', 'Elegance', 'Executive', 'First Edition', 'Performance'];
function makeKey(v) {
  const s = String(v || '').trim().toLowerCase();
  return Object.keys(MAKES).find((k) => k.toLowerCase() === s || (k.includes(' ') && s.includes(k.split(' ')[0]))) || '';
}
function refreshModelSuggestions() {
  const dl = $('#dlModels'); dl.innerHTML = '';
  const key = makeKey($('#fMake').value);
  (key ? MAKES[key].models : []).forEach((m) => dl.appendChild(new Option(m)));
}
function fillDatalists() {
  const dlM = $('#dlMakes'); dlM.innerHTML = '';
  Object.keys(MAKES).sort().forEach((m) => dlM.appendChild(new Option(m)));
  const dlV = $('#dlVariants'); dlV.innerHTML = '';
  VARIANTS.forEach((v) => dlV.appendChild(new Option(v)));
}
function guessBody(v) {
  const txt = String(v.title + ' ' + (v.gradeEn || '') + ' ' + ((v.search && v.search.model) || '')).toLowerCase();
  if (/cabrio|cabriolet|convertible/.test(txt)) return 'Cabrio';
  if (/gran turismo|shooting brake/.test(txt) || /(^|\s)gt(\s|$)/.test(txt)) return 'GT';
  if (/coup/.test(txt)) return 'Coupé';
  if (/kombi|touring|avant|estate/.test(txt)) return 'Kombi';
  if (/suv|sportage|tucson|sorento|carnival|palisade|kona|glc|gle|gls|gla|glb|x[3-7]\b|q[3-9]\b|gv\d|cayenne|macan|range rover|defender|cr-v|rav4|xc\d\d/.test(txt)) return 'SUV';
  return '';
}

const state = { vehicle: null, listings: [], selected: new Set(), analysis: null };

function pane(el, show) { el.classList.toggle('hidden', !show); }

async function api(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

function setState(txt, cls) { const s = $('#searchState'); s.textContent = txt; s.style.color = cls === 'err' ? 'var(--bad)' : cls === 'ok' ? 'var(--acc2)' : ''; }

// ---------- Verlauf ----------
async function refreshHistory() {
  try {
    const { vehicles } = await (await fetch('/api/vehicles')).json();
    $('#history').innerHTML = vehicles.map((v) =>
      `<div class="hist-item" data-id="${esc(v.id)}">
         <b>${esc(v.title)}</b>
         <span>${esc(v.ez || '')} · ${v.mileage ? kmShort(v.mileage) : ''} · ${v.priceK ? eur(v.priceK) : ''}${v.priceEnd ? ' → ' + eur(v.priceEnd) : ''}</span>
       </div>`).join('') || '<div class="hint">noch nichts vorhanden</div>';
    $('#history').querySelectorAll('.hist-item').forEach((el) => el.onclick = () => { $('#carInput').value = el.dataset.id; loadVehicle(); });
  } catch { /* ignore */ }
}

// ---------- Fahrzeug laden / extrahieren ----------
async function loadVehicle() {
  const val = $('#carInput').value.trim();
  if (!val) return;
  pane($('#empty'), false);
  setState('Fahrzeug wird extrahiert …', '');
  $('#btnLoad').disabled = true;
  try {
    const { vehicle } = await api('/api/extract', { idOrUrl: val });
    state.vehicle = vehicle;
    renderVehicle(vehicle);
    fillSearchDefaults(vehicle);
    pane($('#vehiclePane'), true);
    pane($('#searchPane'), true);
    pane($('#resultPane'), false);
    pane($('#analysisPane'), false);
    setState('', '');
    await refreshHistory();
  } catch (e) {
    $('#empty').innerHTML = '<div class="card hint">Extrahieren fehlgeschlagen: <b>' + esc(e.message) + '</b><br>Prüfe, ob die ID auf koreacars.de existiert und Chrome installiert ist.</div>';
    pane($('#empty'), true);
  } finally { $('#btnLoad').disabled = false; }
}

function renderVehicle(v) {
  const eqGroups = v.equipment && Object.keys(v.equipment).length
    ? Object.entries(v.equipment).map(([g, items]) => `<h4>${esc(g)}</h4>` + (items.length ? items.map((i) => `<span class="chip">${esc(i)}</span>`).join('') : '<span class="muted">—</span>')).join('')
    : '<span class="muted">Ausstattungsliste nicht verfügbar (Seite nicht gerendert).</span>';
  const hist = v.history;
  const badges = [v.available ? '<span class="badge ok">Verfügbar</span>' : '', v.accidentFreeBadge ? '<span class="badge ok">Unfallfrei (lt. Anzeige)</span>' : '', v.hasPage ? '<span class="badge">Seite gerendert</span>' : '', v.hasEncar ? '<span class="badge">Encar-Daten</span>' : ''].join('');
  const img = imgOf(v.photos && v.photos[0]);
  const priceNote = v.koreaPriceEur === null ? '<div class="note">Kein Korea-Preis auf der Seite gefunden (kein JSON-LD/Preisbereich).</div>' : '';
  const histHtml = hist ? `
    <div class="specgrid">
      <div class="it"><div class="k">Vorbesitzer (Umschreibungen)</div><div class="v">${esc(hist.owners ?? '—')}</div></div>
      <div class="it"><div class="k">Versicherungsfälle (dieses Fahrzeug)</div><div class="v">${esc(hist.claimsOwn ?? '—')}</div></div>
      <div class="it"><div class="k">Fälle (anderes Fahrzeug)</div><div class="v">${esc(hist.claimsOther ?? '—')}</div></div>
      <div class="it"><div class="k">Totalschaden / Hochwasser</div><div class="v">${esc(hist.totalLoss ?? 0)} / ${esc(hist.flood ?? 0)}</div></div>
      <div class="it"><div class="k">Schadenssumme (dieses Fahrzeug)</div><div class="v">${hist.myAccidentCostEUR ? eur(hist.myAccidentCostEUR) + ' <span class="muted">(≈)</span>' : '—'}</div></div>
      ${(hist.accidents && hist.accidents.length ? `<div class="it"><div class="k">Schadenstage</div><div class="v">${esc(hist.accidents.map((a) => a.date).join(', '))}</div></div>` : '')}
    </div>` : '<div class="note">Für dieses Fahrzeug liegt kein koreanischer Versicherungs-/Besitzerdatensatz vor.</div>';

  $('#vehicleCard').innerHTML = `
    <div class="vhead">
      ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}
      <div class="vtitle">
        <h1>${esc(v.title || v.titleEn || v.id)}</h1>
        <div class="badges">${badges}</div>
      </div>
    </div>
    <div class="prices">
      <div class="price"><div class="k">Preis in Korea (koreacars)</div><div class="v">${eur(v.koreaPriceEur)}</div><div class="s">${v.koreaPriceManwon ? num(v.koreaPriceManwon * 10000, 0) + ' KRW' : ''} · inkl. Koreacars-Marge</div></div>
      <div class="price"><div class="k">Endpreis DE „ab“</div><div class="v">${eur(v.endPriceEur)}</div><div class="s">inkl. 19 % MwSt., 10 % Zoll, Hamburg · Basis für die Margen-Analyse</div></div>
    </div>
    ${priceNote}
    ${v.template && (v.template.series || (v.template.packages && v.template.packages.length))
      ? `<div class="analy" style="margin:8px 0 6px">🗂️ <b>Zwischenfilter (KR → DE):</b> Reihe <b>${esc(v.template.series || '—')}</b>` +
        (v.template.packages && v.template.packages.length ? ' · Pakete: ' + v.template.packages.map((p) => `<span class="chip">${esc(p)}</span>`).join(' ') : '') +
        (v.template.modelKorean ? ` · koreanischer Name: <i>${esc(v.template.modelKorean)}</i>` : '') + `</div>`
      : ''}
    <div class="specgrid">
      <div class="it"><div class="k">Erstzulassung</div><div class="v">${esc(v.ez || '—')}</div></div>
      <div class="it"><div class="k">Kilometerstand</div><div class="v" title="${v.mileage ? num(v.mileage) + ' km' : ''}">${kmShort(v.mileage)}</div></div>
      <div class="it"><div class="k">Motor / Kraftstoff</div><div class="v">${v.displacement ? num(v.displacement) + ' cm³' : '—'} · ${esc(v.fuelEn || '—')}</div></div>
      ${v.search && v.search.motor && v.search.motor.length ? `<div class="it"><div class="k">Motorisierung (Kennung)</div><div class="v">${esc(v.search.motor.join(' / '))}</div></div>` : ''}
      <div class="it"><div class="k">Leistung</div><div class="v">${esc(v.powerPs ? v.powerPs + ' PS' : 'nicht angegeben')}</div></div>
      <div class="it"><div class="k">Getriebe</div><div class="v">${esc(v.gearEn || '—')}</div></div>
      <div class="it"><div class="k">Antrieb</div><div class="v">${esc(v.drive || '—')}</div></div>
      <div class="it"><div class="k">Farbe</div><div class="v">${esc(v.color || '—')}</div></div>
      <div class="it"><div class="k">FIN</div><div class="v" style="font-size:12px">${esc(v.vin || '—')}</div></div>
    </div>
    <h3 style="margin-bottom:2px">Historie & Zustand</h3>${histHtml}
    ${v.dealer ? `<div class="muted" style="font-size:12px">Händler in Korea: ${esc(v.dealer.name)}${v.dealer.city ? ' · ' + esc(v.dealer.city) : ''}</div>` : ''}
    ${eqGroups ? `<div class="eqgroups" style="margin-top:12px"><h3>Ausstattung</h3>${eqGroups}</div>` : ''}
    <div class="muted" style="font-size:11px;margin-top:10px">abgerufen ${esc(v.fetchedAt || '')} · ${v.hasPage ? 'koreacars.de-Seite' : 'Seiten-Render fehlgeschlagen'} ${v.hasEncar ? '· Encar-API' : ''} ${v.cached ? '· aus Cache' : ''}</div>`;
}

function fillSearchDefaults(v) {
  const y = v.ez ? Number(v.ez.split('/')[1]) : v.yearMonth ? Number(String(v.yearMonth).slice(0, 4)) : null;
  const km = v.mileage || null;
  $('#fMake').value = v.make || String(v.title || '').split(/\s+/)[0] || '';
  refreshModelSuggestions();
  $('#fModel').value = (v.search && v.search.model) || '';
  // Modellvariante: bei Mercedes-AMG-Modellen (E63 AMG → Modell E63, Variante AMG) automatisch setzen
  const packs = (v.template && v.template.packages) || [];
  // Modellvariante: erkannte Pakete (M Paket, AMG …) direkt ins Variante-Feld übernehmen
  $('#fVariant').value = packs.length ? packs[0] : '';
  $('#fQueries').value = ''; // leer = automatische Suche Hersteller + Modell
  $('#fYearFrom').value = y ? y - 1 : '';
  $('#fYearTo').value = y ? y + 1 : '';
  $('#fKmFrom').value = km ? kmFilterValue(Math.round(km * 0.8)) : '';
  $('#fKmTo').value = km ? kmFilterValue(km + 30000) : '';
  $('#fPriceMax').value = '';
  $('#fFuel').value = v.fuelEn || '';
  $('#fBody').value = guessBody(v) || '';
  $('#fPsMin').value = '';
  $('#fPsMax').value = '';
  $('#searchNote').textContent = (v.search && v.search.note
    ? v.search.note + ' '
    : '') + (packs.length ? `Erkannte Pakete (Koreanisch→Deutsch): ${packs.join(', ')} – optional oben bei „Modellvariante“ eintragen. ` : '')
    + 'Felder sind automatisch ausgefüllt; „Modell“ zeigt Vorschläge der Marke (4er, C-Klasse, A7 …).';
}

function readSearchParams() {
  const q = $('#fQueries').value.split('\n').map((s) => s.trim()).filter(Boolean);
  return {
    make: $('#fMake').value.trim(),
    model: $('#fModel').value.trim(),
    modelVariant: $('#fVariant').value.trim(),
    queries: q,
    yearFrom: $('#fYearFrom').value || null,
    yearTo: $('#fYearTo').value || null,
    kmFrom: $('#fKmFrom').value || null,
    kmTo: $('#fKmTo').value || null,
    priceMax: $('#fPriceMax').value || null,
    fuel: $('#fFuel').value || null,
    bodyType: $('#fBody').value || null,
    psMin: $('#fPsMin').value || null,
    psMax: $('#fPsMax').value || null,
  };
}

// ---------- Suche ----------
async function runSearch() {
  const params = readSearchParams();
  if (!params.queries.length && !(params.make || params.model)) { setState('Bitte Hersteller + Modell (oder Keywords) eintragen', 'err'); return; }
  $('#btnSearch').disabled = true;
  pane($('#resultPane'), false);
  const log = $('#progressLog');
  log.classList.remove('hidden');
  log.textContent = '';
  setState('Suche läuft auf mobile.de …', '');
  try {
    const res = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vehicleId: state.vehicle.id, params }) });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let listings = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'progress') { log.textContent += ev.message + '\n'; log.scrollTop = log.scrollHeight; }
        if (ev.type === 'error') throw new Error(ev.message);
        if (ev.type === 'result') listings = ev.listings || [];
      }
    }
    state.listings = listings;
    state.selected = new Set(listings.filter((l) => l.strongHits > 0 || (l.strongTotal === 0 && l.score > 0.3)).map((l) => l.id));
    renderResults(listings);
    pane($('#resultPane'), true);
    setState(listings.length ? listings.length + ' Inserate gefunden' : '0 Inserate — Suche anpassen', listings.length ? 'ok' : 'err');
  } catch (e) {
    log.textContent += 'FEHLER: ' + e.message + '\n';
    setState('Suche fehlgeschlagen', 'err');
  } finally { $('#btnSearch').disabled = false; }
}

function renderResults(listings) {
  $('#selCount').textContent = '';
  if (!listings.length) { $('#resultTableWrap').innerHTML = '<div class="note">Keine Ergebnisse für diese Filter. Kilometer/Jahr erweitern oder Suchbegriffe ändern.</div>'; return; }
  const rows = listings.map((l) => {
    const checked = state.selected.has(l.id);
    const seller = l.sellerPrivate ? 'privat' : 'Händler';
    return `<tr data-id="${esc(l.id)}">
      <td><input type="checkbox" class="rowsel" data-id="${esc(l.id)}" ${checked ? 'checked' : ''}></td>
      <td><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc((l.titleRaw || 'Inserat ' + l.id).slice(0, 70))}</a>
          <div class="muted" style="font-size:11px">Bewertung ${num(Math.round(l.score * 100) / 100, 2)} · Code ${l.digitHits}/${l.digitTotal} · von „${esc(l.srcQuery)}“</div></td>
      <td>${esc(l.ez || '')}</td>
      <td class="num">${l.km ? kmShort(l.km) : ''}</td>
      <td>${l.ps ?? ''}</td>
      <td>${esc(l.fuel || '')}</td>
      <td class="num"><b>${eur(l.gross)}</b>${l.netto ? '<div class="muted" style="font-size:10px">netto → brutto</div>' : ''}</td>
      <td class="num">${l.price !== null ? eur(l.price) : ''}${l.netto ? ' netto' : ''}</td>
      <td>${seller}</td>
    </tr>`;
  }).join('');
  $('#resultTableWrap').innerHTML = `<table><thead><tr><th></th><th>Inserat</th><th>EZ</th><th>km</th><th>PS</th><th>Kraftstoff</th><th>Brutto</th><th>Inseratpreis</th><th>Anbieter</th></tr></thead><tbody>${rows}</tbody></table>`;
  $('#resultTableWrap').querySelectorAll('.rowsel').forEach((cb) => cb.onchange = () => {
    if (cb.checked) state.selected.add(cb.dataset.id); else state.selected.delete(cb.dataset.id);
    updateSel();
  });
  updateSel();
}

function updateSel() { $('#selCount').textContent = state.selected.size + ' von ' + state.listings.length + ' ausgewählt'; }

// ---------- Analyse ----------
async function runAnalysis() {
  if (!state.listings.length) return;
  let chosen = state.listings.filter((l) => state.selected.has(l.id));
  if (!chosen.length) chosen = state.listings;
  const listings = chosen.map((l) => ({ id: l.id, url: l.url, titleRaw: l.titleRaw, ez: l.ez, km: l.km, ps: l.ps, fuel: l.fuel, price: l.price, netto: l.netto, sellerPrivate: l.sellerPrivate, gross: l.gross, srcQuery: l.srcQuery }));
  $('#btnAnalyze').disabled = true;
  setState('Margen werden berechnet …', '');
  try {
    const analysis = await api('/api/analyze', { vehicle: state.vehicle, listings, options: { kmPct: 0.2, pricePct: 0.15, portFee: 700 }, save: true });
    state.analysis = analysis;
    renderAnalysis(analysis);
    pane($('#analysisPane'), true);
    setState('', '');
    await refreshHistory();
  } catch (e) { setState('Analyse fehlgeschlagen: ' + e.message, 'err'); }
  finally { $('#btnAnalyze').disabled = false; }
}

function renderAnalysis(a) {
  const s = a.stats;
  const coreIds = new Set(a.rows.filter((r) => r.inCore).map((r) => r.id));
  const rows = a.rows.map((r) => `<tr class="${r.inCore ? 'core' : ''}">
    <td>${r.inCore ? '⭐' : ''}</td>
    <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc((r.title || r.id).slice(0, 60))}</a></td>
    <td>${esc(r.ez || '')}</td><td class="num">${r.km ? kmShort(r.km) : ''}</td><td>${r.ps ?? ''}</td>
    <td class="num"><b>${eur(r.gross)}</b>${r.netto ? ' <span class="muted">(netto)</span>' : ''}</td>
    <td class="num ${r.spreadA !== null && r.spreadA >= 0 ? 'pos' : 'neg'}">${eur(r.spreadA)}</td>
    <td class="num">${eur(r.spreadB)}</td>
    <td class="num">${eur(r.spreadNet)}</td>
    <td class="num">${r.marginPct !== null ? num(r.marginPct, 1) + ' %' : '—'}</td>
  </tr>`).join('');
  const priceMid = s.priceMedian;
  $('#analysisCard').innerHTML = `
    <h2>4 · Margen-Analyse <span class="muted" style="font-size:12px">vs. Koreacars-Endpreis ${eur(a.cost.costAllIn)}</span></h2>
    <div class="stats">
      <div class="stat"><div class="k">Verglichene Autos</div><div class="v">${s.count}</div></div>
      <div class="stat"><div class="k">Kern-Treffer (km±20 % & Preis±15 %)</div><div class="v">${s.coreCount}</div></div>
      <div class="stat"><div class="k">Median Bruttopreis</div><div class="v" style="font-size:15px">${eur(priceMid)}</div></div>
      <div class="stat"><div class="k">Median Spanne (A)</div><div class="v">${eur(s.spreadAMedian)}</div></div>
      <div class="stat"><div class="k">Spanne min … max</div><div class="v" style="font-size:15px">${eur(s.spreadAMin)} … ${eur(s.spreadAMax)}</div></div>
      <div class="stat"><div class="k">Positive Spanne</div><div class="v">${s.positiveCount}/${s.count}</div></div>
    </div>
    <table><thead><tr><th>⭐</th><th>Inserat</th><th>EZ</th><th>km</th><th>PS</th><th>Brutto</th><th>Spanne A (vs. Endpreis)</th><th>Spanne B (+700 €)</th><th>Netto-Spanne (÷1,19)</th><th>Marge auf Preis</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="analy" style="margin-top:10px">
      <b>Annahmen:</b> Endpreis ${eur(a.cost.costAllIn)} (koreacars „ab“, inkl. 19 % MwSt. & 10 % Zoll, Hamburg) · inkl. Hafenpauschale ${eur(a.cost.costFull)} · netto (Vorsteuerabzug) ${eur(a.cost.costNet)}.<br>
      Kern-Regel: ${esc(a.cost.coreRule)}.<br>${esc(a.cost.note)}
    </div>
    <div class="actions">
      <button id="btnCsv" class="ghost">Export als CSV</button>
      <button id="btnCopyUrls" class="ghost">Inserat-Links kopieren</button>
      <span class="state">${coreIds.size ? '⭐ Kern-Vergleichsfahrzeuge' : ''}</span>
    </div>`;
  $('#btnCsv').onclick = () => exportCsv(a.rows);
  $('#btnCopyUrls').onclick = () => copyUrls(a.rows);
}

function exportCsv(rows) {
  const head = ['id;url;titel;ez;km;ps;kraftstoff;preisBrutto;netto;spanneEndpreis;spanneMitGebuehr;nettoSpanne;margeProzent;kern'];
  const body = rows.map((r) => [r.id, r.url, String(r.title || '').replace(/;/g, ','), r.ez || '', r.km ?? '', r.ps ?? '', r.fuel || '', r.gross ?? '', r.netto ? 1 : 0, r.spreadA ?? '', r.spreadB ?? '', r.spreadNet ?? '', r.marginPct ?? '', r.inCore ? 1 : 0].join(';'));
  download('analyse.csv', '\uFEFF' + head.concat(body).join('\n'), 'text/csv');
}
function copyUrls(rows) {
  navigator.clipboard.writeText(rows.map((r) => r.url).join('\n')).then(() => setState('Links kopiert', 'ok')).catch(() => {});
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Events ----------
$('#btnLoad').onclick = loadVehicle;
$('#carInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadVehicle(); });
$('#btnSearch').onclick = runSearch;
$('#btnAnalyze').onclick = runAnalysis;
$('#btnSelectCore').onclick = () => {
  state.selected = new Set(state.listings.filter((l) => l.strongHits > 0 || (l.strongTotal === 0 && l.score > 0.3)).map((l) => l.id));
  renderResults(state.listings);
};
$('#btnUnselect').onclick = () => { state.selected.clear(); renderResults(state.listings); };
$('#fMake').addEventListener('input', refreshModelSuggestions);

fillDatalists();
refreshHistory();

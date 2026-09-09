// Fetch translated mobile.de SRP, parse listing cards -> structured records
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0 Safari/537.36';
const SUFFIX = '&_x_tr_sl=de&_x_tr_tl=en&_x_tr_hl=en&_x_tr_pto=wapp';
const BASE = 'https://suchen-mobile-de.translate.goog/fahrzeuge/search.html?isSearchRequest=true&s=Car&vc=Car';
const CACHE_DIR = 'cache';
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchHTML(queryParams, { force = false } = {}) {
  const qs = new URLSearchParams(queryParams).toString();
  const cacheKey = qs.replace(/[^a-z0-9]+/gi, '_').slice(0, 140);
  const path = `${CACHE_DIR}/${cacheKey}.html`;
  if (!force && fs.existsSync(path)) return fs.readFileSync(path, 'utf8');
  const url = BASE + '&' + qs + SUFFIX;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(3500 + Math.random() * 3500);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (res.status === 429 || res.status === 503) { lastErr = new Error('HTTP ' + res.status); await sleep(12000); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const html = await res.text();
      fs.writeFileSync(path, html, 'utf8');
      console.log('fetched', queryParams.q || '', '->', res.status, html.length);
      return html;
    } catch (e) { lastErr = e; console.log('attempt', attempt, 'failed', e.message); await sleep(9000); }
  }
  throw lastErr || new Error('fetch failed');
}

function clean(t) {
  return t.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
}

const DEC = (s) => { const n = s.replace(/\./g, '').replace(',', '.'); return Number.isFinite(Number(n)) ? Number(n) : null; };

export function parseCards(html) {
  const cards = [];
  const openRe = /data-testid="([a-z]+)-result-listing-(\d+)"\s*>/gi;
  const idLinkRe = /details\.html\?id=(\d+)/g;
  const segs = [];
  let m;
  while ((m = openRe.exec(html)) !== null) {
    segs.push({ kind: m[1], idx: Number(m[2]), start: m.index });
  }
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    let end = i + 1 < segs.length ? segs[i + 1].start : html.length;
    idLinkRe.lastIndex = seg.start;
    const own = idLinkRe.exec(html);
    if (!own) continue;
    const id = own[1];
    let boundary = null;
    idLinkRe.lastIndex = own.index + own[0].length;
    while ((m = idLinkRe.exec(html)) !== null) {
      if (m[1] !== id) { boundary = m.index; break; }
    }
    if (boundary !== null && boundary > seg.start) end = Math.min(end, boundary);
    if (end - seg.start > 120000) end = seg.start + 120000;
    const block = html.slice(seg.start, end);
    const text = clean(block);
    const titleM = block.match(/result-listing-\d+-title[^>]*>([\s\S]*?)<\/[^>]+>/i);
    const title = titleM ? clean(titleM[1]) : '';
    let price = null;
    const psM = block.match(/data-testid="[^"]*result-listing-\d+-price-section"[\s\S]{0,700}?([\d.]+)\s*€/i);
    if (psM) price = DEC(psM[1]);
    if (price === null) { const pr2 = text.match(/([\d.]+)\s*€/); if (pr2) price = DEC(pr2[1]); }
    cards.push({ kind: seg.kind, idx: seg.idx, id, title, price, text });
  }
  return cards;
}

export { fetchHTML, BASE, SUFFIX };

// Local web app: Koreacars vehicle analysis -> mobile.de comparison -> margins
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractVehicle, listCached } from './lib/extract.mjs';
import { runMobileSearch, defaultSearchParams } from './lib/search.mjs';
import { analyzeMargins } from './lib/analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const PUBLIC = path.join(__dirname, 'public');
const RESULTS = path.join(__dirname, 'results');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// simple serial queue (polite to Chrome + translate proxy)
let chain = Promise.resolve();
function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function sendJson(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

async function ensureVehicle(idOrUrl) {
  const v = await extractVehicle(idOrUrl); // uses results/<id>/vehicle.json cache
  return v;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  try {
    // ---- static ----
    if (req.method === 'GET' && p === '/favicon.ico') {
      res.writeHead(204); return res.end();
    }
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
    if (req.method === 'GET' && p.startsWith('/static/')) {
      const f = path.join(PUBLIC, p); // /static/x -> public/static/x
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(f));
      }
      return sendJson(res, 404, { error: 'not found' });
    }

    // ---- API ----
    if (p === '/api/health') return sendJson(res, 200, { ok: true, ts: Date.now() });

    if (p === '/api/vehicles' && req.method === 'GET') {
      const list = listCached().map((v) => ({ id: v.id, title: v.title, ez: v.ez, mileage: v.mileage, priceK: v.koreaPriceEur, priceEnd: v.endPriceEur, fetchedAt: v.fetchedAt, hasPage: v.hasPage, hasEncar: v.hasEncar }));
      return sendJson(res, 200, { vehicles: list });
    }

    if (p === '/api/extract' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.idOrUrl) return sendJson(res, 400, { error: 'idOrUrl required' });
      const v = await enqueue(() => ensureVehicle(body.idOrUrl));
      return sendJson(res, 200, { vehicle: v });
    }

    if (p === '/api/defaults' && req.method === 'POST') {
      const body = await readBody(req);
      const v = body.vehicle || (body.vehicleId ? await ensureVehicle(body.vehicleId) : null);
      if (!v) return sendJson(res, 400, { error: 'vehicle required' });
      return sendJson(res, 200, { params: defaultSearchParams(v) });
    }

    if (p === '/api/search' && req.method === 'POST') {
      const body = await readBody(req);
      const v = body.vehicle || (body.vehicleId ? await ensureVehicle(body.vehicleId) : null);
      if (!v) return sendJson(res, 400, { error: 'vehicle required' });
      const params = { ...defaultSearchParams(v), ...(body.params || {}) };
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      const send = (o) => res.write(JSON.stringify(o) + '\n');
      send({ type: 'start', vehicleId: v.id, params });
      try {
        const listings = await enqueue(() => runMobileSearch(v, params, { onProgress: (msg) => send({ type: 'progress', message: msg }) }));
        send({ type: 'result', count: listings.length, listings });
      } catch (e) {
        send({ type: 'error', message: e.message });
      }
      return res.end();
    }

    if (p === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.vehicle || !Array.isArray(body.listings)) return sendJson(res, 400, { error: 'vehicle+listings required' });
      const analysis = analyzeMargins(body.vehicle, body.listings, body.options || {});
      if (body.save && body.vehicle.id) {
        try {
          fs.mkdirSync(path.join(RESULTS, String(body.vehicle.id)), { recursive: true });
          fs.writeFileSync(path.join(RESULTS, String(body.vehicle.id), 'analysis.json'), JSON.stringify({ vehicle: body.vehicle, analysis, savedAt: new Date().toISOString() }, null, 2), 'utf8');
        } catch { /* ignore */ }
      }
      return sendJson(res, 200, analysis);
    }

    if (p === '/api/report' && req.method === 'GET') {
      const id = u.searchParams.get('id');
      const f = path.join(RESULTS, id || '', 'analysis.json');
      if (!fs.existsSync(f)) return sendJson(res, 404, { error: 'no saved report' });
      return sendJson(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
    }

    return sendJson(res, 404, { error: 'unknown endpoint ' + p });
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Koreacars Analyzer running:  http://127.0.0.1:${PORT}`);
});

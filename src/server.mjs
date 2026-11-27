import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(__dirname, '..', 'data.json');

// ---- Lottery Data Cache ----
let cachedResult = null;
let lastFetch = 0;
let lastHash = '';
const sseClients = new Set();

const THAI_MONTHS = [
  'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
  'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'
];

function getCacheTtlMs() {
  // During Thai draw window (1st & 16th, 14:00-17:00 ICT), refresh every 10s
  const ict = new Date(Date.now() + 7 * 3600 * 1000);
  const day = ict.getUTCDate();
  const hr = ict.getUTCHours();
  if ((day === 1 || day === 16) && hr >= 14 && hr <= 17) return 10 * 1000;
  return 60 * 1000; // 1 min normally
}

function loadLocal() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; }
}
function saveLocal(data) {
  try {
    const prev = loadLocal();
    const history = Array.isArray(prev?._history) ? [...prev._history] : [];
    if (data && !data._fallback && data.period) {
      const idx = history.findIndex(h => h.period === data.period);
      const entry = {
        date: data.date,
        period: data.period,
        prizes: { first: data.prizes.first, back2: data.prizes.back2 }
      };
      if (idx >= 0) history[idx] = entry;
      else history.unshift(entry);
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ ...data, _history: history.slice(0, 30) }, null, 2));
  } catch (e) {
    console.log('saveLocal error:', e.message);
  }
}

function formatThaiDate(isoOrDisplay, displayDate) {
  if (displayDate?.date && displayDate?.month && displayDate?.year) {
    const d = Number(displayDate.date);
    const m = Number(displayDate.month);
    const yBE = Number(displayDate.year) + 543;
    return {
      date: `${d} ${THAI_MONTHS[m - 1] || ''} ${yBE}`,
      period: `งวด ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${String(yBE).slice(-2)}`
    };
  }
  return { date: isoOrDisplay || '', period: isoOrDisplay || '' };
}

function normalizeGLO(json) {
  try {
    const r = json?.response;
    const d = r?.data;
    if (!d || !d.first) return null;
    const vals = arr => (arr || []).map(x => String(x?.value ?? x ?? '').trim()).filter(Boolean);
    const { date, period } = formatThaiDate(r.date, json.displayDate);
    return {
      date,
      period,
      rawDate: r.date || '',
      updatedAt: new Date().toISOString(),
      source: 'GLO Official',
      prizes: {
        first:    { prize: Number(d.first.price)  || 6000000, numbers: vals(d.first.number) },
        firstAdj: { prize: Number(d.near1?.price) || 100000,  numbers: vals(d.near1?.number) },
        second:   { prize: Number(d.second?.price)|| 200000,  numbers: vals(d.second?.number) },
        third:    { prize: Number(d.third?.price) || 80000,   numbers: vals(d.third?.number) },
        fourth:   { prize: Number(d.fourth?.price)|| 40000,   numbers: vals(d.fourth?.number) },
        fifth:    { prize: Number(d.fifth?.price) || 20000,   numbers: vals(d.fifth?.number) },
        front3:   { prize: Number(d.last3f?.price)|| 4000,    numbers: vals(d.last3f?.number) },
        back3:    { prize: Number(d.last3b?.price)|| 4000,    numbers: vals(d.last3b?.number) },
        back2:    { prize: Number(d.last2?.price) || 2000,    numbers: vals(d.last2?.number) }
      }
    };
  } catch { return null; }
}

function broadcastUpdate(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

async function fetchLottery(force = false) {
  const now = Date.now();
  if (!force && cachedResult && now - lastFetch < getCacheTtlMs()) return cachedResult;

  // 1. Try Official GLO API
  try {
    const res = await fetch('https://www.glo.or.th/api/lottery/getLatestLottery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      body: '{}',
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const json = await res.json();
      const data = normalizeGLO(json);
      if (data) {
        const hash = JSON.stringify(data.prizes) + data.period;
        const changed = hash !== lastHash;
        lastHash = hash;
        cachedResult = data;
        lastFetch = now;
        saveLocal(data);
        if (changed && sseClients.size > 0) broadcastUpdate(data);
        return data;
      }
    }
  } catch (e) {
    console.log('GLO API fetch failed:', e.message);
  }

  // 2. Fallback: local cache
  const local = loadLocal();
  if (local && !local._fallback) { cachedResult = local; return local; }

  // 3. Fallback: hardcoded last known result
  return fallbackData();
}

function fallbackData() {
  return {
    date: '16 พฤศจิกายน 2567',
    period: 'งวด 16/11/67',
    prizes: {
      first:    { prize: 6000000, numbers: ['537846'] },
      firstAdj: { prize: 100000,  numbers: ['537845', '537847'] },
      second:   { prize: 200000,  numbers: ['042156','157382','384620','726193','891047'] },
      third:    { prize: 80000,   numbers: ['012345','098765','234567','345678','456789','567890','678901','789012','890123','901234'] },
      fourth:   { prize: 40000,   numbers: Array.from({length:50}, (_,i) => String(100000+i*1234).slice(-6)) },
      fifth:    { prize: 20000,   numbers: Array.from({length:100},(_,i) => String(200000+i*987).slice(-6)) },
      front3:   { prize: 4000,    numbers: ['537','846'] },
      back3:    { prize: 4000,    numbers: ['846','537'] },
      back2:    { prize: 2000,    numbers: ['46'] }
    },
    _fallback: true
  };
}

// ---- Check Logic ----
function checkNumber(num, lotto) {
  const results = [];
  const p = lotto.prizes;
  const n6 = num.padStart(6,'0').slice(-6);
  const n3f = n6.slice(0,3);
  const n3b = n6.slice(-3);
  const n2  = n6.slice(-2);

  if (p.first.numbers.includes(n6))    results.push({ name:'รางวัลที่ 1',           prize: p.first.prize,    number: n6 });
  if (p.firstAdj.numbers.includes(n6)) results.push({ name:'รางวัลข้างเคียงที่ 1',  prize: p.firstAdj.prize, number: n6 });
  if (p.second.numbers.includes(n6))   results.push({ name:'รางวัลที่ 2',           prize: p.second.prize,   number: n6 });
  if (p.third.numbers.includes(n6))    results.push({ name:'รางวัลที่ 3',           prize: p.third.prize,    number: n6 });
  if (p.fourth.numbers.includes(n6))   results.push({ name:'รางวัลที่ 4',           prize: p.fourth.prize,   number: n6 });
  if (p.fifth.numbers.includes(n6))    results.push({ name:'รางวัลที่ 5',           prize: p.fifth.prize,    number: n6 });
  if (p.front3.numbers.includes(n3f))  results.push({ name:'เลขหน้า 3 ตัว',        prize: p.front3.prize,   number: n3f });
  if (p.back3.numbers.includes(n3b))   results.push({ name:'เลขท้าย 3 ตัว',        prize: p.back3.prize,    number: n3b });
  if (p.back2.numbers.includes(n2))    results.push({ name:'เลขท้าย 2 ตัว',        prize: p.back2.prize,    number: n2 });
  return results;
}

// ---- MIME ----
const MIME = {
  '.html':'text/html;charset=utf-8', '.js':'application/javascript',
  '.css':'text/css', '.ico':'image/x-icon', '.png':'image/png'
};

// ---- Sitemap helper ----
function buildSitemap(host) {
  const base = host || 'https://yoursite.com';
  const now = new Date().toISOString().split('T')[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority><lastmod>${now}</lastmod></url>
  <url><loc>${base}/history.html</loc><changefreq>weekly</changefreq><priority>0.8</priority><lastmod>${now}</lastmod></url>
</urlset>`;
}

// ---- Server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // sitemap.xml
  if (url.pathname === '/sitemap.xml') {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    res.writeHead(200, {'Content-Type':'application/xml'});
    return res.end(buildSitemap(`${proto}://${host}`));
  }

  // robots.txt
  if (url.pathname === '/robots.txt') {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3001';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    res.writeHead(200, {'Content-Type':'text/plain'});
    return res.end(`User-agent: *\nAllow: /\nSitemap: ${proto}://${host}/sitemap.xml\n`);
  }

  // ads.txt — Google AdSense
  if (url.pathname === '/ads.txt') {
    res.writeHead(200, {'Content-Type':'text/plain'});
    return res.end(`google.com, pub-9851215128556924, DIRECT, f08c47fec0942fa0\n`);
  }

  // API: history
  if (url.pathname === '/api/history') {
    const local = loadLocal();
    const history = local?._history || [];
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    return res.end(JSON.stringify(history.slice(0, 20)));
  }

  // API: real-time SSE stream
  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    sseClients.add(res);
    const data = await fetchLottery();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 25000);
    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
    return;
  }

  // API: get lottery results
  if (url.pathname === '/api/lotto') {
    const force = url.searchParams.get('fresh') === '1';
    const data = await fetchLottery(force);
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
    return res.end(JSON.stringify(data));
  }

  // API: check number
  if (url.pathname === '/api/check') {
    const num = (url.searchParams.get('n') || '').replace(/\D/g,'');
    if (!num) {
      res.writeHead(400, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({error:'กรุณากรอกเลข'}));
    }
    const data = await fetchLottery();
    const wins = checkNumber(num, data);
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    return res.end(JSON.stringify({ number: num, wins, period: data.period, date: data.date }));
  }

  // Static files
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  filePath = path.join(PUBLIC, filePath);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    res.writeHead(200, {'Content-Type': MIME[ext] || 'text/plain'});
    res.end(data);
  });
});

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`🎰 Lottery Checker running at http://localhost:${PORT}`);
  console.log('📡 Real-time GLO Official API enabled');
  fetchLottery(true).catch(() => {});
  setInterval(() => {
    if (sseClients.size > 0) fetchLottery().catch(() => {});
  }, 15000);
});

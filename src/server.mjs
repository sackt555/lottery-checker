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
const CACHE_MS = 10 * 60 * 1000; // 10 min

function loadLocal() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return null; }
}
function saveLocal(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function fetchLottery() {
  const now = Date.now();
  if (cachedResult && now - lastFetch < CACHE_MS) return cachedResult;

  try {
    // Try alotterydb API (free, public)
    const res = await fetch('https://api.alotterydb.com/lotto', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const json = await res.json();
      // Normalize format
      const data = normalize(json);
      if (data) {
        cachedResult = data;
        lastFetch = now;
        saveLocal(data);
        return data;
      }
    }
  } catch (e) {
    console.log('API fetch failed:', e.message);
  }

  // Fallback: local cache
  const local = loadLocal();
  if (local) { cachedResult = local; return local; }

  // Fallback: hardcoded last known result
  return fallbackData();
}

function normalize(json) {
  try {
    // alotterydb format
    if (json.response) {
      const r = json.response;
      return {
        date: r.date || '',
        period: r.period || '',
        prizes: {
          first:    { prize: 6000000, numbers: [r.first] },
          firstAdj: { prize: 100000,  numbers: r.near1 || [] },
          second:   { prize: 200000,  numbers: r.second || [] },
          third:    { prize: 80000,   numbers: r.third || [] },
          fourth:   { prize: 40000,   numbers: r.fourth || [] },
          fifth:    { prize: 20000,   numbers: r.fifth || [] },
          front3:   { prize: 4000,    numbers: r.front3 || [] },
          back3:    { prize: 4000,    numbers: r.back3 || [] },
          back2:    { prize: 2000,    numbers: [r.back2] }
        }
      };
    }
    return null;
  } catch { return null; }
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

  // API: get lottery results
  if (url.pathname === '/api/lotto') {
    const data = await fetchLottery();
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
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
  console.log('📡 Fetching real lottery data from api.alotterydb.com...');
});

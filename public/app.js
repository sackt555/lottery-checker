'use strict';

const $ = id => document.getElementById(id);

function fmt(n) {
  return Number(n).toLocaleString('th-TH');
}

let lastSignature = '';

// ── LOAD & REALTIME STREAM ──
async function loadLotto(fresh = false) {
  try {
    const res  = await fetch(fresh ? '/api/lotto?fresh=1' : '/api/lotto');
    const data = await res.json();
    applyData(data);
  } catch {
    if (!lastSignature) {
      $('results').innerHTML = '<div style="text-align:center;padding:40px;color:#555">โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรช</div>';
    }
  }
}

function applyData(data) {
  const sig = JSON.stringify(data.prizes) + data.period;
  if (sig !== lastSignature) {
    lastSignature = sig;
    renderResults(data);
    if ($('numInput').value.replace(/\D/g, '').length >= 2 && $('checkResult').innerHTML) {
      checkNum();
    }
  }
  updateMeta(data);
}

function updateMeta(data) {
  const lbl = $('periodLabel');
  lbl.textContent = (data.date || data.period || '') + (data._fallback ? ' (ตัวอย่าง)' : '');
  lbl.classList.add('ready');

  const dot = $('liveDot');
  if (dot && !data._fallback) dot.classList.add('online');

  const upd = $('updatedAt');
  if (upd) {
    const t = data.updatedAt ? new Date(data.updatedAt) : new Date();
    const hhmmss = t.toLocaleTimeString('th-TH', { hour12: false });
    upd.textContent = data._fallback
      ? 'โหมดออฟไลน์'
      : `LIVE • อัปเดตเมื่อ ${hhmmss}`;
  }
}

async function forceRefresh() {
  const btn = $('refreshBtn');
  if (btn) btn.classList.add('spin');
  await loadLotto(true);
  if (btn) setTimeout(() => btn.classList.remove('spin'), 400);
}

function startRealtime() {
  if (typeof EventSource !== 'undefined') {
    const es = new EventSource('/api/stream');
    es.onmessage = e => {
      try { applyData(JSON.parse(e.data)); } catch {}
    };
    es.onerror = () => {
      const dot = $('liveDot');
      if (dot) dot.classList.remove('online');
    };
  }
  setInterval(() => loadLotto(false), 30000);
}

function renderResults(data) {

  const p = data.prizes;
  let html = '';

  if (data._fallback) {
    html += `<div style="margin:0 20px 16px;padding:10px 14px;border:1px solid #2a2200;border-radius:6px;font-size:.75rem;color:#666;text-align:center">
      ⚠️ ไม่สามารถดึงข้อมูลจริงได้ กำลังแสดงข้อมูลตัวอย่าง
    </div>`;
  }

  // ── รางวัลที่ 1 ──
  html += `<div class="sec">รางวัลที่ 1 — ${fmt(p.first.prize)} บาท</div>
  <div class="prize-list">
    <div style="text-align:center;padding:16px 0 20px">
      ${p.first.numbers.map(n => `<span class="num num-xl num-gold">${n}</span>`).join('')}
    </div>
  </div>`;

  // ── รางวัลข้างเคียง ──
  html += `<div class="sec">รางวัลข้างเคียงรางวัลที่ 1 — ${fmt(p.firstAdj.prize)} บาท</div>
  <div class="prize-list">
    <div class="prize-item" style="justify-content:center;gap:16px;border:none;padding:8px 0 16px">
      ${p.firstAdj.numbers.map(n => `<span class="num num-lg num-adj">${n}</span>`).join('')}
    </div>
  </div>
  <div class="divider"></div>`;

  // ── รางวัลที่ 2–5 ──
  html += `<div class="sec">รางวัลที่ 2–5</div><div class="prize-list">`;
  const main = [
    { key:'second', label:'รางวัลที่ 2', cls:'num-md' },
    { key:'third',  label:'รางวัลที่ 3', cls:'num-md' },
    { key:'fourth', label:'รางวัลที่ 4', cls:'num-sm' },
    { key:'fifth',  label:'รางวัลที่ 5', cls:'num-sm' },
  ];
  for (const m of main) {
    html += `<div class="prize-item">
      <div class="pi-left">
        <div class="pi-name">${m.label}</div>
        <div class="pi-amount">${fmt(p[m.key].prize)} บาท</div>
      </div>
      <div class="pi-nums">
        ${p[m.key].numbers.slice(0, m.key === 'fourth' || m.key === 'fifth' ? 10 : 99)
          .map(n => `<span class="num ${m.cls}">${n}</span>`).join('')}
        ${p[m.key].numbers.length > 10 && (m.key==='fourth'||m.key==='fifth')
          ? `<span class="num num-sm" style="color:#444">+${p[m.key].numbers.length-10} อีก</span>` : ''}
      </div>
    </div>`;
  }
  html += `</div><div class="divider"></div>`;

  // ── เลขท้าย ──
  html += `<div class="sec">เลขท้าย</div><div class="prize-list">`;
  html += numRow('เลขหน้า 3 ตัว', p.front3, 'num-green', 'num-lg');
  html += numRow('เลขท้าย 3 ตัว', p.back3,  'num-green', 'num-lg');
  html += numRow('เลขท้าย 2 ตัว', p.back2,  'num-gold',  'num-xl', true);
  html += `</div>`;

  $('results').innerHTML = html;
}

function numRow(label, prize, cls, size, last=false) {
  return `<div class="prize-item" ${last?'style="border-bottom:none"':''}>
    <div class="pi-left">
      <div class="pi-name">${label}</div>
      <div class="pi-amount">${fmt(prize.prize)} บาท</div>
    </div>
    <div class="pi-nums">
      ${prize.numbers.map(n=>`<span class="num ${size} ${cls}">${n}</span>`).join('')}
    </div>
  </div>`;
}

// ── CHECK ──
async function checkNum() {
  const raw = $('numInput').value.replace(/\D/g,'');
  if (raw.length < 2) {
    $('checkResult').innerHTML = `<div class="result-miss" style="text-align:left;padding:12px 0 0;font-size:.82rem;color:#666">กรุณากรอกเลขอย่างน้อย 2 หลัก</div>`;
    return;
  }
  const btn = $('checkBtn');
  btn.disabled = true; btn.textContent = '…';

  try {
    const res  = await fetch(`/api/check?n=${encodeURIComponent(raw)}`);
    const data = await res.json();
    renderCheck(data);
  } catch {
    $('checkResult').innerHTML = `<div class="result-miss">เกิดข้อผิดพลาด ลองใหม่</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'ตรวจ';
  }
}

function renderCheck(data) {
  const el = $('checkResult');
  if (!data.wins || data.wins.length === 0) {
    el.innerHTML = `<div class="result-miss" style="padding:16px 0 4px">
      <strong>เลข ${data.number} — ไม่ถูกรางวัล</strong>
      <span style="font-size:.78rem;color:#555">${data.period}</span>
    </div>`;
    return;
  }
  const total = data.wins.reduce((s,w)=>s+w.prize, 0);
  let html = `<div style="margin-top:14px">`;
  html += data.wins.map(w=>`
    <div class="result-win-row">
      <div>
        <div style="font-size:.85rem;color:#ccc">${w.name}</div>
        <div style="font-size:.75rem;color:#555">เลข ${w.number}</div>
      </div>
      <div class="rwprize">+${fmt(w.prize)}</div>
    </div>`).join('');
  html += `<div class="result-total">
    <span class="label">รวมได้รับ</span>
    <span class="amount">${fmt(total)} บาท</span>
  </div></div>`;
  el.innerHTML = html;
}

function clearNum() {
  $('numInput').value = '';
  $('clearBtn').hidden = true;
  $('checkResult').innerHTML = '';
  $('numInput').focus();
}

$('numInput').addEventListener('input', e => {
  const clean = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value !== clean) e.target.value = clean;
  $('clearBtn').hidden = clean.length === 0;
});

$('numInput').addEventListener('keydown', e => { if(e.key==='Enter') checkNum(); });

loadLotto();
startRealtime();

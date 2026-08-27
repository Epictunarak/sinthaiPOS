import { api } from '../api.js';

function todayStr() {
  const d = new Date();
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
}

export function renderReports(container) {
  let date = todayStr();
  let report = null;
  let loading = false;
  let error = null;

  async function load() {
    loading = true;
    error = null;
    draw();
    try {
      const result = await api.getReport(date);
      if (result.ok) {
        report = result;
      } else {
        error = result.error;
      }
    } catch {
      error = 'ต้องออนไลน์เพื่อดูรายงาน';
    }
    loading = false;
    draw();
  }

  function draw() {
    container.innerHTML = `
      <div class="card">
        <label class="text-dim">วันที่</label>
        <input type="date" id="date" value="${date}" />
      </div>
      ${error ? `<div class="msg error">${error}</div>` : ''}
      ${loading ? '<p class="text-dim">กำลังโหลด...</p>' : ''}
      ${
        report
          ? `
        <div class="grid-2">
          <div class="card"><div class="text-dim">จำนวนบิล</div><div style="font-size:2rem; font-weight:700;">${report.orderCount}</div></div>
          <div class="card"><div class="text-dim">ยอดขายสุทธิ</div><div style="font-size:2rem; font-weight:700;">${report.totalSales.toFixed(2)} บาท</div></div>
          <div class="card"><div class="text-dim">ส่วนลดรวม</div><div style="font-size:1.4rem; font-weight:700;">${report.totalDiscount.toFixed(2)} บาท</div></div>
        </div>`
          : ''
      }
    `;
    container.querySelector('#date').addEventListener('change', (e) => {
      date = e.target.value;
      load();
    });
  }

  draw();
  load();
}

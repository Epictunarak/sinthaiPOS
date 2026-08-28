import { api } from '../api.js';
import { money } from '../receipt.js';

function todayStr() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * หน้ารายงาน — เน้น "กำไร" ไม่ใช่แค่ "ยอดขาย"
 *
 * ร้านนี้มีสินค้าที่ขายต่ำกว่าทุนอยู่จริง ถ้ารายงานบอกแค่ยอดขาย ยิ่งขายดีจะยิ่งดูดี
 * ทั้งที่กำลังขาดทุน หน้านี้จึงแสดงกำไรขั้นต้นคู่กับคำเตือนว่ามีสินค้าไหนขายขาดทุนไปบ้าง
 */
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
        report = null;
      }
    } catch {
      error = 'ต้องออนไลน์เพื่อดูรายงาน';
      report = null;
    }
    loading = false;
    draw();
  }

  function stat(label, value, extra = '') {
    return `<div class="card">
      <div class="text-dim">${label}</div>
      <div style="font-size:1.7rem; font-weight:700; line-height:1.3;">${value}</div>
      ${extra ? `<div class="text-dim">${extra}</div>` : ''}
    </div>`;
  }

  function profitSection() {
    const known = Number(report.revenueWithKnownCost || 0);
    const unknown = Number(report.unknownCostRevenue || 0);
    const covered = known + unknown > 0 ? Math.round((known / (known + unknown)) * 100) : 0;
    const profit = Number(report.grossProfit || 0);

    // ถ้ารู้ต้นทุนไม่ครบ ตัวเลขกำไรจะไม่ใช่กำไรทั้งวัน ต้องบอกให้ชัดว่าครอบคลุมแค่ไหน
    const caveat = covered < 100
      ? `คิดจากยอดขายที่รู้ต้นทุนเท่านั้น (${covered}% ของยอดขายวันนี้)
         อีก ${money(unknown)} บาทยังไม่รู้ต้นทุน`
      : 'ครอบคลุมยอดขายทั้งวัน';

    return stat(
      'กำไรขั้นต้น',
      `<span style="color:${profit < 0 ? 'var(--danger)' : 'var(--ok)'}">${money(profit)} บาท</span>`,
      caveat
    );
  }

  function draw() {
    const belowCost = (report && report.soldBelowCost) || [];
    const top = (report && report.topSellers) || [];

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
        ${
          belowCost.length
            ? `<div class="msg error">
                 <strong>วันนี้ขายสินค้าต่ำกว่าทุน ${belowCost.length} รายการ</strong><br/>
                 ${belowCost.map((p) => `${p.name} (${p.qty} หน่วย)`).join('<br/>')}
               </div>`
            : ''
        }
        <div class="grid-2">
          ${stat('ยอดขายสุทธิ', `${money(report.totalSales)} บาท`, `${report.orderCount} บิล`)}
          ${profitSection()}
          ${stat('จำนวนสินค้าที่ขายได้', `${report.itemCount || 0}`, 'หน่วย')}
          ${stat('ส่วนลดรวม', `${money(report.totalDiscount)} บาท`)}
        </div>
        <div class="card">
          <h3 style="margin-top:0;">ขายดีที่สุดวันนี้</h3>
          ${
            top.length
              ? `<div style="overflow-x:auto;"><table>
                   <thead><tr><th>สินค้า</th><th>จำนวน</th><th>ยอดขาย</th><th>กำไร</th></tr></thead>
                   <tbody>
                     ${top.map((p) => `
                       <tr class="${p.soldBelowCost ? 'low-stock' : ''}">
                         <td>${p.name}</td>
                         <td>${p.qty}</td>
                         <td>${money(p.revenue)}</td>
                         <td>${
                           p.profit === null || p.profit === undefined
                             ? '<span class="text-dim">ยังไม่รู้ทุน</span>'
                             : `<span class="badge ${p.profit < 0 ? 'danger' : 'ok'}">${money(p.profit)}</span>`
                         }</td>
                       </tr>`).join('')}
                   </tbody>
                 </table></div>`
              : '<p class="text-dim">ยังไม่มีการขายในวันนี้</p>'
          }
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

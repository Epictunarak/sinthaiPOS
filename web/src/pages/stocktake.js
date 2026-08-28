import { api } from '../api.js';
import { cacheProducts, getCachedProducts } from '../db.js';
import { getSession } from '../session.js';
import { applyStockQty } from '../stock.js';

/**
 * หน้าตรวจนับสต็อก — ใช้ตอนเปิดร้านครั้งแรก และตอนนับรอบประจำ
 *
 * ออกแบบให้กรอก "จำนวนที่นับได้จริง" ไม่ใช่ส่วนต่าง เพราะตอนยืนนับของอยู่หน้าชั้น
 * คนนับรู้แค่ว่านับได้กี่ชิ้น ไม่ได้อยากคิดเลขว่าต่างจากในระบบเท่าไหร่
 * ระบบคำนวณส่วนต่างให้เอง แล้วบันทึกเป็นการเคลื่อนไหวสต็อกเพื่อให้ตรวจย้อนหลังได้
 *
 * ปุ่มบวกลบทีละ 1 ในหน้า "สต็อก" เหมาะกับแก้ยอดทีละนิด แต่ไม่เหมาะกับการนับทั้งร้าน
 * 141 รายการ หน้านี้จึงแยกออกมาให้กรอกตัวเลขตรงๆ
 */
export function renderStocktake(container) {
  const staff = getSession();
  let products = [];
  let search = '';
  let counts = {};      // sku -> ตัวเลขที่พิมพ์ค้างไว้
  let savingSku = null;
  let message = null;
  let hideCounted = false;
  let countedThisSession = new Set();

  async function load() {
    products = await getCachedProducts();
    draw();
    if (navigator.onLine) {
      try {
        const result = await api.getProducts();
        if (result.ok) {
          products = result.products;
          await cacheProducts(products);
          draw();
        }
      } catch {
        /* ใช้ข้อมูลที่แคชไว้ */
      }
    }
  }

  function visible() {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => !hideCounted || !countedThisSession.has(p.SKU))
      .filter((p) => !q || String(p.Name).toLowerCase().includes(q) ||
                     String(p.SKU).toLowerCase().includes(q))
      .slice(0, 50);
  }

  async function submit(sku) {
    const raw = counts[sku];
    if (raw === undefined || raw === '') return;
    const counted = Number(raw);
    if (!Number.isFinite(counted) || counted < 0) {
      message = { type: 'error', text: 'จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' };
      draw();
      return;
    }
    if (!navigator.onLine) {
      // ไม่เก็บเข้าคิวออฟไลน์โดยตั้งใจ: ถ้าระหว่างนั้นมีการขายเกิดขึ้น ยอดที่นับไว้จะกลาย
      // เป็นค่าเก่าที่ไปทับยอดใหม่ ทำให้สต็อกเพี้ยนแบบหาสาเหตุยาก
      message = { type: 'error', text: 'ต้องออนไลน์เพื่อบันทึกการนับ (กันยอดนับทับยอดขายที่เกิดระหว่างนั้น)' };
      draw();
      return;
    }

    savingSku = sku;
    draw();
    try {
      const result = await api.countStock({
        sku,
        countedQty: counted,
        userId: staff?.userId || ''
      });
      if (result.ok) {
        const local = products.find((p) => p.SKU === sku);
        applyStockQty(local, result.stockQty);
        await cacheProducts(products);
        countedThisSession.add(sku);
        delete counts[sku];
        const diff = result.difference || 0;
        message = {
          type: diff === 0 ? 'success' : 'info',
          text: diff === 0
            ? `${local?.Name || sku}: ตรงกับระบบพอดี`
            : `${local?.Name || sku}: บันทึกเป็น ${result.stockQty} (${diff > 0 ? '+' : ''}${diff} จากเดิม ${result.before})`
        };
      } else {
        message = { type: 'error', text: result.error };
      }
    } catch {
      message = { type: 'error', text: 'เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง' };
    } finally {
      savingSku = null;
      draw();
    }
  }

  function draw() {
    const list = visible();
    const zeroStock = products.filter((p) => Number(p.StockQty) === 0).length;

    container.innerHTML = `
      ${message ? `<div class="msg ${message.type}">${message.text}</div>` : ''}

      <div class="card">
        <strong>ตรวจนับสต็อก</strong>
        <p class="text-dim" style="margin:6px 0 0;">
          กรอก <strong>จำนวนที่นับได้จริง</strong> แล้วกด Enter ระบบจะคำนวณส่วนต่างให้เอง
          และบันทึกไว้ให้ตรวจย้อนหลังได้
        </p>
        <p class="text-dim" style="margin:6px 0 0;">
          นับแล้วรอบนี้ ${countedThisSession.size} รายการ ·
          ยอดคงเหลือยังเป็น 0 อยู่ ${zeroStock} รายการ
        </p>
      </div>

      <div class="card">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
          <input id="search" placeholder="ค้นหาสินค้า" value="${search}" style="flex:1; min-width:200px;" />
          <label style="display:flex; align-items:center; gap:6px; white-space:nowrap;">
            <input type="checkbox" id="hideCounted" ${hideCounted ? 'checked' : ''} style="width:auto;" />
            ซ่อนที่นับแล้ว
          </label>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr><th>สินค้า</th><th>ในระบบ</th><th>นับได้จริง</th><th></th></tr>
            </thead>
            <tbody>
              ${list
                .map((p) => {
                  const done = countedThisSession.has(p.SKU);
                  const value = counts[p.SKU] !== undefined ? counts[p.SKU] : '';
                  return `
                <tr>
                  <td>${p.Name}<br/><span class="text-dim">${p.SKU} ${
                    done ? '<span class="badge ok">นับแล้ว</span>' : ''
                  }</span></td>
                  <td>${p.StockQty} ${p.Unit || ''}</td>
                  <td style="min-width:110px;">
                    <input type="number" min="0" inputmode="numeric"
                           data-count="${p.SKU}" value="${value}" placeholder="นับได้" />
                  </td>
                  <td>
                    <button data-save="${p.SKU}" ${savingSku === p.SKU ? 'disabled' : ''}>
                      ${savingSku === p.SKU ? '...' : 'บันทึก'}
                    </button>
                  </td>
                </tr>`;
                })
                .join('') || '<tr><td colspan="4" class="text-dim">ไม่พบสินค้า</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const searchInput = container.querySelector('#search');
    searchInput.addEventListener('input', (e) => {
      search = e.target.value;
      draw();
      const el = container.querySelector('#search');
      el.focus();
      el.setSelectionRange(search.length, search.length);
    });

    container.querySelector('#hideCounted').addEventListener('change', (e) => {
      hideCounted = e.target.checked;
      draw();
    });

    container.querySelectorAll('[data-count]').forEach((input) => {
      input.addEventListener('input', (e) => { counts[input.dataset.count] = e.target.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submit(input.dataset.count); }
      });
    });

    container.querySelectorAll('[data-save]').forEach((btn) => {
      btn.addEventListener('click', () => submit(btn.dataset.save));
    });
  }

  draw();
  load();
}

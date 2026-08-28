import { api } from '../api.js';
import { cacheProducts, getCachedProducts } from '../db.js';
import { getSession } from '../session.js';
import { money } from '../receipt.js';

/**
 * หน้าสั่งซื้อ/รับของ — ต่อจากทริปไป Makro โดยตรง
 *
 * วงจรจริงของร้านคือ: ของใกล้หมด → ไปซื้อที่ Makro → เอาของกลับมาเข้าสต็อก
 * หน้านี้ทำสองอย่างนั้นในที่เดียว
 *
 * ไม่รวมเข้ากับหน้า "ตรวจนับ" เพราะเป็นคนละความหมาย:
 *   ตรวจนับ = "มีของอยู่จริงเท่าไหร่" (แก้ตัวเลขให้ตรงความจริง)
 *   รับของ  = "เพิ่งซื้อของเข้ามาเท่าไหร่" (ของเพิ่มขึ้นจริงๆ)
 * ถ้าปนกัน ประวัติสต็อกจะบอกไม่ได้ว่าของหายไปเพราะขาย เพราะนับผิด หรือเพราะอะไร
 */

// ซื้อให้ถึงระดับนี้เทียบกับจุดสั่งซื้อ เช่น จุดสั่งซื้อ 5 → เติมให้ถึง 15
const RESTOCK_TARGET_MULTIPLIER = 3;

export function renderRestock(container) {
  const staff = getSession();
  let products = [];
  let receiving = {};      // sku -> จำนวนที่พิมพ์ค้างไว้
  let savingSku = null;
  let message = null;
  let search = '';

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

  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };

  function needsOrder() {
    return products
      .filter((p) => num(p.StockQty) <= num(p.ReorderPoint))
      .map((p) => {
        const target = Math.max(num(p.ReorderPoint) * RESTOCK_TARGET_MULTIPLIER, 1);
        const suggested = Math.max(target - num(p.StockQty), 1);
        const cost = p.Cost === '' || p.Cost === null || p.Cost === undefined ? null : num(p.Cost);
        return { product: p, suggested, cost, estimated: cost === null ? null : cost * suggested };
      })
      .sort((a, b) => {
        // ของที่หมดแล้วต้องขึ้นก่อน เพราะขายไม่ได้อยู่ตอนนี้
        const aOut = num(a.product.StockQty) === 0 ? 0 : 1;
        const bOut = num(b.product.StockQty) === 0 ? 0 : 1;
        return aOut - bOut || (b.estimated || 0) - (a.estimated || 0);
      });
  }

  async function receive(sku) {
    const raw = receiving[sku];
    if (raw === undefined || raw === '') return;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) {
      message = { type: 'error', text: 'จำนวนที่รับเข้าต้องมากกว่า 0' };
      draw();
      return;
    }
    if (!navigator.onLine) {
      message = { type: 'error', text: 'ต้องออนไลน์เพื่อบันทึกการรับของ' };
      draw();
      return;
    }

    savingSku = sku;
    draw();
    try {
      const result = await api.adjustStock({
        sku,
        changeQty: qty,
        reason: 'restock',
        userId: staff?.userId || ''
      });
      if (result.ok) {
        const local = products.find((p) => p.SKU === sku);
        if (local) local.StockQty = result.stockQty;
        await cacheProducts(products);
        delete receiving[sku];
        message = {
          type: 'success',
          text: `รับ ${local?.Name || sku} เข้า ${qty} — คงเหลือ ${result.stockQty}`
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
    const orders = needsOrder();
    const knownCost = orders.filter((o) => o.estimated !== null);
    const estimatedTotal = knownCost.reduce((sum, o) => sum + o.estimated, 0);
    const unknownCount = orders.length - knownCost.length;

    const q = search.trim().toLowerCase();
    const receiveList = products
      .filter((p) => !q || String(p.Name).toLowerCase().includes(q) ||
                     String(p.SKU).toLowerCase().includes(q))
      .slice(0, 30);

    container.innerHTML = `
      ${message ? `<div class="msg ${message.type}">${message.text}</div>` : ''}

      <div class="card">
        <h3 style="margin-top:0;">ต้องสั่งซื้อ ${orders.length} รายการ</h3>
        ${
          orders.length
            ? `<p class="text-dim" style="margin-top:0;">
                 ประมาณการค่าใช้จ่าย <strong>${money(estimatedTotal)} บาท</strong>
                 ${unknownCount ? `(ยังไม่รวมอีก ${unknownCount} รายการที่ไม่รู้ต้นทุน)` : ''}
               </p>
               <div style="overflow-x:auto;">
                 <table>
                   <thead><tr><th>สินค้า</th><th>เหลือ</th><th>ควรซื้อ</th><th>เป็นเงิน</th></tr></thead>
                   <tbody>
                     ${orders.map((o) => `
                       <tr class="${num(o.product.StockQty) === 0 ? 'low-stock' : ''}">
                         <td>${o.product.Name}<br/><span class="text-dim">${o.product.SKU}</span></td>
                         <td>${o.product.StockQty}${num(o.product.StockQty) === 0
                              ? ' <span class="badge danger">หมด</span>' : ''}</td>
                         <td>${o.suggested}</td>
                         <td>${o.estimated === null
                              ? '<span class="text-dim">ไม่รู้ทุน</span>'
                              : money(o.estimated)}</td>
                       </tr>`).join('')}
                   </tbody>
                 </table>
               </div>
               <p class="text-dim">คิดจากจุดสั่งซื้อของแต่ละรายการ เติมให้ถึง ${RESTOCK_TARGET_MULTIPLIER} เท่า
                  ปรับจุดสั่งซื้อได้ที่คอลัมน์ ReorderPoint</p>`
            : '<p class="text-dim">ยังไม่มีสินค้าที่ต่ำกว่าจุดสั่งซื้อ</p>'
        }
      </div>

      <div class="card">
        <h3 style="margin-top:0;">รับของเข้า</h3>
        <p class="text-dim" style="margin-top:0;">
          กรอกจำนวนที่ <strong>เพิ่งซื้อเข้ามา</strong> แล้วกด Enter (ไม่ใช่จำนวนคงเหลือทั้งหมด —
          ถ้าจะแก้ยอดคงเหลือให้ตรงความจริง ใช้แท็บ "ตรวจนับ")
        </p>
        <input id="search" placeholder="ค้นหาสินค้าที่รับเข้า" value="${search}" />
        <div style="overflow-x:auto; margin-top:12px;">
          <table>
            <thead><tr><th>สินค้า</th><th>คงเหลือ</th><th>รับเข้า</th><th></th></tr></thead>
            <tbody>
              ${receiveList.map((p) => `
                <tr>
                  <td>${p.Name}<br/><span class="text-dim">${p.SKU}</span></td>
                  <td>${p.StockQty}</td>
                  <td style="min-width:100px;">
                    <input type="number" min="1" inputmode="numeric"
                           data-receive="${p.SKU}"
                           value="${receiving[p.SKU] !== undefined ? receiving[p.SKU] : ''}"
                           placeholder="จำนวน" />
                  </td>
                  <td>
                    <button data-add="${p.SKU}" ${savingSku === p.SKU ? 'disabled' : ''}>
                      ${savingSku === p.SKU ? '...' : 'รับเข้า'}
                    </button>
                  </td>
                </tr>`).join('') || '<tr><td colspan="4" class="text-dim">ไม่พบสินค้า</td></tr>'}
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

    container.querySelectorAll('[data-receive]').forEach((input) => {
      input.addEventListener('input', (e) => { receiving[input.dataset.receive] = e.target.value; });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); receive(input.dataset.receive); }
      });
    });
    container.querySelectorAll('[data-add]').forEach((btn) => {
      btn.addEventListener('click', () => receive(btn.dataset.add));
    });
  }

  draw();
  load();
}

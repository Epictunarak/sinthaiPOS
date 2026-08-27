import { api } from '../api.js';
import { cacheProducts, getCachedProducts } from '../db.js';
import { getSession } from '../session.js';

export function renderInventory(container) {
  const staff = getSession();
  let products = [];
  let search = '';
  let showLowStockOnly = false;
  let message = null;

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
        /* ใช้ cache ต่อไป */
      }
    }
  }

  function filtered() {
    let list = products;
    if (showLowStockOnly) {
      list = list.filter((p) => Number(p.StockQty) <= Number(p.ReorderPoint));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) => String(p.SKU).toLowerCase().includes(q) || String(p.Name).toLowerCase().includes(q)
      );
    }
    return list;
  }

  async function adjustStock(sku, delta) {
    const reason = delta > 0 ? 'restock' : 'adjustment';
    if (!navigator.onLine) {
      message = { type: 'error', text: 'ต้องออนไลน์เพื่อปรับสต็อก (ฟีเจอร์นี้ไม่รองรับออฟไลน์)' };
      draw();
      return;
    }
    try {
      const result = await api.adjustStock({ sku, changeQty: delta, reason, userId: staff?.userId || '' });
      if (result.ok) {
        const p = products.find((pr) => pr.SKU === sku);
        if (p) p.StockQty = result.stockQty;
        await cacheProducts(products);
        message = { type: 'success', text: `ปรับสต็อก ${sku} เป็น ${result.stockQty} แล้ว` };
      } else {
        message = { type: 'error', text: result.error };
      }
    } catch {
      message = { type: 'error', text: 'เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง' };
    }
    draw();
  }

  function draw() {
    const list = filtered();
    container.innerHTML = `
      ${message ? `<div class="msg ${message.type}">${message.text}</div>` : ''}
      <div class="card">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
          <input id="search" placeholder="ค้นหาสินค้า" value="${search}" style="flex:1; min-width:200px;" />
          <label style="display:flex; align-items:center; gap:6px; white-space:nowrap;">
            <input type="checkbox" id="lowStockOnly" ${showLowStockOnly ? 'checked' : ''} style="width:auto;" />
            เฉพาะใกล้หมด
          </label>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr><th>SKU</th><th>ชื่อสินค้า</th><th>คงเหลือ</th><th>จุดสั่งซื้อ</th><th>ปรับสต็อก</th></tr>
            </thead>
            <tbody>
              ${list
                .map((p) => {
                  const low = Number(p.StockQty) <= Number(p.ReorderPoint);
                  return `
                <tr class="${low ? 'low-stock' : ''}">
                  <td>${p.SKU}</td>
                  <td>${p.Name}</td>
                  <td>${p.StockQty} ${p.Unit || ''} ${low ? '<span class="badge warning">ใกล้หมด</span>' : ''}</td>
                  <td>${p.ReorderPoint}</td>
                  <td>
                    <button data-adjust-minus="${p.SKU}">-1</button>
                    <button data-adjust-plus="${p.SKU}">+1</button>
                  </td>
                </tr>`;
                })
                .join('') || '<tr><td colspan="5" class="text-dim">ไม่พบสินค้า</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <p class="text-dim">แก้ชื่อ/ราคา/เพิ่มสินค้าใหม่ ทำได้ในชีต Products โดยตรง (ดู docs/SHEET_SCHEMA.md)</p>
    `;

    container.querySelector('#search').addEventListener('input', (e) => {
      search = e.target.value;
      draw();
      const el = container.querySelector('#search');
      el.focus();
      el.setSelectionRange(search.length, search.length);
    });
    container.querySelector('#lowStockOnly').addEventListener('change', (e) => {
      showLowStockOnly = e.target.checked;
      draw();
    });
    container.querySelectorAll('[data-adjust-plus]').forEach((btn) => {
      btn.addEventListener('click', () => adjustStock(btn.dataset.adjustPlus, 1));
    });
    container.querySelectorAll('[data-adjust-minus]').forEach((btn) => {
      btn.addEventListener('click', () => adjustStock(btn.dataset.adjustMinus, -1));
    });
  }

  draw();
  load();
}

import { api } from '../api.js';
import { cacheProducts, getCachedProducts, queueSale } from '../db.js';
import { syncPendingSales } from '../sync.js';
import { getSession } from '../session.js';
import { receiptHtml, printReceipt } from '../receipt.js';

export function renderPos(container) {
  const staff = getSession();
  let products = [];
  let search = '';
  let cart = []; // [{sku, name, unitPrice, qty, stockQty}]
  let discount = 0;
  let paymentMethod = 'cash';
  let message = null; // { type, text }
  let checkingOut = false;
  let settings = {};
  let lastSale = null;   // เก็บบิลล่าสุดไว้ให้พิมพ์ซ้ำได้ เผื่อกระดาษติดหรือพิมพ์ไม่ติด

  async function loadProducts() {
    const cached = await getCachedProducts();
    if (cached.length) {
      products = cached;
      draw();
    }
    if (navigator.onLine) {
      try {
        const result = await api.getProducts();
        if (result.ok) {
          products = result.products;
          await cacheProducts(products);
          draw();
        }
      } catch {
        // ใช้ cache ต่อไปเฉยๆ ถ้าออนไลน์แต่เรียกไม่สำเร็จ
      }
    }
  }

  function filteredProducts() {
    if (!search) return products.slice(0, 60);
    const q = search.trim().toLowerCase();
    return products
      .filter(
        (p) =>
          String(p.SKU).toLowerCase().includes(q) ||
          String(p.Barcode).toLowerCase() === q ||
          String(p.Name).toLowerCase().includes(q)
      )
      .slice(0, 60);
  }

  function priceFor(product, qty) {
    if (product.WholesalePrice && product.WholesaleMinQty && qty >= Number(product.WholesaleMinQty)) {
      return Number(product.WholesalePrice);
    }
    return Number(product.RetailPrice);
  }

  function addToCart(product) {
    const existing = cart.find((c) => c.sku === product.SKU);
    const nextQty = (existing ? existing.qty : 0) + 1;
    if (nextQty > Number(product.StockQty)) {
      message = { type: 'error', text: `${product.Name} คงเหลือไม่พอ (เหลือ ${product.StockQty})` };
      draw();
      return;
    }
    if (existing) {
      existing.qty = nextQty;
      existing.unitPrice = priceFor(product, nextQty);
    } else {
      cart.push({ sku: product.SKU, name: product.Name, unitPrice: priceFor(product, 1), qty: 1, stockQty: Number(product.StockQty) });
    }
    draw();
  }

  function changeQty(sku, delta) {
    const item = cart.find((c) => c.sku === sku);
    if (!item) return;
    const product = products.find((p) => p.SKU === sku);
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      cart = cart.filter((c) => c.sku !== sku);
    } else if (product && newQty > Number(product.StockQty)) {
      message = { type: 'error', text: `คงเหลือไม่พอ (เหลือ ${product.StockQty})` };
    } else {
      item.qty = newQty;
      if (product) item.unitPrice = priceFor(product, newQty);
    }
    draw();
  }

  function subtotal() {
    return cart.reduce((sum, c) => sum + c.qty * c.unitPrice, 0);
  }

  async function handleSearchKey(e) {
    if (e.key !== 'Enter') return;
    const q = search.trim();
    if (!q) return;
    const exact = products.find((p) => String(p.Barcode) === q || String(p.SKU) === q);
    if (exact) {
      addToCart(exact);
      search = '';
    }
    draw();
  }

  async function checkout() {
    if (!cart.length || checkingOut) return;
    checkingOut = true;
    draw();

    const sale = {
      clientSaleId: crypto.randomUUID(),
      cashierId: staff?.userId || '',
      items: cart.map((c) => ({ sku: c.sku, productName: c.name, qty: c.qty, unitPrice: c.unitPrice })),
      discount: Number(discount) || 0,
      paymentMethod
    };

    try {
      if (!navigator.onLine) throw new Error('offline');
      const result = await api.createSale(sale);
      if (result.ok) {
        // อัปเดตสต็อกในแคชท้องถิ่นให้ตรงทันที (ไม่ต้องรอ fetch รอบหน้า)
        cart.forEach((c) => {
          const p = products.find((pr) => pr.SKU === c.sku);
          if (p) p.StockQty = Number(p.StockQty) - c.qty;
        });
        await cacheProducts(products);
        // อย่าพิมพ์เลขที่บิลถ้า server ไม่ได้ส่งกลับมา ไม่งั้นพนักงานจะเห็นคำว่า "undefined"
        const total = (sale.items.reduce((s, i) => s + i.qty * i.unitPrice, 0) - sale.discount).toFixed(2);
        const ref = result.saleId ? ` #${result.saleId}` : '';
        message = { type: 'success', text: `ขายสำเร็จ${ref} ยอดรวม ${total} บาท` };
        // เก็บสำเนาบิลไว้ (ไม่ใช่อ้างอิงตะกร้า เพราะตะกร้ากำลังจะถูกล้าง)
        lastSale = {
          sale: { ...sale, saleId: result.saleId, timestamp: new Date() },
          items: sale.items.map((item) => ({ ...item }))
        };
        cart = [];
        discount = 0;
      } else {
        message = { type: 'error', text: result.error || 'บันทึกการขายไม่สำเร็จ' };
      }
    } catch {
      await queueSale(sale);
      message = { type: 'info', text: 'ออฟไลน์อยู่ — บันทึกบิลไว้ในเครื่องแล้ว จะ sync อัตโนมัติเมื่อเน็ตกลับมา' };
      // ลูกค้าต้องได้บิลกลับไปแม้ร้านจะออฟไลน์อยู่ ใช้รหัสที่เครื่องสร้างเองไปก่อน
      // แล้วค่อยตรงกับเลขที่บิลจริงตอน sync
      lastSale = {
        sale: { ...sale, timestamp: new Date(), offline: true },
        items: sale.items.map((item) => ({ ...item }))
      };
      cart = [];
      discount = 0;
    } finally {
      checkingOut = false;
      draw();
    }
  }

  function draw() {
    const list = filteredProducts();
    container.innerHTML = `
      ${message ? `<div class="msg ${message.type}">${message.text}</div>` : ''}
      ${
        lastSale
          ? `<div class="card" id="receiptCard">
               <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                 <strong style="flex:1;">ใบเสร็จบิลล่าสุด</strong>
                 <button class="primary" id="printReceipt">พิมพ์ใบเสร็จ</button>
                 <button id="closeReceipt">ปิด</button>
               </div>
               <div class="receipt-preview">${receiptHtml({
                 sale: lastSale.sale,
                 items: lastSale.items,
                 settings,
                 staffName: staff?.name || ''
               })}</div>
             </div>`
          : ''
      }
      <div class="grid-2">
        <div>
          <input id="search" placeholder="ค้นหาชื่อ/SKU หรือยิงบาร์โค้ด แล้วกด Enter" value="${search}" />
          <div class="product-list" style="margin-top:12px;">
            ${list
              .map(
                (p) => `
              <button class="product-tile" data-sku="${p.SKU}">
                <span class="name">${p.Name}</span>
                <span class="price">${Number(p.RetailPrice).toFixed(2)} บาท</span>
                <div class="text-dim">คงเหลือ ${p.StockQty} ${p.Unit || ''} ${
                  Number(p.StockQty) <= Number(p.ReorderPoint) ? '<span class="stock-low">⚠ ใกล้หมด</span>' : ''
                }</div>
              </button>`
              )
              .join('') || '<p class="text-dim">ไม่พบสินค้า</p>'}
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">ตะกร้า</h3>
          ${
            cart.length
              ? cart
                  .map(
                    (c) => `
              <div class="cart-row">
                <span class="name">${c.name}<br/><span class="text-dim">${c.unitPrice.toFixed(2)} บาท/หน่วย</span></span>
                <div class="qty-controls">
                  <button data-qty-minus="${c.sku}">−</button>
                  <span>${c.qty}</span>
                  <button data-qty-plus="${c.sku}">+</button>
                </div>
              </div>`
                  )
                  .join('')
              : '<p class="text-dim">ยังไม่มีสินค้าในตะกร้า</p>'
          }
          <div style="margin-top:12px;">
            <label class="text-dim">ส่วนลด (บาท)</label>
            <input id="discount" type="number" min="0" value="${discount}" />
          </div>
          <div style="margin-top:12px;">
            <label class="text-dim">ช่องทางชำระเงิน</label>
            <select id="paymentMethod">
              <option value="cash" ${paymentMethod === 'cash' ? 'selected' : ''}>เงินสด</option>
              <option value="transfer" ${paymentMethod === 'transfer' ? 'selected' : ''}>โอน/พร้อมเพย์</option>
              <option value="other" ${paymentMethod === 'other' ? 'selected' : ''}>อื่นๆ</option>
            </select>
          </div>
          <div class="totals-row"><span>ยอดรวม</span><span>${subtotal().toFixed(2)}</span></div>
          <div class="totals-row"><span>ส่วนลด</span><span>-${Number(discount || 0).toFixed(2)}</span></div>
          <div class="totals-row grand"><span>สุทธิ</span><span>${(subtotal() - Number(discount || 0)).toFixed(2)}</span></div>
          <button class="primary" id="checkout" style="width:100%; margin-top:12px;" ${!cart.length || checkingOut ? 'disabled' : ''}>
            ${checkingOut ? 'กำลังบันทึก...' : 'ชำระเงิน / บันทึกการขาย'}
          </button>
        </div>
      </div>
    `;

    const searchInput = container.querySelector('#search');
    searchInput.addEventListener('input', (e) => {
      search = e.target.value;
      draw();
      container.querySelector('#search').focus();
      container.querySelector('#search').setSelectionRange(search.length, search.length);
    });
    searchInput.addEventListener('keydown', handleSearchKey);

    container.querySelectorAll('[data-sku]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = products.find((pr) => pr.SKU === btn.dataset.sku);
        if (p) addToCart(p);
      });
    });
    container.querySelectorAll('[data-qty-plus]').forEach((btn) => {
      btn.addEventListener('click', () => changeQty(btn.dataset.qtyPlus, 1));
    });
    container.querySelectorAll('[data-qty-minus]').forEach((btn) => {
      btn.addEventListener('click', () => changeQty(btn.dataset.qtyMinus, -1));
    });

    const discountInput = container.querySelector('#discount');
    if (discountInput) discountInput.addEventListener('input', (e) => { discount = e.target.value; });
    const paymentSelect = container.querySelector('#paymentMethod');
    if (paymentSelect) paymentSelect.addEventListener('change', (e) => { paymentMethod = e.target.value; });

    const checkoutBtn = container.querySelector('#checkout');
    if (checkoutBtn) checkoutBtn.addEventListener('click', checkout);

    const printBtn = container.querySelector('#printReceipt');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        printReceipt(receiptHtml({
          sale: lastSale.sale,
          items: lastSale.items,
          settings,
          staffName: staff?.name || ''
        }));
      });
    }
    const closeReceipt = container.querySelector('#closeReceipt');
    if (closeReceipt) {
      closeReceipt.addEventListener('click', () => { lastSale = null; draw(); });
    }
  }

  async function loadSettings() {
    if (!navigator.onLine) return;
    try {
      const result = await api.getSettings();
      if (result.ok) settings = result.settings || {};
    } catch {
      /* ไม่มีชื่อร้านก็ยังพิมพ์ใบเสร็จได้ ใช้ค่าเริ่มต้นแทน */
    }
  }

  draw();
  loadProducts();
  loadSettings();
  syncPendingSales(() => loadProducts());
}

import { api } from '../api.js';
import { cacheProducts, getCachedProducts } from '../db.js';
import { getSession } from '../session.js';
import { validateBarcode } from '../barcode.js';

/**
 * หน้าเก็บบาร์โค้ด — ใช้ตอนเดินสำรวจสินค้าในร้าน
 *
 * ขั้นตอนที่ออกแบบไว้ให้เร็วที่สุดสำหรับคนที่ถือมือถือข้างเดียว:
 *   1. เลือกสินค้าที่ยังไม่มีบาร์โค้ด (เรียงให้ตัวที่ยังขาดขึ้นก่อน)
 *   2. ยิงบาร์โค้ดด้วยเครื่องสแกน หรือกดเปิดกล้องมือถือ
 *   3. ระบบตรวจหลักตรวจสอบให้ทันที แล้วบันทึก
 *
 * เครื่องสแกน USB/บลูทูธจะทำตัวเหมือนคีย์บอร์ด คือพิมพ์ตัวเลขแล้วกด Enter
 * ช่องกรอกจึงโฟกัสค้างไว้ตลอดเพื่อรับค่าได้ทันทีโดยไม่ต้องแตะหน้าจอ
 */
export function renderBarcodes(container) {
  const staff = getSession();
  let products = [];
  let search = '';
  let selected = null;
  let input = '';
  let message = null;
  let saving = false;
  let scanning = false;
  let stopCamera = null;

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
        /* ใช้ข้อมูลที่แคชไว้ต่อ */
      }
    }
  }

  const hasBarcode = (p) => String(p.Barcode || '').trim() !== '';

  function visibleProducts() {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => !q || String(p.Name).toLowerCase().includes(q) ||
                     String(p.SKU).toLowerCase().includes(q))
      // ตัวที่ยังไม่มีบาร์โค้ดขึ้นก่อน เพราะเป็นงานที่เหลืออยู่
      .sort((a, b) => (hasBarcode(a) ? 1 : 0) - (hasBarcode(b) ? 1 : 0))
      .slice(0, 40);
  }

  async function save() {
    if (!selected || saving) return;
    const check = validateBarcode(input);
    if (!check.ok) {
      message = { type: 'error', text: check.reason };
      draw();
      return;
    }

    // กันยิงซ้ำกับสินค้าตัวอื่นตั้งแต่ในเครื่อง ก่อนวิ่งไปถาม server
    const clash = products.find(
      (p) => String(p.Barcode || '').trim() === check.normalized && p.SKU !== selected.SKU
    );
    if (clash) {
      message = { type: 'error', text: `บาร์โค้ดนี้เป็นของ ${clash.SKU} (${clash.Name}) แล้ว` };
      draw();
      return;
    }

    saving = true;
    draw();
    try {
      const result = await api.setBarcode({
        sku: selected.SKU,
        barcode: check.normalized,
        userId: staff?.userId || ''
      });
      if (result.ok) {
        const local = products.find((p) => p.SKU === selected.SKU);
        if (local) local.Barcode = check.normalized;
        await cacheProducts(products);
        message = { type: 'success', text: `บันทึกบาร์โค้ดของ ${selected.Name} แล้ว` };
        selected = null;
        input = '';
        stopScan();
      } else {
        message = { type: 'error', text: result.error };
      }
    } catch {
      // ตั้งใจไม่เก็บเข้าคิวออฟไลน์: บาร์โค้ดต้องเช็กว่าซ้ำกับสินค้าตัวอื่นหรือไม่
      // ซึ่งเช็กได้ที่ server เท่านั้น ถ้าเก็บไว้ส่งทีหลังอาจได้บาร์โค้ดชนกันหลายตัว
      message = { type: 'error', text: 'ต้องออนไลน์เพื่อบันทึกบาร์โค้ด (ต้องตรวจว่าซ้ำกับสินค้าอื่นไหม)' };
    } finally {
      saving = false;
      draw();
    }
  }

  function stopScan() {
    if (stopCamera) stopCamera();
    stopCamera = null;
    scanning = false;
  }

  /**
   * สแกนด้วยกล้องมือถือผ่าน BarcodeDetector API
   * รองรับบน Chrome/Android เป็นหลัก ส่วน iOS Safari ยังไม่รองรับ ณ ตอนที่เขียน
   * จึงเป็นแค่ทางลัดเสริม — ช่องพิมพ์/เครื่องยิงยังเป็นวิธีหลักที่ใช้ได้ทุกเครื่อง
   */
  async function startScan() {
    if (!('BarcodeDetector' in window)) {
      message = {
        type: 'info',
        text: 'เครื่องนี้ไม่รองรับสแกนด้วยกล้อง (iPhone ยังไม่รองรับ) — ใช้เครื่องยิงบาร์โค้ดหรือพิมพ์เองได้'
      };
      draw();
      return;
    }
    try {
      const detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      scanning = true;
      draw();

      const video = container.querySelector('#camera');
      video.srcObject = stream;
      await video.play();

      let active = true;
      stopCamera = () => {
        active = false;
        stream.getTracks().forEach((t) => t.stop());
      };

      const tick = async () => {
        if (!active) return;
        try {
          const found = await detector.detect(video);
          if (found.length) {
            input = found[0].rawValue;
            stopScan();
            draw();
            save();
            return;
          }
        } catch {
          /* ข้ามเฟรมที่อ่านไม่ได้ */
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      message = { type: 'error', text: 'เปิดกล้องไม่ได้ — ตรวจสอบการอนุญาตใช้กล้องในเบราว์เซอร์' };
      scanning = false;
      draw();
    }
  }

  function draw() {
    const list = visibleProducts();
    const missing = products.filter((p) => !hasBarcode(p)).length;
    const done = products.length - missing;
    const percent = products.length ? Math.round((done / products.length) * 100) : 0;

    container.innerHTML = `
      ${message ? `<div class="msg ${message.type}">${message.text}</div>` : ''}
      <div class="card">
        <strong>ความคืบหน้า:</strong> มีบาร์โค้ดแล้ว ${done} จาก ${products.length} รายการ (${percent}%)
        <div style="background:var(--surface-2); border-radius:999px; height:10px; margin-top:8px; overflow:hidden;">
          <div style="background:var(--brand); height:100%; width:${percent}%;"></div>
        </div>
        <p class="text-dim" style="margin-bottom:0;">เหลืออีก ${missing} รายการที่ยังยิงขายไม่ได้</p>
      </div>

      ${
        selected
          ? `
        <div class="card">
          <div class="text-dim">กำลังเก็บบาร์โค้ดของ</div>
          <h3 style="margin:4px 0 12px;">${selected.Name}</h3>
          <div class="text-dim" style="margin-bottom:12px;">${selected.SKU}</div>
          ${
            scanning
              ? `<video id="camera" playsinline muted
                    style="width:100%; border-radius:var(--radius); background:#000;"></video>
                 <button id="stopScan" style="width:100%; margin-top:8px;">หยุดสแกน</button>`
              : `
            <input id="code" inputmode="numeric" autocomplete="off"
                   placeholder="ยิงบาร์โค้ด หรือพิมพ์ตัวเลข แล้วกด Enter" value="${input}" />
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="primary" id="save" style="flex:1;" ${saving ? 'disabled' : ''}>
                ${saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button id="scan">เปิดกล้อง</button>
              <button id="cancel">ยกเลิก</button>
            </div>`
          }
        </div>`
          : ''
      }

      <div class="card">
        <input id="search" placeholder="ค้นหาสินค้าที่จะเก็บบาร์โค้ด" value="${search}" />
        <div style="overflow-x:auto; margin-top:12px;">
          <table>
            <thead><tr><th>สินค้า</th><th>บาร์โค้ด</th><th></th></tr></thead>
            <tbody>
              ${list
                .map(
                  (p) => `
                <tr>
                  <td>${p.Name}<br/><span class="text-dim">${p.SKU}</span></td>
                  <td>${
                    hasBarcode(p)
                      ? `<span class="badge ok">${p.Barcode}</span>`
                      : '<span class="badge warning">ยังไม่มี</span>'
                  }</td>
                  <td><button data-pick="${p.SKU}">${hasBarcode(p) ? 'แก้ไข' : 'เก็บ'}</button></td>
                </tr>`
                )
                .join('') || '<tr><td colspan="3" class="text-dim">ไม่พบสินค้า</td></tr>'}
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

    container.querySelectorAll('[data-pick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = products.find((p) => p.SKU === btn.dataset.pick);
        input = '';
        message = null;
        draw();
      });
    });

    const codeInput = container.querySelector('#code');
    if (codeInput) {
      codeInput.addEventListener('input', (e) => { input = e.target.value; });
      codeInput.addEventListener('keydown', (e) => {
        // เครื่องยิงบาร์โค้ดจบด้วย Enter เสมอ จึงบันทึกได้เลยโดยไม่ต้องแตะปุ่ม
        if (e.key === 'Enter') { e.preventDefault(); save(); }
      });
      codeInput.focus();
    }

    const saveBtn = container.querySelector('#save');
    if (saveBtn) saveBtn.addEventListener('click', save);
    const scanBtn = container.querySelector('#scan');
    if (scanBtn) scanBtn.addEventListener('click', startScan);
    const stopBtn = container.querySelector('#stopScan');
    if (stopBtn) stopBtn.addEventListener('click', () => { stopScan(); draw(); });
    const cancelBtn = container.querySelector('#cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        selected = null;
        input = '';
        stopScan();
        draw();
      });
    }
  }

  draw();
  load();

  // ปิดกล้องเมื่อออกจากหน้านี้ ไม่งั้นไฟกล้องค้างและกินแบตต่อ
  window.addEventListener('hashchange', stopScan, { once: true });
}

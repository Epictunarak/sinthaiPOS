import { api } from '../api.js';
import { setSession } from '../session.js';

export function renderLogin(container, navigate) {
  let pin = '';
  let error = '';
  let loading = false;

  function draw() {
    container.innerHTML = `
      <div class="center-screen">
        <div class="card" style="width: 100%; max-width: 340px;">
          <h2 style="text-align:center; margin-top:0;">sinthaiPOS</h2>
          <p class="text-dim" style="text-align:center;">กรอกรหัส PIN พนักงานเพื่อเข้าสู่ระบบ</p>
          ${error ? `<div class="msg error">${error}</div>` : ''}
          <div class="pin-display">${'•'.repeat(pin.length) || '&nbsp;'}</div>
          <div class="pin-pad">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-digit="${n}">${n}</button>`).join('')}
            <button data-action="clear">ลบ</button>
            <button data-digit="0">0</button>
            <button data-action="submit" class="primary">เข้า</button>
          </div>
          ${loading ? '<p class="text-dim" style="text-align:center;">กำลังตรวจสอบ...</p>' : ''}
        </div>
      </div>
    `;

    container.querySelectorAll('[data-digit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (pin.length < 6) pin += btn.dataset.digit;
        draw();
      });
    });
    container.querySelector('[data-action="clear"]').addEventListener('click', () => {
      pin = pin.slice(0, -1);
      draw();
    });
    container.querySelector('[data-action="submit"]').addEventListener('click', submit);
  }

  async function submit() {
    if (!pin) return;
    loading = true;
    error = '';
    draw();
    try {
      const result = await api.login(pin);
      if (result.ok) {
        setSession(result.staff);
        navigate('#/pos');
      } else {
        error = result.error || 'เข้าสู่ระบบไม่สำเร็จ';
        pin = '';
      }
    } catch (err) {
      error = 'เชื่อมต่อ Apps Script ไม่ได้ — ตรวจสอบอินเทอร์เน็ต/การตั้งค่า API';
    } finally {
      loading = false;
      draw();
    }
  }

  draw();
}

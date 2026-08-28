/**
 * smoke.mjs — ขับแอปจริงในเบราว์เซอร์แล้วตรวจว่า flow ที่เกี่ยวกับเงินยังทำงานถูก
 *
 * ทำไมต้องมีนอกเหนือจาก unit test: บั๊กที่เจอจริงตอนพัฒนาคือปุ่ม "บันทึก" ในหน้าตรวจนับ
 * หลุดออกนอกจอมือถือ และป้ายสถานะตัดบรรทัดจนผิดรูป — ทั้งสองอย่าง unit test จับไม่ได้เลย
 * เพราะโค้ดทำงานถูกทุกอย่าง แต่คนใช้กดไม่ถึง
 *
 * วิธีรัน (ต้องเปิดสามอย่างนี้ก่อน):
 *   1. node tests/e2e/mock-api.mjs
 *   2. cd web && VITE_API_BASE_URL=http://localhost:5599/ VITE_API_TOKEN=test npm run build
 *      && npx vite preview --port 4173
 *   3. node tests/e2e/smoke.mjs
 *
 * ต้องมี Chrome/Chromium ในเครื่อง ถ้าไม่ได้อยู่ที่ตำแหน่งมาตรฐาน ให้ระบุเอง:
 *   CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node tests/e2e/smoke.mjs
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.APP_URL || 'http://localhost:4173/sinthaiPOS/';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});

if (!executablePath) {
  console.error('ไม่พบ Chrome/Chromium — ระบุตำแหน่งด้วย CHROME_PATH=...');
  process.exit(2);
}

let chromium;
try {
  const require = createRequire(import.meta.url);
  ({ chromium } = require('playwright-core'));
} catch {
  console.error('ต้องติดตั้งก่อน: npm install --no-save playwright-core');
  process.exit(2);
}

let failures = 0;
const check = (label, passed) => {
  console.log(`${passed ? '  ✓' : '  ✗'} ${label}`);
  if (!passed) failures++;
};

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },   // ขนาดจอ iPhone 14 — เล็กสุดที่ต้องใช้งานได้
  isMobile: true,
  hasTouch: true
});
const page = await context.newPage();
// ยืนยัน confirm() อัตโนมัติ — การยกเลิกบิลถามยืนยันก่อนเสมอ
page.on('dialog', (dialog) => dialog.accept());

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const text = async (selector) => {
  try { return await page.locator(selector).first().innerText(); } catch { return ''; }
};

await page.goto(BASE);
await page.evaluate(() => localStorage.setItem(
  'sinthaipos_staff',
  JSON.stringify({ userId: 'U1', name: 'เจ้าของร้าน', role: 'owner' })
));

// ---------------------------------------------------------------------------
console.log('\nทุกหน้าต้องไม่ล้นขอบจอมือถือ');
for (const route of ['pos', 'inventory', 'barcodes', 'stocktake', 'reports']) {
  await page.goto(`${BASE}#/${route}`);
  await page.waitForTimeout(1200);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(`${route} อยู่ในความกว้างจอ`, fits);
}

// ---------------------------------------------------------------------------
console.log('\nเก็บบาร์โค้ด');
await page.goto(`${BASE}#/barcodes`);
await page.waitForTimeout(1300);
await page.locator('[data-pick]').first().click();
await page.waitForTimeout(300);

await page.fill('#code', '8851959142012');           // หลักตรวจสอบผิด
await page.click('#save');
await page.waitForTimeout(500);
check('ปฏิเสธบาร์โค้ดที่หลักตรวจสอบไม่ตรง', /หลักตรวจสอบ/.test(await text('.msg')));

await page.fill('#code', '8851959142011');           // เป็นของสินค้าอื่นอยู่แล้ว
await page.click('#save');
await page.waitForTimeout(500);
check('ปฏิเสธบาร์โค้ดที่ซ้ำกับสินค้าอื่น', /เป็นของ/.test(await text('.msg')));

await page.click('#internal');
await page.waitForTimeout(300);
const internal = await page.inputValue('#code');
check(`ออกรหัสภายในขึ้นต้นด้วย 2 (${internal})`, /^2\d{12}$/.test(internal));

await page.click('#save');
await page.waitForTimeout(800);
check('บันทึกบาร์โค้ดสำเร็จ', /บันทึกบาร์โค้ด/.test(await text('.msg')));
check('แถบความคืบหน้าเพิ่มขึ้น', /3 จาก 141/.test(await text('.card')));

// ---------------------------------------------------------------------------
console.log('\nตรวจนับสต็อก');
await page.goto(`${BASE}#/stocktake`);
await page.waitForTimeout(1300);

const saveButton = page.locator('[data-save]').first();
const reachable = await saveButton.evaluate(
  (el) => el.getBoundingClientRect().right <= window.innerWidth
);
check('ปุ่มบันทึกอยู่ในจอ (กดถึงจริง)', reachable);

await page.locator('[data-count]').first().fill('18');
await saveButton.click();
await page.waitForTimeout(800);
check('คำนวณส่วนต่างจากยอดเดิมถูกต้อง (24 → 18 = -6)', /-6/.test(await text('.msg')));

await page.locator('[data-count]').nth(1).fill('-5');
await page.locator('[data-save]').nth(1).click();
await page.waitForTimeout(600);
check('ปฏิเสธจำนวนติดลบ', /ตั้งแต่ 0/.test(await text('.msg')));

// ---------------------------------------------------------------------------
console.log('\nขายของ');
await page.goto(`${BASE}#/pos`);
await page.waitForTimeout(1300);
await page.locator('[data-sku]').first().click();
await page.waitForTimeout(400);
check('เพิ่มสินค้าเข้าตะกร้าได้', (await page.locator('.cart-row').count()) >= 1);

await page.fill('#discount', '25');
await page.fill('#customerName', 'ร้านป้าสมศรี');
await page.waitForTimeout(200);
await page.click('#checkout');
await page.waitForTimeout(1000);
const saleMessage = await text('.msg');
check('บันทึกการขายสำเร็จ', /ขายสำเร็จ/.test(saleMessage));
check('ไม่แสดงคำว่า undefined ให้พนักงานเห็น', !/undefined/.test(saleMessage));
check('ล้างตะกร้าหลังขายเสร็จ', (await page.locator('.cart-row').count()) === 0);

console.log('\nใบเสร็จ');
check('แสดงใบเสร็จหลังขายเสร็จ', (await page.locator('.receipt-preview').count()) > 0);
const receipt = await text('.receipt-preview');
check('ใบเสร็จมีชื่อร้านจากชีต Settings', /สินไทยพาณิชย์/.test(receipt));
check('ใบเสร็จลงวันที่เป็นพุทธศักราช', /25\d\d/.test(receipt));
check('ใบเสร็จหักส่วนลดถูกต้อง', /-25\.00/.test(receipt));
check('ใบเสร็จมีรายการสินค้าที่ขาย', /×/.test(receipt));
check('ใบเสร็จมีชื่อลูกค้าขายส่ง', /ร้านป้าสมศรี/.test(receipt));
check('ล้างชื่อลูกค้าหลังปิดบิล ไม่ติดไปบิลถัดไป',
      (await page.inputValue('#customerName')) === '');

console.log('\nยกเลิกบิล');
check('มีปุ่มยกเลิกบิลบนใบเสร็จ', (await page.locator('#voidSale').count()) > 0);
await page.click('#voidSale');
await page.waitForTimeout(1200);
check('ยกเลิกแล้วคืนสินค้าเข้าสต็อก', /ยกเลิกบิล .* แล้ว/.test(await text('.msg')));
check('ปุ่มยกเลิกหายไปหลังยกเลิกแล้ว', (await page.locator('#voidSale').count()) === 0);

// ---------------------------------------------------------------------------
console.log('\nรายงาน');
await page.goto(`${BASE}#/reports`);
await page.waitForTimeout(1400);
const reportText = await text('main');
check('เตือนเมื่อมีสินค้าขายต่ำกว่าทุน', /ขายสินค้าต่ำกว่าทุน/.test(reportText));
check('แสดงกำไรขั้นต้น ไม่ใช่แค่ยอดขาย', /กำไรขั้นต้น/.test(reportText));
check('บอกตรงๆ ว่ากำไรครอบคลุมยอดขายกี่เปอร์เซ็นต์', /% ของยอดขาย/.test(reportText));
check('มีตารางสินค้าขายดี', /ขายดีที่สุด/.test(reportText));
check('สินค้าที่ยังไม่รู้ต้นทุนไม่ถูกนับกำไรเป็นศูนย์', /ยังไม่รู้ทุน/.test(reportText));
check('รายงานแสดงรายการบิลของวันนั้น', (await page.locator('[data-void]').count()) >= 2);

await page.locator('[data-void]').nth(1).click();
await page.waitForTimeout(1300);
const voidButtons = await page.locator('[data-void]:not([disabled])').count();
check('ยกเลิกจากรายงานแล้วปุ่มไม่ค้างเป็น disabled', voidButtons >= 1);

await page.locator('[data-void]').nth(1).click();
await page.waitForTimeout(1200);
check('ปฏิเสธการยกเลิกบิลเดิมซ้ำ', /ถูกยกเลิกไปแล้ว/.test(await text('.msg.error')));

// ---------------------------------------------------------------------------
// เส้นทางที่พังแล้วเสียหายหนักที่สุด: ขายตอนเน็ตหลุดแล้วบิลหายไปเลย
console.log('\nขายตอนเน็ตหลุดแล้ว sync กลับ');
const pendingSales = () => page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('sinthaipos', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const query = db.transaction('pendingSales', 'readonly').objectStore('pendingSales').getAll();
    query.onsuccess = () => resolve(query.result);
    query.onerror = () => reject(query.error);
  });
});

await page.goto(`${BASE}#/pos`);
await page.waitForTimeout(1400);          // โหลดสินค้าเข้าแคชตอนยังออนไลน์

await context.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.waitForTimeout(300);

await page.locator('[data-sku]').first().click();
await page.waitForTimeout(300);
await page.click('#checkout');
await page.waitForTimeout(1200);
check('ยังขายได้ตอนเน็ตหลุด', /ออฟไลน์/.test(await text('.msg')));
check('ลูกค้ายังได้ใบเสร็จตอนเน็ตหลุด', (await page.locator('.receipt-preview').count()) > 0);
check('บิลถูกเก็บเข้าคิวในเครื่อง', (await pendingSales()).length === 1);

const postedActions = [];
page.on('request', (r) => {
  if (r.method() !== 'POST') return;
  try { postedActions.push(JSON.parse(r.postData() || '{}').action); } catch { /* ข้าม */ }
});

await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(2500);
check('เน็ตกลับมาแล้วคิวถูกส่งจนหมด', (await pendingSales()).length === 0);
check('ส่งบิลที่ค้างขึ้น server จริง', postedActions.includes('createSale'));

// ---------------------------------------------------------------------------
check('ไม่มี JavaScript error ระหว่างทดสอบ', pageErrors.length === 0);
if (pageErrors.length) console.log('   ', pageErrors.join(' | '));

await browser.close();
console.log(failures ? `\nไม่ผ่าน ${failures} ข้อ` : '\nผ่านทั้งหมด');
process.exit(failures ? 1 : 0);

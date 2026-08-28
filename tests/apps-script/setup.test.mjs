/**
 * เทสต์ขั้นตอนติดตั้ง — ส่วนที่พังแล้วทำให้ระบบใช้งานไม่ได้ตั้งแต่ก้าวแรก
 * รันด้วย: node --test tests/apps-script/
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './harness.mjs';

// array ที่สร้างขึ้นใน vm context เป็นคนละ realm กับตัวรันเทสต์ ทำให้ deepEqual
// มองว่าคนละชนิดทั้งที่ค่าเหมือนกันทุกตัว จึงต้องแปลงให้เป็น array ธรรมดาก่อนเทียบ
const plain = (value) => JSON.parse(JSON.stringify(value));

const FILES = ['Utils.gs', 'Setup.gs'];
const GOOD_TOKEN = 'a'.repeat(32);

const PRODUCT_HEADERS = ['SKU', 'Barcode', 'Name', 'Category', 'Unit', 'Cost', 'RetailPrice',
  'WholesalePrice', 'WholesaleMinQty', 'StockQty', 'ReorderPoint', 'Active'];

function fullyConfigured(overrides = {}) {
  return loadAppsScript(FILES, {
    scriptProperties: { API_TOKEN: GOOD_TOKEN },
    sheets: {
      Products: [PRODUCT_HEADERS,
        ['SKU0001', '8851959142011', 'Coke ลัง 24', 'Beverage', 'แพ็ค', 348, 325, '', 5, 12, 3, true]],
      Sales: [['SaleID', 'ClientSaleId', 'Timestamp', 'CashierId', 'CustomerName',
               'Subtotal', 'Discount', 'Total', 'PaymentMethod', 'Status']],
      SaleItems: [['SaleID', 'SKU', 'ProductName', 'Qty', 'UnitPrice', 'LineTotal']],
      StockMovements: [['Timestamp', 'SKU', 'ChangeQty', 'Reason', 'RefSaleID', 'UserId']],
      Staff: [['UserId', 'Name', 'PinHash', 'Role', 'Active'],
              ['U1', 'เจ้าของร้าน', 'f'.repeat(64), 'owner', true]],
      Settings: [['Key', 'Value'], ['ShopName', 'สินไทยพาณิชย์']],
      BarcodeCaptures: [['Timestamp', 'SKU', 'Barcode', 'PreviousBarcode', 'UserId']],
      ...overrides
    }
  });
}

test('setupSheets สร้างชีตที่จำเป็นครบทุกชีตจากไฟล์เปล่า', () => {
  const ctx = loadAppsScript(FILES, { sheets: {} });
  ctx.setupSheets();

  for (const name of Object.keys(ctx.REQUIRED_SHEETS)) {
    const sheet = ctx.spreadsheet.getSheetByName(name);
    assert.ok(sheet, `ควรสร้างชีต ${name}`);
    assert.deepEqual(plain(sheet.rows[0]), plain(ctx.REQUIRED_SHEETS[name]),
      `หัวคอลัมน์ของ ${name} ต้องตรงกับที่โค้ดใช้อ่าน`);
  }
});

test('setupSheets รันซ้ำแล้วไม่สร้างชีตซ้ำและไม่ลบข้อมูล', () => {
  const ctx = loadAppsScript(FILES, { sheets: {} });
  ctx.setupSheets();
  ctx.spreadsheet.getSheetByName('Products').appendRow(['SKU0001', '', 'ของทดสอบ']);

  ctx.setupSheets();

  const products = ctx.spreadsheet.getSheetByName('Products');
  assert.equal(products.rows.length, 2, 'ข้อมูลเดิมต้องยังอยู่');
  assert.equal(products.rows[1][0], 'SKU0001');
  assert.equal(ctx.spreadsheet.sheets.size, Object.keys(ctx.REQUIRED_SHEETS).length);
});

test('setupSheets เติมเฉพาะคอลัมน์ที่ขาด โดยไม่ย้ายตำแหน่งคอลัมน์เดิม', () => {
  // ผู้ใช้อาจมีสูตรหรือ filter ที่อ้างตำแหน่งคอลัมน์อยู่ ห้ามสลับที่ของเดิม
  const ctx = loadAppsScript(FILES, {
    sheets: { Products: [['SKU', 'Name'], ['SKU0001', 'ของเดิม']] }
  });
  ctx.setupSheets();

  const headers = ctx.spreadsheet.getSheetByName('Products').rows[0];
  assert.equal(headers[0], 'SKU', 'คอลัมน์เดิมต้องอยู่ตำแหน่งเดิม');
  assert.equal(headers[1], 'Name');
  assert.ok(headers.includes('Barcode'), 'ต้องเติมคอลัมน์ที่ขาด');
  assert.ok(headers.includes('StockQty'));
  assert.equal(ctx.spreadsheet.getSheetByName('Products').rows[1][0], 'SKU0001');
});

test('setupSheets บังคับคอลัมน์บาร์โค้ดเป็นข้อความ กันเลข 0 นำหน้าหาย', () => {
  const ctx = loadAppsScript(FILES, { sheets: {} });
  ctx.setupSheets();
  const formats = Object.values(ctx.spreadsheet.getSheetByName('Products').numberFormats);
  assert.ok(formats.includes('@'), 'คอลัมน์ Barcode ต้องถูกตั้งเป็นรูปแบบข้อความ');
});

test('checkSetup บอกว่าพร้อมใช้งานเมื่อทุกอย่างครบ', () => {
  const report = fullyConfigured().checkSetup();
  assert.match(report, /พร้อมใช้งาน/);
  // ต้องตรวจให้เจาะจง เพราะข้อความ "ไม่พบปัญหา" มีคำว่า "พบปัญหา" อยู่ข้างใน
  assert.ok(!/พบปัญหา \d+ ข้อ/.test(report), report);
});

test('checkSetup เตือนเมื่อยังไม่ได้ตั้ง API_TOKEN', () => {
  const ctx = loadAppsScript(FILES, { sheets: {} });
  ctx.setupSheets();
  assert.match(ctx.checkSetup(), /ยังไม่ได้ตั้ง API_TOKEN/);
});

test('checkSetup เตือนเมื่อ API_TOKEN สั้นเกินไป', () => {
  const ctx = loadAppsScript(FILES, {
    sheets: {}, scriptProperties: { API_TOKEN: 'sinthai' }
  });
  ctx.setupSheets();
  assert.match(ctx.checkSetup(), /API_TOKEN สั้นเกินไป/);
});

test('checkSetup เตือนเมื่อยังไม่มีชีต', () => {
  const report = loadAppsScript(FILES, { sheets: {} }).checkSetup();
  assert.match(report, /ไม่มีชีต "Products"/);
  assert.match(report, /ไม่มีชีต "Staff"/);
});

test('checkSetup เตือนเมื่อหัวคอลัมน์ขาด', () => {
  const ctx = fullyConfigured({ Products: [['SKU', 'Name'], ['SKU0001', 'ของเดิม']] });
  assert.match(ctx.checkSetup(), /ขาดคอลัมน์.*Barcode/);
});

test('checkSetup เตือนเมื่อยังไม่มีพนักงานที่ล็อกอินได้', () => {
  const ctx = fullyConfigured({ Staff: [['UserId', 'Name', 'PinHash', 'Role', 'Active']] });
  assert.match(ctx.checkSetup(), /ยังไม่มีพนักงานที่ใช้งานได้/);
});

test('checkSetup จับกรณีเก็บ PIN เป็นตัวเลขตรงๆ แทนที่จะ hash', () => {
  // เป็นความผิดพลาดที่เกิดง่ายมาก และทำให้รหัสพนักงานรั่วทั้งร้าน
  const ctx = fullyConfigured({
    Staff: [['UserId', 'Name', 'PinHash', 'Role', 'Active'],
            ['U1', 'พนักงาน', '1234', 'cashier', true]]
  });
  assert.match(ctx.checkSetup(), /PinHash ที่สั้นผิดปกติ/);
});

test('checkSetup จับบาร์โค้ดซ้ำ ซึ่งทำให้ยิงขายได้สินค้าผิดตัว', () => {
  const ctx = fullyConfigured({
    Products: [PRODUCT_HEADERS,
      ['SKU0001', '8851959142011', 'ก', 'B', 'แพ็ค', 1, 2, '', 5, 10, 3, true],
      ['SKU0002', '8851959142011', 'ข', 'B', 'แพ็ค', 1, 2, '', 5, 10, 3, true]]
  });
  const report = ctx.checkSetup();
  assert.match(report, /บาร์โค้ดซ้ำกัน/);
  assert.match(report, /SKU0001 และ SKU0002/);
});

test('checkSetup รายงานจำนวนสินค้าที่ยังไม่มีบาร์โค้ดและยังไม่มีสต็อก', () => {
  const ctx = fullyConfigured({
    Products: [PRODUCT_HEADERS,
      ['SKU0001', '8851959142011', 'มีบาร์โค้ด', 'B', 'แพ็ค', 1, 2, '', 5, 10, 3, true],
      ['SKU0002', '', 'ไม่มีบาร์โค้ด', 'B', 'แพ็ค', 1, 2, '', 5, 0, 3, true]]
  });
  const report = ctx.checkSetup();
  assert.match(report, /สินค้า 2 รายการ/);
  assert.match(report, /มีบาร์โค้ด 1 รายการ/);
  assert.match(report, /มียอดคงเหลือมากกว่า 0 อยู่ 1 รายการ/);
});

test('makePinHash คืนค่า SHA-256 ยาว 64 ตัวอักษร ตรงกับที่ล็อกอินใช้เทียบ', () => {
  const ctx = fullyConfigured();
  const hash = ctx.makePinHash();
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]+$/);
  // ต้องตรงกับค่าที่ hashPin_ คำนวณให้ PIN เดียวกัน
  assert.equal(hash, ctx.hashPin_('1234'));
});

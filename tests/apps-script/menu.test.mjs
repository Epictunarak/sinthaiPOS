/**
 * เทสต์เมนูในตัว Google Sheet — เครื่องมือที่เจ้าของร้านใช้เอง
 *
 * ทำไมสำคัญ: คนใช้เมนูนี้คือคนที่ไม่ได้เขียนโปรแกรม ถ้ารายงานบอกผิดหรือจัดลำดับผิด
 * เขาจะไม่มีทางรู้ว่าผิด แล้วจะไปแก้ราคาหรือสั่งของตามตัวเลขที่ผิด
 *
 * รันด้วย: node --test "tests/apps-script/*.test.mjs"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './harness.mjs';

const FILES = ['Utils.gs', 'Barcodes.gs', 'Setup.gs', 'Menu.gs'];

const PRODUCT_HEADERS = ['SKU', 'Barcode', 'Name', 'Category', 'Unit', 'Cost', 'RetailPrice',
  'WholesalePrice', 'WholesaleMinQty', 'StockQty', 'ReorderPoint', 'Active'];

/** ร้านที่ข้อมูลครบถ้วนสมบูรณ์ ใช้เป็นฐานแล้วค่อยใส่ความผิดพลาดเข้าไปทีละอย่าง */
function shop(productRows) {
  return loadAppsScript(FILES, {
    scriptProperties: { API_TOKEN: 'a'.repeat(32) },
    sheets: {
      Products: [PRODUCT_HEADERS].concat(productRows || [
        ['SKU0003', '8851959142011', 'SINGHA น้ำดื่ม', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true]
      ]),
      Sales: [['SaleID', 'ClientSaleId', 'Timestamp', 'CashierId', 'CustomerName',
               'Subtotal', 'Discount', 'Total', 'PaymentMethod', 'Status']],
      SaleItems: [['SaleID', 'SKU', 'ProductName', 'Qty', 'UnitPrice', 'LineTotal']],
      StockMovements: [['Timestamp', 'SKU', 'ChangeQty', 'Reason', 'RefSaleID', 'UserId']],
      Staff: [['UserId', 'Name', 'PinHash', 'Role', 'Active'],
              ['U1', 'เจ้าของร้าน', 'f'.repeat(64), 'owner', true]],
      Settings: [['Key', 'Value'], ['ShopName', 'สินไทยพาณิชย์']],
      BarcodeCaptures: [['Timestamp', 'SKU', 'Barcode', 'PreviousBarcode', 'UserId']],
      ActivityLogs: [['Timestamp', 'UserId', 'Action', 'Details']]
    }
  });
}

const problemsFor = (ctx, sku) =>
  ctx.findCatalogIssues_(ctx.sheetToObjects_(ctx.getSheet_('Products')))
    .filter((i) => i.sku === sku)
    .map((i) => i.problem);

// ---------------------------------------------------------------------------
test('เมนูโผล่ตอนเปิดชีต พร้อมทุกคำสั่งที่เจ้าของร้านต้องใช้', () => {
  const ctx = shop();
  ctx.onOpen();

  assert.equal(ctx.menus.length, 1);
  const captions = ctx.menus[0].items.filter((i) => !i.separator).map((i) => i.caption);
  assert.equal(captions.length, 3, 'เมนูเยอะเกินไปจะทำให้คนไม่กล้ากด');

  // ทุกคำสั่งในเมนูต้องชี้ไปยังฟังก์ชันที่มีอยู่จริง ไม่งั้นกดแล้ว error
  ctx.menus[0].items.filter((i) => !i.separator).forEach((item) => {
    assert.equal(typeof ctx[item.fn], 'function', `เมนู "${item.caption}" ชี้ไปที่ ${item.fn} ซึ่งไม่มีอยู่จริง`);
  });
});

test('ข้อมูลครบถ้วนต้องไม่ขึ้นปัญหาอะไรเลย', () => {
  const ctx = shop();
  const issues = ctx.findCatalogIssues_(ctx.sheetToObjects_(ctx.getSheet_('Products')));
  assert.equal(issues.length, 0, `ไม่ควรมีปัญหา แต่เจอ: ${JSON.stringify(issues)}`);
});

// ---------------------------------------------------------------------------
test('จับสินค้าที่ขายต่ำกว่าทุน พร้อมบอกราคาที่ควรขาย', () => {
  // เคสจริงของร้าน: ยูโร่ทุน 51 ขาย 50 — ยิ่งขายยิ่งเสียเงิน
  const ctx = shop([['SKU0016', '8850718801015', 'ยูโร่', 'Snack', 'แพ็ค', 51, 50, 53, 5, 20, 3, true]]);
  const issues = ctx.findCatalogIssues_(ctx.sheetToObjects_(ctx.getSheet_('Products')));
  const loss = issues.filter((i) => i.level === 'เสียเงิน');

  assert.equal(loss.length, 1);
  assert.match(loss[0].problem, /ขาดทุนตัวละ 1/);
  assert.match(loss[0].fix, /58/, 'ต้องบอกราคาที่ควรขายเป็นตัวเลข ไม่ใช่แค่บอกว่าขาดทุน');
});

test('เรื่องที่ทำให้เสียเงินต้องอยู่บนสุดของรายงาน', () => {
  // เจ้าของร้านมีเวลาจำกัด ถ้าเรื่องเสียเงินไปอยู่แถวที่ 80 จะไม่มีวันได้เห็น
  const ctx = shop([
    ['SKU0001', '', 'ไม่มีบาร์โค้ด', 'Snack', 'ชิ้น', 10, 20, '', 5, 5, 3, true],
    ['SKU0016', '8850718801015', 'ขายขาดทุน', 'Snack', 'แพ็ค', 51, 50, 53, 5, 20, 3, true]
  ]);
  const issues = ctx.findCatalogIssues_(ctx.sheetToObjects_(ctx.getSheet_('Products')));
  assert.equal(issues[0].level, 'เสียเงิน');
});

test('จับสินค้าที่ไม่มีราคาขาย ซึ่งคิดเงินไม่ได้เลย', () => {
  const ctx = shop([['SKU0071', '8850718801015', 'ยาดม', 'Medicine', 'ชิ้น', 10, '', '', 5, 5, 3, true]]);
  assert.ok(problemsFor(ctx, 'SKU0071').some((p) => /ไม่มีราคาขาย/.test(p)));
});

test('จับสต็อกเป็น 0 ซึ่งระบบจะไม่ยอมให้ขาย', () => {
  const ctx = shop([['SKU0003', '8851959142011', 'SINGHA', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 0, 3, true]]);
  assert.ok(problemsFor(ctx, 'SKU0003').some((p) => /สต็อกเป็น 0/.test(p)));
});

test('จับบาร์โค้ดซ้ำ ซึ่งทำให้ยิงขายได้สินค้าผิดตัว', () => {
  const ctx = shop([
    ['SKU0003', '8851959142011', 'SINGHA', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true],
    ['SKU0004', '8851959142011', 'อีกตัว', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true]
  ]);
  assert.ok(problemsFor(ctx, 'SKU0004').some((p) => /บาร์โค้ดซ้ำกับ SKU0003/.test(p)));
});

test('จับบาร์โค้ดที่หลักตรวจสอบผิด แม้จะถูกพิมพ์ใส่ชีตมาโดยตรง', () => {
  // ทางแอปตรวจให้อยู่แล้ว แต่คนพิมพ์ใส่ชีตเองได้ ต้องจับให้ได้ทั้งสองทาง
  const ctx = shop([['SKU0003', '8851959142019', 'SINGHA', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true]]);
  assert.ok(problemsFor(ctx, 'SKU0003').some((p) => /บาร์โค้ดไม่ถูกต้อง/.test(p)));
});

test('จับรหัส SKU ซ้ำ ซึ่งทำให้ตัดสต็อกผิดตัว', () => {
  const ctx = shop([
    ['SKU0003', '8851959142011', 'ตัวแรก', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true],
    ['SKU0003', '8850718801015', 'ตัวซ้ำ', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true]
  ]);
  assert.ok(problemsFor(ctx, 'SKU0003').some((p) => /SKU ซ้ำ/.test(p)));
});

// ---------------------------------------------------------------------------
test('เขียนผลตรวจลงแผ่นแยกให้พิมพ์พกไปแก้หน้าร้านได้', () => {
  const ctx = shop([['SKU0016', '8850718801015', 'ยูโร่', 'Snack', 'แพ็ค', 51, 50, 53, 5, 20, 3, true]]);
  ctx.validateCatalog();

  const sheet = ctx.spreadsheet.getSheetByName('ตรวจสอบข้อมูล');
  assert.ok(sheet, 'ต้องสร้างแผ่นรายงานให้');
  assert.deepEqual(JSON.parse(JSON.stringify(sheet.rows[0])),
    ['ระดับ', 'SKU', 'ชื่อสินค้า', 'ปัญหา', 'ควรทำอย่างไร']);
  assert.equal(sheet.rows[1][0], 'เสียเงิน');
});

test('รันซ้ำต้องล้างปัญหาที่แก้ไปแล้วออก ไม่ใช่ต่อท้ายเรื่อยๆ', () => {
  // ตั้งใจให้มี 2 ปัญหา (ขาดทุน + ไม่มีบาร์โค้ด) แล้วแก้แค่อันเดียว
  // ถ้าใช้ตัวที่มีปัญหาเดียว พอแก้แล้วจะเหลือแถว "ไม่พบปัญหา" ทำให้จำนวนแถวเท่าเดิม
  const ctx = shop([['SKU0016', '', 'ยูโร่', 'Snack', 'แพ็ค', 51, 50, 53, 5, 20, 3, true]]);
  ctx.validateCatalog();
  const firstRun = ctx.spreadsheet.getSheetByName('ตรวจสอบข้อมูล').rows.length;

  // แก้ราคาให้ถูกต้องแล้วตรวจใหม่ — ปัญหาเดิมต้องหายไป ไม่ใช่ค้างอยู่จนเข้าใจผิด
  ctx.getSheet_('Products').getRange(2, 7).setValue(60);
  ctx.validateCatalog();

  const rows = ctx.spreadsheet.getSheetByName('ตรวจสอบข้อมูล').rows;
  assert.ok(rows.length < firstRun, 'แถวต้องลดลงหลังแก้ปัญหาแล้ว');
  const text = JSON.stringify(rows);
  assert.ok(!text.includes('ขาดทุน'), 'ปัญหาที่แก้แล้วต้องไม่ค้างอยู่ในรายงาน');
});

test('ไม่มีปัญหาต้องบอกให้ชัดว่าไม่มี ไม่ใช่ปล่อยแผ่นว่าง', () => {
  // แผ่นว่างเปล่าทำให้คนสงสัยว่าระบบพังหรือยังไม่ได้รัน
  const ctx = shop();
  ctx.validateCatalog();
  assert.match(JSON.stringify(ctx.spreadsheet.getSheetByName('ตรวจสอบข้อมูล').rows), /ไม่พบปัญหา/);
});

test('สรุปผลบอกจำนวนแยกตามระดับความเร่งด่วน', () => {
  const ctx = shop([['SKU0016', '', 'ยูโร่', 'Snack', 'แพ็ค', 51, 50, 53, 5, 0, 3, true]]);
  ctx.validateCatalog();

  const alert = ctx.alerts.join('\n');
  assert.match(alert, /เสียเงิน: 1/);
  assert.match(alert, /ตรวจสินค้า 1 รายการ/);
});

// ---------------------------------------------------------------------------
test('เพิ่มสินค้าใหม่ได้รหัสที่ไม่ซ้ำของเดิม', () => {
  const ctx = shop([
    ['SKU0003', '8851959142011', 'SINGHA', 'Beverage', 'แพ็ค', 49, 55, 52, 5, 8, 3, true],
    ['SKU0141', '8850718801015', 'ตัวสุดท้าย', 'Snack', 'ชิ้น', 10, 20, '', 5, 5, 3, true]
  ]);
  ctx.addNewProductRow();

  const rows = ctx.spreadsheet.getSheetByName('Products').rows;
  assert.equal(rows[rows.length - 1][0], 'SKU0142', 'ต้องต่อจากรหัสที่มากที่สุด ไม่ใช่นับจำนวนแถว');
});

test('สินค้าใหม่ต้องเริ่มที่สต็อก 0 เพื่อบังคับให้ตรวจนับก่อนขาย', () => {
  const ctx = shop();
  ctx.addNewProductRow();

  const rows = ctx.spreadsheet.getSheetByName('Products').rows;
  const added = rows[rows.length - 1];
  assert.equal(added[PRODUCT_HEADERS.indexOf('StockQty')], 0);
  assert.equal(added[PRODUCT_HEADERS.indexOf('Active')], true);
});

test('บอกด้วยว่าต้องกรอกอะไรต่อ ไม่ใช่เพิ่มแถวเปล่าแล้วปล่อยทิ้ง', () => {
  const ctx = shop();
  ctx.addNewProductRow();

  const alert = ctx.alerts.join('\n');
  assert.match(alert, /SKU0004/);
  assert.match(alert, /RetailPrice/, 'ต้องบอกว่าไม่ใส่ราคาแล้วขายไม่ได้');
});

test('ชีตที่ยังไม่มีสินค้าเลย ออกรหัสแรกได้ถูกต้อง', () => {
  const ctx = shop([]);
  ctx.addNewProductRow();
  assert.equal(ctx.spreadsheet.getSheetByName('Products').rows[1][0], 'SKU0001');
});

// ---------------------------------------------------------------------------
// ยุบบรรทัด — ข้อมูลจริงของร้านให้ผล 429 บรรทัด ซึ่งอ่านไม่ไหวสำหรับคนที่ไม่ได้เขียนโปรแกรม
function manyProducts(count, fn) {
  const rows = [];
  for (let n = 1; n <= count; n++) rows.push(fn(String(n).padStart(4, '0')));
  return rows;
}

test('ปัญหาที่เจอเป็นร้อยรายการต้องยุบเหลือบรรทัดเดียว', () => {
  // 50 รายการที่ไม่มีบาร์โค้ด — เป็นงานที่รู้อยู่แล้วว่าต้องเดินเก็บทั้งร้าน
  const ctx = shop(manyProducts(50, (n) =>
    [`SKU${n}`, '', `สินค้า ${n}`, 'Snack', 'ชิ้น', 10, 20, '', 5, 5, 3, true]));
  ctx.validateCatalog();

  const rows = ctx.spreadsheet.getSheetByName('ตรวจสอบข้อมูล').rows;
  assert.equal(rows.length, 2, 'หัวตาราง + สรุป 1 บรรทัด');
  assert.match(String(rows[1][3]), /รวม 50 รายการ/);
});

test('เรื่องที่ต้องแก้เป็นรายตัวต้องไม่ถูกยุบหาย', () => {
  // ขาดทุน 3 ตัว (ต่ำกว่าเกณฑ์ยุบ) ปนกับไม่มีบาร์โค้ด 50 ตัว (เกินเกณฑ์)
  // ตัวที่ขาดทุนต้องยังเห็นครบทีละตัว เพราะแต่ละตัวต้องตัดสินใจราคาแยกกัน
  const rows = manyProducts(50, (n) =>
    [`SKU${n}`, '', `สินค้า ${n}`, 'Snack', 'ชิ้น', 10, 20, '', 5, 5, 3, true]);
  for (let i = 0; i < 3; i++) rows[i][6] = 5;   // ขาย 5 ทุน 10

  const ctx = shop(rows);
  ctx.validateCatalog();

  const sheet = ctx.spreadsheet.getSheetByName('ตรวจสอบข้อมูล').rows;
  const losses = sheet.filter((r) => r[0] === 'เสียเงิน');
  assert.equal(losses.length, 3, 'สินค้าที่ขาดทุนต้องเห็นครบทุกตัว ไม่ถูกยุบ');
  assert.ok(losses.every((r) => /^SKU\d+$/.test(String(r[1]))), 'ต้องบอก SKU จริง ไม่ใช่ "N รายการ"');
});

test('สรุปในกล่องข้อความยังนับจำนวนจริง ไม่ใช่จำนวนหลังยุบ', () => {
  // ถ้ากล่องบอก "1 รายการ" ทั้งที่มี 50 เจ้าของร้านจะเข้าใจผิดว่างานเหลือน้อย
  const ctx = shop(manyProducts(50, (n) =>
    [`SKU${n}`, '', `สินค้า ${n}`, 'Snack', 'ชิ้น', 10, 20, '', 5, 5, 3, true]));
  ctx.validateCatalog();
  assert.match(ctx.alerts.join('\n'), /ควรทำ: 50/);
});

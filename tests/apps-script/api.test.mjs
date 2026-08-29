/**
 * เทสต์ API ของ backend ทั้งเส้น — เรียกผ่าน doGet/doPost เหมือนที่แอปเรียกจริง
 *
 * ทำไมสำคัญ: ตรรกะการขาย ตัดสต็อก ยกเลิกบิล และคืนของ เป็นส่วนที่ผิดแล้วเสียเงินจริง
 * แต่รันบน Google เท่านั้น จึงไม่เคยถูกทดสอบเลยก่อนหน้านี้
 *
 * นอกจากตรวจว่าตรรกะถูก ยังตรวจ "รูปร่างของคำตอบ" ว่าตรงกับที่ฝั่งแอปอ่านจริง
 * เพราะถ้า backend เปลี่ยนชื่อ field แอปจะพังตอน deploy จริงเท่านั้น
 *
 * รันด้วย: node --test "tests/apps-script/*.test.mjs"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript, apiGet, apiPost } from './harness.mjs';

const FILES = ['Utils.gs', 'Auth.gs', 'Products.gs', 'Sales.gs', 'Barcodes.gs', 'Search.gs', 'Setup.gs', 'Code.gs'];
const TOKEN = 'test-token';

// PIN 1234 แบบ hash แล้ว (ค่าเดียวกับที่ hashPin_ คำนวณ)
const PIN_1234_HASH = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

const PRODUCT_HEADERS = ['SKU', 'Barcode', 'Name', 'Category', 'Unit', 'Cost', 'RetailPrice',
  'WholesalePrice', 'WholesaleMinQty', 'StockQty', 'ReorderPoint', 'Active'];

function shop() {
  return loadAppsScript(FILES, {
    scriptProperties: { API_TOKEN: TOKEN },
    sheets: {
      Products: [
        PRODUCT_HEADERS,
        ['SKU0016', '', 'ยูโร่ คัสตาร์ดเค้ก', 'Snack', 'แพ็ค', 51, 50, 53, 5, 20, 3, true],
        ['SKU0003', '8851959142011', 'SINGHA น้ำดื่ม 1.5L x6', 'Beverage', 'แพ็ค', 49, 50, 52, 5, 8, 3, true],
        ['SKU0099', '', 'ของที่หมดแล้ว', 'Snack', 'ชิ้น', 10, 20, '', 5, 0, 2, true]
      ],
      Sales: [['SaleID', 'ClientSaleId', 'Timestamp', 'CashierId', 'CustomerName',
               'Subtotal', 'Discount', 'Total', 'PaymentMethod', 'Status']],
      SaleItems: [['SaleID', 'SKU', 'ProductName', 'Qty', 'UnitPrice', 'LineTotal']],
      StockMovements: [['Timestamp', 'SKU', 'ChangeQty', 'Reason', 'RefSaleID', 'UserId']],
      Staff: [['UserId', 'Name', 'PinHash', 'Role', 'Active'],
              ['U1', 'เจ้าของร้าน', PIN_1234_HASH, 'owner', true],
              ['U2', 'พนักงานลาออก', PIN_1234_HASH, 'cashier', false]],
      Settings: [['Key', 'Value'], ['ShopName', 'สินไทยพาณิชย์']],
      BarcodeCaptures: [['Timestamp', 'SKU', 'Barcode', 'PreviousBarcode', 'UserId']],
      ActivityLogs: [['Timestamp', 'UserId', 'Action', 'Details']]
    }
  });
}

const stockOf = (ctx, sku) => {
  const rows = ctx.spreadsheet.getSheetByName('Products').rows;
  const row = rows.find((r) => r[0] === sku);
  return Number(row[PRODUCT_HEADERS.indexOf('StockQty')]);
};

const sale = (overrides = {}) => ({
  clientSaleId: 'client-1',
  cashierId: 'U1',
  items: [{ sku: 'SKU0016', productName: 'ยูโร่ คัสตาร์ดเค้ก', qty: 2, unitPrice: 50 }],
  discount: 0,
  paymentMethod: 'cash',
  ...overrides
});

// ---------------------------------------------------------------------------
test('ปฏิเสธทุก request ที่ token ไม่ถูกต้อง', () => {
  const ctx = shop();
  const bad = apiGet(ctx, 'products', {}, 'token-ผิด');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /token/);

  const badPost = apiPost(ctx, 'login', { pin: '1234' }, 'token-ผิด');
  assert.equal(badPost.ok, false);
});

test('products คืนรูปร่างที่ฝั่งแอปอ่านจริง', () => {
  const result = apiGet(shop(), 'products');
  assert.equal(result.ok, true);
  assert.equal(result.products.length, 3);
  // ชื่อ field เหล่านี้ถูกอ่านตรงๆ ใน web/src/pages/*.js — เปลี่ยนเมื่อไหร่แอปพังทันที
  for (const key of ['SKU', 'Barcode', 'Name', 'Cost', 'RetailPrice',
                     'WholesalePrice', 'WholesaleMinQty', 'StockQty', 'ReorderPoint', 'Unit']) {
    assert.ok(key in result.products[0], `products ต้องมี field "${key}"`);
  }
});

test('login ผ่านด้วย PIN ที่ถูก และคืน staff ที่แอปเก็บลง session', () => {
  const result = apiPost(shop(), 'login', { pin: '1234' });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.staff).sort(), ['name', 'role', 'userId']);
  assert.equal(result.staff.userId, 'U1');
});

test('login ไม่ผ่านสำหรับพนักงานที่ปิดใช้งานแล้ว', () => {
  // U2 มี PIN เดียวกันแต่ Active = FALSE — ต้องไม่ให้เข้า
  const ctx = shop();
  ctx.spreadsheet.getSheetByName('Staff').rows.splice(1, 1);   // เอา U1 ออก เหลือ U2
  const result = apiPost(ctx, 'login', { pin: '1234' });
  assert.equal(result.ok, false);
});

test('login ไม่ผ่านเมื่อ PIN ผิด', () => {
  const result = apiPost(shop(), 'login', { pin: '9999' });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
test('ขายของแล้วตัดสต็อกตามจำนวนที่ขาย', () => {
  const ctx = shop();
  assert.equal(stockOf(ctx, 'SKU0016'), 20);

  const result = apiPost(ctx, 'createSale', sale());
  assert.equal(result.ok, true);
  assert.ok(result.saleId, 'ต้องคืนเลขที่บิลให้แอปเอาไปแสดงบนใบเสร็จ');
  assert.equal(result.total, 100);
  assert.equal(stockOf(ctx, 'SKU0016'), 18);
});

test('ขายแล้วบันทึกรายการสินค้าและการเคลื่อนไหวสต็อกครบ', () => {
  const ctx = shop();
  apiPost(ctx, 'createSale', sale());

  const items = ctx.spreadsheet.getSheetByName('SaleItems').rows;
  assert.equal(items.length, 2, 'ต้องมีหัวตาราง + รายการที่ขาย');
  assert.equal(items[1][3], 2);        // Qty
  assert.equal(items[1][5], 100);      // LineTotal

  const movements = ctx.spreadsheet.getSheetByName('StockMovements').rows;
  assert.equal(movements[1][2], -2, 'การขายต้องบันทึกเป็นค่าติดลบ');
  assert.equal(movements[1][3], 'sale');
});

test('หักส่วนลดออกจากยอดสุทธิ', () => {
  const result = apiPost(shop(), 'createSale', sale({ discount: 25 }));
  assert.equal(result.total, 75);
});

test('ขายของแล้วบันทึกลง ActivityLogs ไว้ตรวจย้อนหลัง', () => {
  const ctx = shop();
  apiPost(ctx, 'createSale', sale());

  const logs = ctx.spreadsheet.getSheetByName('ActivityLogs').rows;
  assert.equal(logs.length, 2, 'ต้องมีหัวตาราง + 1 รายการ');
  assert.equal(logs[1][1], 'U1');
  assert.equal(logs[1][2], 'sale');
});

test('ไม่ยอมให้ขายเกินจำนวนที่มีในสต็อก', () => {
  const ctx = shop();
  const result = apiPost(ctx, 'createSale', sale({
    items: [{ sku: 'SKU0016', qty: 999, unitPrice: 50 }]
  }));
  assert.equal(result.ok, false);
  assert.match(result.error, /คงเหลือไม่พอ/);
  assert.equal(stockOf(ctx, 'SKU0016'), 20, 'สต็อกต้องไม่ถูกแตะเมื่อขายไม่สำเร็จ');
});

test('บิลที่มีสินค้าหลายตัว ถ้าตัวใดตัวหนึ่งสต็อกไม่พอ ต้องไม่ตัดสต็อกตัวอื่นเลย', () => {
  // สำคัญมาก: ถ้าตัดไปบางตัวแล้วค่อยพบว่าอีกตัวไม่พอ สต็อกจะเพี้ยนโดยไม่มีบิลรองรับ
  const ctx = shop();
  const result = apiPost(ctx, 'createSale', sale({
    items: [
      { sku: 'SKU0016', qty: 1, unitPrice: 50 },
      { sku: 'SKU0099', qty: 1, unitPrice: 20 }   // ตัวนี้สต็อกเป็น 0
    ]
  }));
  assert.equal(result.ok, false);
  assert.equal(stockOf(ctx, 'SKU0016'), 20, 'สินค้าตัวแรกต้องไม่ถูกตัดสต็อก');
});

test('ยิงบิลเดิมซ้ำ (clientSaleId เดิม) ต้องไม่ตัดสต็อกซ้ำ', () => {
  // เกิดจริงตอน sync ออฟไลน์แล้วเน็ตหลุดกลางทาง แอปจะยิงซ้ำ
  const ctx = shop();
  const first = apiPost(ctx, 'createSale', sale());
  const second = apiPost(ctx, 'createSale', sale());

  assert.equal(second.ok, true, 'ต้องตอบสำเร็จ ไม่ใช่ error เพื่อให้แอปลบออกจากคิวได้');
  assert.equal(second.duplicate, true);
  assert.equal(second.saleId, first.saleId);
  assert.equal(stockOf(ctx, 'SKU0016'), 18, 'สต็อกต้องถูกตัดครั้งเดียว');
});

test('ปฏิเสธบิลที่ไม่มีรายการสินค้า', () => {
  const result = apiPost(shop(), 'createSale', sale({ items: [] }));
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
test('ยกเลิกบิลแล้วคืนสต็อกกลับครบ', () => {
  const ctx = shop();
  const created = apiPost(ctx, 'createSale', sale());
  assert.equal(stockOf(ctx, 'SKU0016'), 18);

  const voided = apiPost(ctx, 'voidSale', { saleId: created.saleId, userId: 'U1' });
  assert.equal(voided.ok, true);
  assert.equal(voided.itemsRestored, 1);
  assert.equal(stockOf(ctx, 'SKU0016'), 20, 'ของต้องกลับเข้าสต็อกเท่าเดิม');
});

test('ยกเลิกแล้วเปลี่ยนสถานะบิลเป็น voided ไม่ใช่ลบทิ้ง', () => {
  const ctx = shop();
  const created = apiPost(ctx, 'createSale', sale());
  apiPost(ctx, 'voidSale', { saleId: created.saleId });

  const sales = ctx.spreadsheet.getSheetByName('Sales').rows;
  assert.equal(sales.length, 2, 'แถวบิลต้องยังอยู่ให้ตรวจย้อนหลังได้');
  assert.equal(sales[1][9], 'voided');
});

test('ยกเลิกบิลแล้วบันทึกลง ActivityLogs ด้วย', () => {
  const ctx = shop();
  const created = apiPost(ctx, 'createSale', sale());
  apiPost(ctx, 'voidSale', { saleId: created.saleId, userId: 'U1' });

  const logs = ctx.spreadsheet.getSheetByName('ActivityLogs').rows;
  assert.equal(logs.length, 3, 'ต้องมีหัวตาราง + sale + void');
  assert.equal(logs[2][2], 'void');
});

test('ยกเลิกบิลเดิมซ้ำต้องถูกปฏิเสธ ไม่คืนสต็อกสองรอบ', () => {
  const ctx = shop();
  const created = apiPost(ctx, 'createSale', sale());
  apiPost(ctx, 'voidSale', { saleId: created.saleId });

  const again = apiPost(ctx, 'voidSale', { saleId: created.saleId });
  assert.equal(again.ok, false);
  assert.match(again.error, /ถูกยกเลิกไปแล้ว/);
  assert.equal(stockOf(ctx, 'SKU0016'), 20, 'สต็อกต้องไม่เกินของเดิม');
});

test('บิลที่ยกเลิกแล้วต้องไม่ถูกนับในรายงาน', () => {
  const ctx = shop();
  const created = apiPost(ctx, 'createSale', sale());
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const before = apiGet(ctx, 'report', { date: dateStr });
  assert.equal(before.orderCount, 1);

  apiPost(ctx, 'voidSale', { saleId: created.saleId });
  const after = apiGet(ctx, 'report', { date: dateStr });
  assert.equal(after.orderCount, 0, 'ยอดขายต้องไม่นับบิลที่ยกเลิกแล้ว');
  assert.equal(after.totalSales, 0);
});

// ---------------------------------------------------------------------------
test('รายงานคืนทุก field ที่หน้ารายงานอ่าน', () => {
  const ctx = shop();
  apiPost(ctx, 'createSale', sale());
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const report = apiGet(ctx, 'report', { date: dateStr });
  for (const key of ['orderCount', 'totalSales', 'totalDiscount', 'grossProfit',
                     'revenueWithKnownCost', 'unknownCostRevenue', 'itemCount',
                     'topSellers', 'soldBelowCost', 'bills']) {
    assert.ok(key in report, `รายงานต้องมี field "${key}"`);
  }
});

test('รายงานคิดกำไรจากต้นทุน และจับสินค้าที่ขายต่ำกว่าทุน', () => {
  const ctx = shop();
  // SKU0016 ทุน 51 ขาย 50 — ขายแล้วขาดทุนตัวละ 1 บาท (เคสจริงของไลน์ยูโร่)
  apiPost(ctx, 'createSale', sale({ items: [{ sku: 'SKU0016', qty: 3, unitPrice: 50 }] }));
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const report = apiGet(ctx, 'report', { date: dateStr });
  assert.equal(report.grossProfit, -3);
  assert.equal(report.soldBelowCost.length, 1);
  assert.equal(report.soldBelowCost[0].sku, 'SKU0016');
});

test('reportRange รวมยอดหลายวันและแยกยอดรายวันให้', () => {
  const ctx = shop();
  apiPost(ctx, 'createSale', sale({ clientSaleId: 'c1' }));
  apiPost(ctx, 'createSale', sale({ clientSaleId: 'c2', items: [{ sku: 'SKU0003', qty: 1, unitPrice: 50 }] }));

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const range = apiGet(ctx, 'reportRange', { dateFrom: dateStr, dateTo: dateStr });
  assert.equal(range.ok, true);
  assert.equal(range.orderCount, 2);
  assert.equal(range.totalSales, 150);
  assert.equal(range.daily.length, 1, 'สองบิลในวันเดียวกันต้องรวมเป็นแถวเดียว');
  assert.equal(range.daily[0].date, dateStr);
  assert.equal(range.daily[0].orderCount, 2);
});

test('reportRange ปฏิเสธเมื่อ dateFrom เกิน dateTo', () => {
  const result = apiGet(shop(), 'reportRange', { dateFrom: '2026-08-20', dateTo: '2026-08-01' });
  assert.equal(result.ok, false);
});

test('reportRange ปฏิเสธเมื่อไม่ระบุวันที่', () => {
  const result = apiGet(shop(), 'reportRange', {});
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
test('ตรวจนับสต็อกบันทึกส่วนต่าง ไม่ใช่แค่ทับตัวเลข', () => {
  const ctx = shop();
  const result = apiPost(ctx, 'countStock', { sku: 'SKU0016', countedQty: 15, userId: 'U1' });

  assert.equal(result.ok, true);
  assert.equal(result.before, 20);
  assert.equal(result.difference, -5);
  assert.equal(stockOf(ctx, 'SKU0016'), 15);

  const movements = ctx.spreadsheet.getSheetByName('StockMovements').rows;
  assert.equal(movements[1][3], 'stocktake', 'ต้องบันทึกที่มาของการเปลี่ยนแปลง');

  const logs = ctx.spreadsheet.getSheetByName('ActivityLogs').rows;
  assert.equal(logs.length, 2, 'ตรวจนับที่มีส่วนต่างต้องบันทึกลง ActivityLogs');
  assert.equal(logs[1][2], 'stocktake');
});

test('ตรวจนับที่จำนวนไม่ต่างจากเดิมไม่ต้องบันทึกลง ActivityLogs', () => {
  const ctx = shop();
  apiPost(ctx, 'countStock', { sku: 'SKU0016', countedQty: 20, userId: 'U1' });

  const logs = ctx.spreadsheet.getSheetByName('ActivityLogs').rows;
  assert.equal(logs.length, 1, 'ไม่มีการเปลี่ยนแปลงจริง ไม่ควรมี log เพิ่ม');
});

test('ตรวจนับปฏิเสธจำนวนติดลบ', () => {
  const result = apiPost(shop(), 'countStock', { sku: 'SKU0016', countedQty: -1 });
  assert.equal(result.ok, false);
});

test('รับของเข้าเพิ่มสต็อกและบันทึกเป็น restock', () => {
  const ctx = shop();
  const result = apiPost(ctx, 'adjustStock', { sku: 'SKU0016', changeQty: 24, reason: 'restock' });
  assert.equal(result.ok, true);
  assert.equal(result.stockQty, 44, 'ต้องคืนยอดใหม่ให้แอปเอาไปแสดง');
  assert.equal(stockOf(ctx, 'SKU0016'), 44);
});

// ---------------------------------------------------------------------------
test('บันทึกบาร์โค้ดที่ถูกต้องได้ และเก็บลงชีตบันทึกด้วย', () => {
  const ctx = shop();
  const result = apiPost(ctx, 'setBarcode', {
    sku: 'SKU0016', barcode: '8850718801015', userId: 'U1'
  });
  assert.equal(result.ok, true);
  assert.equal(result.barcode, '8850718801015');

  const captures = ctx.spreadsheet.getSheetByName('BarcodeCaptures').rows;
  assert.equal(captures.length, 2, 'ต้องต่อท้ายชีตบันทึกไว้กันหายตอน import รอบหน้า');

  const logs = ctx.spreadsheet.getSheetByName('ActivityLogs').rows;
  assert.equal(logs.length, 2);
  assert.equal(logs[1][2], 'setBarcode');
});

test('ปฏิเสธบาร์โค้ดที่หลักตรวจสอบไม่ตรง แม้ยิงตรงมาที่ API', () => {
  // ฝั่งแอปตรวจแล้ว แต่ใครที่รู้ URL กับ token ก็ยิงตรงได้ server ต้องตรวจซ้ำเสมอ
  const result = apiPost(shop(), 'setBarcode', { sku: 'SKU0016', barcode: '8850718801016' });
  assert.equal(result.ok, false);
  assert.match(result.error, /หลักตรวจสอบ/);
});

test('ปฏิเสธบาร์โค้ดที่เป็นของสินค้าตัวอื่นอยู่แล้ว', () => {
  const ctx = shop();
  const result = apiPost(ctx, 'setBarcode', { sku: 'SKU0016', barcode: '8851959142011' });
  assert.equal(result.ok, false);
  assert.match(result.error, /SKU0003/);
});

// ---------------------------------------------------------------------------
test('search ค้นสินค้าจากชื่อ, SKU, หรือบาร์โค้ดได้', () => {
  const ctx = shop();

  const byName = apiGet(ctx, 'search', { q: 'ยูโร่' });
  assert.equal(byName.results.length, 1);
  assert.equal(byName.results[0].type, 'product');
  assert.equal(byName.results[0].sku, 'SKU0016');

  const byBarcode = apiGet(ctx, 'search', { q: '8851959142011' });
  assert.equal(byBarcode.results[0].sku, 'SKU0003');
});

test('search ค้นบิลจากเลขที่บิลหรือชื่อลูกค้าได้', () => {
  const ctx = shop();
  const created = apiPost(ctx, 'createSale', sale({ customerName: 'ร้านป้าหนู' }));

  const bySaleId = apiGet(ctx, 'search', { q: created.saleId });
  assert.equal(bySaleId.results.length, 1);
  assert.equal(bySaleId.results[0].type, 'sale');

  const byCustomer = apiGet(ctx, 'search', { q: 'ป้าหนู' });
  assert.equal(byCustomer.results[0].saleId, created.saleId);
});

test('search คำค้นว่างคืน array ว่าง ไม่ใช่ error', () => {
  const result = apiGet(shop(), 'search', { q: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.results, []);
});

// ---------------------------------------------------------------------------
test('settings คืนค่าที่ใบเสร็จใช้', () => {
  const result = apiGet(shop(), 'settings');
  assert.equal(result.ok, true);
  assert.equal(result.settings.ShopName, 'สินไทยพาณิชย์');
});

test('action ที่ไม่รู้จักตอบ error ไม่ใช่พังทั้ง endpoint', () => {
  assert.equal(apiGet(shop(), 'ไม่มี action นี้').ok, false);
  assert.equal(apiPost(shop(), 'ไม่มี action นี้').ok, false);
});

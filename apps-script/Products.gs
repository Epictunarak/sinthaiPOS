/**
 * Products.gs — อ่านรายการสินค้า และปรับสต็อกมือ (รับของเข้า/ตรวจนับ)
 */

function handleGetProducts_() {
  var sheet = getSheet_(SHEET_NAMES.PRODUCTS);
  var products = sheetToObjects_(sheet).filter(function (p) {
    return p.Active === true;
  });
  return { ok: true, products: products };
}

/**
 * ตรวจนับสต็อก — บันทึก "จำนวนที่นับได้จริง" ไม่ใช่ส่วนต่าง
 *
 * ต่างจาก adjustStock ตรงที่พนักงานกรอกตัวเลขที่นับได้ตรงๆ ระบบคำนวณส่วนต่างให้เอง
 * ซึ่งตรงกับวิธีทำงานจริงตอนเดินนับของ (นับได้ 12 ก็กรอก 12 ไม่ต้องมาคิดว่าต่างจากเดิมเท่าไหร่)
 *
 * ส่วนต่างยังถูกบันทึกเป็น StockMovements ตามปกติ เพื่อให้ยอดคงเหลือยังตรวจย้อนหลังได้ว่า
 * มาจากไหนบ้าง ไม่ใช่จู่ๆ ตัวเลขเปลี่ยนโดยไม่มีที่มา
 *
 * payload = { sku, countedQty, userId, note }
 */
function handleCountStock_(payload) {
  var sku = String(payload.sku || '').trim();
  var counted = Number(payload.countedQty);

  if (!sku) return { ok: false, error: 'ต้องระบุ sku' };
  if (isNaN(counted) || counted < 0) {
    return { ok: false, error: 'จำนวนที่นับได้ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป' };
  }

  return withLock_(function () {
    var productsSheet = getSheet_(SHEET_NAMES.PRODUCTS);
    var rowIndex = findRowIndexByKey_(productsSheet, 'SKU', sku);
    if (rowIndex === -1) return { ok: false, error: 'ไม่พบสินค้า SKU: ' + sku };

    var headers = productsSheet.getRange(1, 1, 1, productsSheet.getLastColumn()).getValues()[0];
    var stockColIndex = headers.indexOf('StockQty');
    var before = Number(productsSheet.getRange(rowIndex, stockColIndex + 1).getValue()) || 0;
    var difference = counted - before;

    if (difference === 0) {
      return { ok: true, sku: sku, stockQty: counted, difference: 0, unchanged: true };
    }

    updateRowFields_(productsSheet, rowIndex, { StockQty: counted });

    appendObject_(getSheet_(SHEET_NAMES.STOCK_MOVEMENTS), {
      Timestamp: new Date(),
      SKU: sku,
      ChangeQty: difference,
      Reason: 'stocktake',
      RefSaleID: '',
      UserId: payload.userId || ''
    });

    return { ok: true, sku: sku, stockQty: counted, before: before, difference: difference };
  });
}

function handleAdjustStock_(payload) {
  var sku = payload.sku;
  var changeQty = Number(payload.changeQty);
  var reason = payload.reason || 'adjustment';
  var userId = payload.userId || '';

  if (!sku || isNaN(changeQty) || changeQty === 0) {
    return { ok: false, error: 'ต้องระบุ sku และ changeQty (ไม่เท่ากับ 0)' };
  }

  return withLock_(function () {
    var productsSheet = getSheet_(SHEET_NAMES.PRODUCTS);
    var rowIndex = findRowIndexByKey_(productsSheet, 'SKU', sku);
    if (rowIndex === -1) return { ok: false, error: 'ไม่พบสินค้า SKU: ' + sku };

    var headers = productsSheet.getRange(1, 1, 1, productsSheet.getLastColumn()).getValues()[0];
    var stockColIndex = headers.indexOf('StockQty');
    var currentStock = Number(productsSheet.getRange(rowIndex, stockColIndex + 1).getValue()) || 0;
    var newStock = currentStock + changeQty;

    updateRowFields_(productsSheet, rowIndex, { StockQty: newStock });

    appendObject_(getSheet_(SHEET_NAMES.STOCK_MOVEMENTS), {
      Timestamp: new Date(),
      SKU: sku,
      ChangeQty: changeQty,
      Reason: reason,
      RefSaleID: '',
      UserId: userId
    });

    return { ok: true, sku: sku, stockQty: newStock };
  });
}

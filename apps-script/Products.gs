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

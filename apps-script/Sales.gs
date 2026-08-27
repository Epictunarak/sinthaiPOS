/**
 * Sales.gs — บันทึกการขาย, ตัดสต็อก, และสรุปยอดขายรายวัน
 */

/**
 * payload = {
 *   clientSaleId, cashierId, customerName, items: [{sku, qty, unitPrice}],
 *   discount, paymentMethod
 * }
 *
 * clientSaleId ถูกสร้างฝั่ง PWA ตอนกดขาย (แม้ยัง offline) ใช้กันบันทึกซ้ำตอน sync
 * ซ้ำ (เช่น เน็ตหลุดกลางทาง แล้ว PWA ยิงซ้ำ) — ถ้าเจอ clientSaleId เดิมในชีต Sales
 * แล้ว จะตอบ ok:true กลับไปเฉยๆ โดยไม่ตัดสต็อกซ้ำ
 */
function handleCreateSale_(payload) {
  var clientSaleId = payload.clientSaleId;
  var items = payload.items || [];

  if (!clientSaleId) return { ok: false, error: 'ต้องระบุ clientSaleId' };
  if (!items.length) return { ok: false, error: 'ไม่มีรายการสินค้าในบิล' };

  return withLock_(function () {
    var salesSheet = getSheet_(SHEET_NAMES.SALES);

    var existingRow = findRowIndexByKey_(salesSheet, 'ClientSaleId', clientSaleId);
    if (existingRow !== -1) {
      var existing = sheetToObjects_(salesSheet).filter(function (s) {
        return s.ClientSaleId === clientSaleId;
      })[0];
      return { ok: true, saleId: existing.SaleID, duplicate: true };
    }

    var productsSheet = getSheet_(SHEET_NAMES.PRODUCTS);
    var productHeaders = productsSheet.getRange(1, 1, 1, productsSheet.getLastColumn()).getValues()[0];
    var stockColIndex = productHeaders.indexOf('StockQty');

    // เช็กสต็อกพอก่อนตัดจริงทุกตัว กันขายเกินสต็อก
    var rowIndexBySku = {};
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var rowIndex = findRowIndexByKey_(productsSheet, 'SKU', item.sku);
      if (rowIndex === -1) return { ok: false, error: 'ไม่พบสินค้า SKU: ' + item.sku };
      var currentStock = Number(productsSheet.getRange(rowIndex, stockColIndex + 1).getValue()) || 0;
      if (currentStock < item.qty) {
        return { ok: false, error: 'สินค้า ' + item.sku + ' คงเหลือไม่พอ (เหลือ ' + currentStock + ')' };
      }
      rowIndexBySku[item.sku] = { rowIndex: rowIndex, currentStock: currentStock };
    }

    var saleId = generateId_('SALE');
    var now = new Date();
    var subtotal = items.reduce(function (sum, it) { return sum + it.qty * it.unitPrice; }, 0);
    var discount = Number(payload.discount) || 0;
    var total = subtotal - discount;

    appendObject_(salesSheet, {
      SaleID: saleId,
      ClientSaleId: clientSaleId,
      Timestamp: now,
      CashierId: payload.cashierId || '',
      CustomerName: payload.customerName || '',
      Subtotal: subtotal,
      Discount: discount,
      Total: total,
      PaymentMethod: payload.paymentMethod || 'cash',
      Status: 'completed'
    });

    var saleItemsSheet = getSheet_(SHEET_NAMES.SALE_ITEMS);
    var stockMovementsSheet = getSheet_(SHEET_NAMES.STOCK_MOVEMENTS);

    items.forEach(function (item) {
      appendObject_(saleItemsSheet, {
        SaleID: saleId,
        SKU: item.sku,
        ProductName: item.productName || '',
        Qty: item.qty,
        UnitPrice: item.unitPrice,
        LineTotal: item.qty * item.unitPrice
      });

      var info = rowIndexBySku[item.sku];
      var newStock = info.currentStock - item.qty;
      updateRowFields_(productsSheet, info.rowIndex, { StockQty: newStock });

      appendObject_(stockMovementsSheet, {
        Timestamp: now,
        SKU: item.sku,
        ChangeQty: -item.qty,
        Reason: 'sale',
        RefSaleID: saleId,
        UserId: payload.cashierId || ''
      });
    });

    return { ok: true, saleId: saleId, total: total };
  });
}

/** สรุปยอดขายของวันที่ระบุ (YYYY-MM-DD) */
function handleReport_(dateStr) {
  if (!dateStr) return { ok: false, error: 'ต้องระบุ date=YYYY-MM-DD' };

  var sales = sheetToObjects_(getSheet_(SHEET_NAMES.SALES)).filter(function (s) {
    if (s.Status !== 'completed') return false;
    var d = new Date(s.Timestamp);
    return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd') === dateStr;
  });

  var totalSales = sales.reduce(function (sum, s) { return sum + Number(s.Total); }, 0);
  var totalDiscount = sales.reduce(function (sum, s) { return sum + Number(s.Discount); }, 0);

  return {
    ok: true,
    date: dateStr,
    orderCount: sales.length,
    totalSales: totalSales,
    totalDiscount: totalDiscount
  };
}

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

/**
 * สรุปยอดขายของวันที่ระบุ (YYYY-MM-DD)
 *
 * รายงานนี้บอก "กำไร" ไม่ใช่แค่ "ยอดขาย" เพราะยอดขายสูงไม่ได้แปลว่าได้กำไร
 * ข้อมูลจริงของร้านมีสินค้าที่ขายต่ำกว่าทุนอยู่ ยิ่งขายยิ่งขาดทุน ถ้ารายงานบอกแค่
 * ยอดขาย ปัญหานี้จะไม่มีวันโผล่ให้เห็น
 *
 * ต้นทุนที่ใช้คือ Products.Cost ณ ตอนออกรายงาน (ไม่ได้เก็บต้นทุนไว้ในบิลตอนขาย)
 * ดังนั้นถ้าต้นทุนเปลี่ยนภายหลัง กำไรย้อนหลังจะขยับตาม — ยอมรับได้สำหรับร้านขนาดนี้
 * แต่ต้องรู้ไว้ว่าตัวเลขกำไรเป็นค่าประมาณ ไม่ใช่บัญชีต้นทุนที่ตรึงไว้แล้ว
 */
function handleReport_(dateStr) {
  if (!dateStr) return { ok: false, error: 'ต้องระบุ date=YYYY-MM-DD' };

  var sales = sheetToObjects_(getSheet_(SHEET_NAMES.SALES)).filter(function (s) {
    if (s.Status !== 'completed') return false;
    var d = new Date(s.Timestamp);
    return Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd') === dateStr;
  });

  var totalSales = sales.reduce(function (sum, s) { return sum + Number(s.Total); }, 0);
  var totalDiscount = sales.reduce(function (sum, s) { return sum + Number(s.Discount); }, 0);

  var saleIds = {};
  sales.forEach(function (s) { saleIds[s.SaleID] = true; });

  // ต้นทุนต่อ SKU (ว่างได้ ถ้ายังไม่รู้ราคาซัพพลายเออร์)
  var costBySku = {};
  var nameBySku = {};
  sheetToObjects_(getSheet_(SHEET_NAMES.PRODUCTS)).forEach(function (p) {
    var sku = String(p.SKU).trim();
    nameBySku[sku] = p.Name;
    if (p.Cost !== '' && p.Cost !== null && !isNaN(Number(p.Cost))) {
      costBySku[sku] = Number(p.Cost);
    }
  });

  var byProduct = {};
  var revenueWithKnownCost = 0;
  var costOfGoodsSold = 0;
  var unknownCostRevenue = 0;

  sheetToObjects_(getSheet_(SHEET_NAMES.SALE_ITEMS)).forEach(function (item) {
    if (!saleIds[item.SaleID]) return;

    var sku = String(item.SKU).trim();
    var qty = Number(item.Qty) || 0;
    var lineTotal = Number(item.LineTotal) || 0;
    var unitPrice = Number(item.UnitPrice) || 0;

    if (!byProduct[sku]) {
      byProduct[sku] = {
        sku: sku,
        name: item.ProductName || nameBySku[sku] || sku,
        qty: 0, revenue: 0, profit: null, soldBelowCost: false
      };
    }
    var entry = byProduct[sku];
    entry.qty += qty;
    entry.revenue += lineTotal;

    if (costBySku[sku] !== undefined) {
      var cost = costBySku[sku];
      var lineProfit = (unitPrice - cost) * qty;
      entry.profit = (entry.profit || 0) + lineProfit;
      if (unitPrice < cost) entry.soldBelowCost = true;
      revenueWithKnownCost += lineTotal;
      costOfGoodsSold += cost * qty;
    } else {
      unknownCostRevenue += lineTotal;
    }
  });

  var products = Object.keys(byProduct).map(function (sku) { return byProduct[sku]; });
  var topSellers = products.slice().sort(function (a, b) { return b.qty - a.qty; }).slice(0, 10);
  var losers = products.filter(function (p) { return p.soldBelowCost; });

  return {
    ok: true,
    date: dateStr,
    orderCount: sales.length,
    totalSales: totalSales,
    totalDiscount: totalDiscount,
    // กำไรขั้นต้นนับเฉพาะส่วนที่รู้ต้นทุน จึงต้องรายงานคู่กับสัดส่วนที่ยังไม่รู้เสมอ
    grossProfit: revenueWithKnownCost - costOfGoodsSold,
    revenueWithKnownCost: revenueWithKnownCost,
    unknownCostRevenue: unknownCostRevenue,
    itemCount: products.reduce(function (sum, p) { return sum + p.qty; }, 0),
    topSellers: topSellers,
    soldBelowCost: losers
  };
}

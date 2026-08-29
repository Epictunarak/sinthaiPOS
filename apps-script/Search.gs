/**
 * Search.gs — ค้นหารวมข้ามชีต Products และ Sales ด้วยคำค้นเดียว
 *
 * ทำไมต้องมี: หน้าจอปัจจุบันค้นหาแยกกันคนละที่ (ขายของค้นได้แค่บาร์โค้ด/ชื่อสินค้า,
 * รายงานค้นได้แค่บิลของวันที่เลือก) พนักงานที่จำได้แค่บางส่วนของชื่อลูกค้าหรือเลขบิล
 * ไม่มีที่เดียวให้ค้นรวม ยังไม่ได้ต่อเข้าหน้าไหนในแอป เตรียม endpoint ไว้ให้ใช้ได้เลย
 */
function handleGlobalSearch_(query) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: true, results: [] };

  var LIMIT = 10;

  var productMatches = sheetToObjects_(getSheet_(SHEET_NAMES.PRODUCTS))
    .filter(function (p) {
      return String(p.Name || '').toLowerCase().indexOf(q) !== -1 ||
             String(p.SKU || '').toLowerCase().indexOf(q) !== -1 ||
             String(p.Barcode || '').toLowerCase().indexOf(q) !== -1;
    })
    .slice(0, LIMIT)
    .map(function (p) {
      return {
        type: 'product',
        sku: p.SKU,
        name: p.Name,
        barcode: p.Barcode || '',
        stockQty: Number(p.StockQty) || 0
      };
    });

  var saleMatches = sheetToObjects_(getSheet_(SHEET_NAMES.SALES))
    .filter(function (s) {
      return String(s.SaleID || '').toLowerCase().indexOf(q) !== -1 ||
             String(s.CustomerName || '').toLowerCase().indexOf(q) !== -1;
    })
    .slice(0, LIMIT)
    .map(function (s) {
      return {
        type: 'sale',
        saleId: s.SaleID,
        customerName: s.CustomerName || '',
        total: Number(s.Total) || 0,
        status: s.Status || ''
      };
    });

  return { ok: true, results: productMatches.concat(saleMatches) };
}

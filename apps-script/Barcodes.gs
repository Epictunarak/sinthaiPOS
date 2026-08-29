/**
 * Barcodes.gs — บันทึกบาร์โค้ดที่พนักงานยิงจากตัวสินค้าจริงในร้าน
 *
 * ทำไมต้องมีหน้านี้: ชีตต้นทางมีบาร์โค้ดแค่ 2 จาก 141 รายการ ที่เหลือต้องยิงจาก
 * ตัวสินค้าจริงเท่านั้น จะไปหาจากอินเทอร์เน็ตแล้วกรอกเองไม่ได้ เพราะบาร์โค้ดผิด
 * บนสินค้าจริงอันตรายกว่าไม่มีบาร์โค้ดเลย (ยิงแล้วได้สินค้าผิดตัว ตัดสต็อกผิด)
 *
 * บันทึกสองที่:
 *   1. คอลัมน์ Barcode ในชีต Products  → ใช้ขายได้ทันที
 *   2. ชีต BarcodeCaptures (ต่อท้ายอย่างเดียว) → กันหายตอน import รอบถัดไป
 *      เพราะชีต Products ถูกสร้างใหม่ทุกครั้งจาก data/*.csv
 */

/** หลักตรวจสอบตามมาตรฐาน GS1 — ตรรกะเดียวกับ web/src/barcode.js */
function gs1CheckDigit_(digitsWithoutCheck) {
  var sum = 0;
  var weight = 3;
  for (var i = digitsWithoutCheck.length - 1; i >= 0; i--) {
    sum += Number(digitsWithoutCheck.charAt(i)) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * ตรวจบาร์โค้ดฝั่ง server ด้วย — ห้ามเชื่อฝั่งแอปอย่างเดียว เพราะใครก็ตามที่รู้ URL
 * และ token สามารถยิง API ตรงได้ ข้อมูลที่ผ่านเข้ามาต้องถูกตรวจซ้ำเสมอ
 */
function validateBarcode_(raw) {
  var text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, reason: 'ยังไม่ได้กรอกบาร์โค้ด' };
  if (!/^\d+$/.test(text)) return { ok: false, reason: 'บาร์โค้ดต้องเป็นตัวเลขล้วน' };

  var normalized = text.length === 12 ? '0' + text : text;
  if (normalized.length !== 8 && normalized.length !== 13) {
    return { ok: false, reason: 'ความยาว ' + text.length + ' หลักไม่ถูกต้อง' };
  }

  var expected = gs1CheckDigit_(normalized.slice(0, -1));
  var actual = Number(normalized.charAt(normalized.length - 1));
  if (expected !== actual) {
    return { ok: false, reason: 'หลักตรวจสอบไม่ถูกต้อง (ควรลงท้ายด้วย ' + expected + ')' };
  }
  return { ok: true, normalized: normalized };
}

/**
 * payload = { sku, barcode, userId }
 */
function handleSetBarcode_(payload) {
  var sku = String(payload.sku || '').trim();
  if (!sku) return { ok: false, error: 'ต้องระบุ sku' };

  var check = validateBarcode_(payload.barcode);
  if (!check.ok) return { ok: false, error: check.reason };
  var barcode = check.normalized;

  return withLock_(function () {
    var productsSheet = getSheet_(SHEET_NAMES.PRODUCTS);
    var products = sheetToObjects_(productsSheet);

    var target = null;
    for (var i = 0; i < products.length; i++) {
      if (String(products[i].SKU).trim() === sku) target = products[i];
      // บาร์โค้ดเดียวกันห้ามอยู่บนสินค้าคนละตัว ไม่งั้นยิงขายแล้วไม่รู้ว่าตัวไหน
      if (String(products[i].Barcode).trim() === barcode &&
          String(products[i].SKU).trim() !== sku) {
        return {
          ok: false,
          error: 'บาร์โค้ดนี้ถูกใช้กับ ' + products[i].SKU + ' (' + products[i].Name + ') แล้ว'
        };
      }
    }
    if (!target) return { ok: false, error: 'ไม่พบสินค้ารหัส ' + sku };

    var previous = String(target.Barcode || '').trim();
    if (previous === barcode) {
      return { ok: true, sku: sku, barcode: barcode, unchanged: true };
    }

    var rowIndex = findRowIndexByKey_(productsSheet, 'SKU', sku);
    setBarcodeCell_(productsSheet, rowIndex, barcode);

    appendCapture_({
      Timestamp: new Date(),
      SKU: sku,
      Barcode: barcode,
      PreviousBarcode: previous,
      UserId: payload.userId || ''
    });

    logActivity_(payload.userId, 'setBarcode', sku + ' -> ' + barcode + (previous ? ' (แทนที่ ' + previous + ')' : ''));

    return { ok: true, sku: sku, barcode: barcode, replaced: previous || null };
  });
}

/**
 * เขียนบาร์โค้ดลงเซลล์แบบบังคับให้เป็นข้อความ
 *
 * ถ้าปล่อยให้ Sheets เดาชนิดเอง มันจะมองบาร์โค้ดเป็นตัวเลข แล้วเกิดสองปัญหา:
 *   - เลข 0 นำหน้าหายไป (UPC-A ที่เติม 0 เป็น EAN-13 จะพัง)
 *   - ค่าถูกอ่านกลับมาเป็น float เช่น 8851959142011.0 ซึ่งยิงสแกนแล้วหาไม่เจอ
 */
function setBarcodeCell_(sheet, rowIndex, barcode) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colIndex = headers.indexOf('Barcode');
  if (colIndex === -1) throw new Error('ไม่พบคอลัมน์ Barcode ในชีต Products');
  var cell = sheet.getRange(rowIndex, colIndex + 1);
  cell.setNumberFormat('@');
  cell.setValue(barcode);
}

/**
 * ต่อท้ายชีต BarcodeCaptures สร้างชีตให้อัตโนมัติถ้ายังไม่มี
 * ชีตนี้เป็นบันทึกถาวรของสิ่งที่พนักงานยิงจริง ใช้ merge กลับเข้าต้นทางภายหลัง
 */
function appendCapture_(record) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName('BarcodeCaptures');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('BarcodeCaptures');
    sheet.appendRow(['Timestamp', 'SKU', 'Barcode', 'PreviousBarcode', 'UserId']);
    sheet.setFrozenRows(1);
    // บังคับให้คอลัมน์บาร์โค้ดเป็นข้อความ ไม่งั้น Sheets จะแปลงเป็นตัวเลข
    // แล้วเลข 0 นำหน้าจะหายไป (UPC-A ที่เติม 0 เป็น EAN-13 จะพัง)
    sheet.getRange('C:C').setNumberFormat('@');
  }
  appendObject_(sheet, record);
}

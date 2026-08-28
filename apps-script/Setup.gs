/**
 * Setup.gs — ติดตั้งและตรวจสอบชีตให้พร้อมใช้งาน
 *
 * ทำไมต้องมี: การติดตั้งเดิมต้องสร้าง 6 ชีตพร้อมพิมพ์หัวคอลัมน์เองให้ตรงเป๊ะทุกตัว
 * พิมพ์ผิดตัวเดียว (เช่น "Barcode " มีช่องว่างท้าย) ระบบจะพังแบบหาสาเหตุยาก
 * เพราะโค้ดอ่านชีตด้วย "ชื่อคอลัมน์" ตรงๆ
 *
 * วิธีใช้ — เปิด Apps Script editor แล้วเลือกฟังก์ชันจากเมนูด้านบน กด Run:
 *   setupSheets()  สร้างชีตและหัวคอลัมน์ที่ยังขาด (ของเดิมไม่ถูกแตะ)
 *   checkSetup()   ตรวจว่าอะไรยังไม่พร้อม แล้วพิมพ์รายงานออกมาใน Execution log
 *
 * ทั้งสองฟังก์ชันปลอดภัยกับข้อมูลที่มีอยู่แล้ว: ไม่ลบชีต ไม่ลบแถว ไม่แก้ข้อมูล
 */

/** หัวคอลัมน์ที่โค้ดส่วนอื่นอ้างถึง — ต้องตรงกับ docs/SHEET_SCHEMA.md */
var REQUIRED_SHEETS = {
  Products: ['SKU', 'Barcode', 'Name', 'Category', 'Unit', 'Cost', 'RetailPrice',
             'WholesalePrice', 'WholesaleMinQty', 'StockQty', 'ReorderPoint', 'Active'],
  Sales: ['SaleID', 'ClientSaleId', 'Timestamp', 'CashierId', 'CustomerName',
          'Subtotal', 'Discount', 'Total', 'PaymentMethod', 'Status'],
  SaleItems: ['SaleID', 'SKU', 'ProductName', 'Qty', 'UnitPrice', 'LineTotal'],
  StockMovements: ['Timestamp', 'SKU', 'ChangeQty', 'Reason', 'RefSaleID', 'UserId'],
  Staff: ['UserId', 'Name', 'PinHash', 'Role', 'Active'],
  Settings: ['Key', 'Value'],
  BarcodeCaptures: ['Timestamp', 'SKU', 'Barcode', 'PreviousBarcode', 'UserId']
};

/** คอลัมน์ที่ต้องบังคับเป็นข้อความ ไม่งั้น Sheets จะกลืนเลข 0 นำหน้าหรือแปลงเป็น float */
var TEXT_COLUMNS = {
  Products: ['Barcode', 'SKU'],
  BarcodeCaptures: ['Barcode', 'PreviousBarcode'],
  SaleItems: ['SKU'],
  StockMovements: ['SKU']
};

/**
 * สร้างชีตและหัวคอลัมน์ที่ยังขาด — รันซ้ำได้ ไม่กระทบข้อมูลเดิม
 */
function setupSheets() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var created = [];
  var headersAdded = [];

  Object.keys(REQUIRED_SHEETS).forEach(function (name) {
    var headers = REQUIRED_SHEETS[name];
    var sheet = spreadsheet.getSheetByName(name);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      created.push(name);
    }

    var lastColumn = sheet.getLastColumn();
    var existing = lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (h) { return String(h).trim(); })
      : [];

    if (!existing.join('')) {
      // ชีตว่างเปล่า — ใส่หัวคอลัมน์ครบชุดได้เลย
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      headersAdded.push(name + ' (ทั้งแถว)');
    } else {
      // มีหัวคอลัมน์อยู่แล้ว — เติมเฉพาะตัวที่ขาด ต่อท้าย ไม่สลับตำแหน่งของเดิม
      // เพราะสูตรหรือ filter ที่ผู้ใช้ตั้งไว้อาจอ้างตำแหน่งคอลัมน์อยู่
      var missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
      if (missing.length) {
        sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
        sheet.getRange(1, existing.length + 1, 1, missing.length).setFontWeight('bold');
        headersAdded.push(name + ': ' + missing.join(', '));
      }
    }

    applyTextFormat_(sheet, name);
  });

  var lines = ['=== ผลการติดตั้งชีต ==='];
  lines.push(created.length ? 'สร้างชีตใหม่: ' + created.join(', ') : 'ไม่มีชีตที่ต้องสร้างใหม่');
  lines.push(headersAdded.length ? 'เพิ่มหัวคอลัมน์: ' + headersAdded.join(' | ') : 'หัวคอลัมน์ครบอยู่แล้ว');
  lines.push('');
  lines.push('ขั้นต่อไป: ตั้ง API_TOKEN ใน Project Settings > Script Properties');
  lines.push('แล้วรัน checkSetup() เพื่อตรวจความพร้อมทั้งหมด');

  var report = lines.join('\n');
  Logger.log(report);
  return report;
}

/** บังคับรูปแบบเซลล์เป็นข้อความในคอลัมน์ที่ห้ามให้ Sheets เดาชนิดเอง */
function applyTextFormat_(sheet, sheetName) {
  var columns = TEXT_COLUMNS[sheetName];
  if (!columns || sheet.getLastColumn() === 0) return;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });

  columns.forEach(function (columnName) {
    var index = headers.indexOf(columnName);
    if (index === -1) return;
    // ตั้งแต่แถว 2 ลงไป ไม่รวมหัวคอลัมน์
    sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
  });
}

/**
 * ตรวจความพร้อมทั้งหมด แล้วบอกให้ชัดว่าอะไรยังขาด
 *
 * ตรวจสิ่งที่ทำให้ระบบใช้งานไม่ได้จริงเท่านั้น ไม่ใช่แค่ว่าชีตมีอยู่ไหม
 */
function checkSetup() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var problems = [];
  var notes = [];

  // 1. ชีตและหัวคอลัมน์
  Object.keys(REQUIRED_SHEETS).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      problems.push('ไม่มีชีต "' + name + '" — รัน setupSheets() เพื่อสร้าง');
      return;
    }
    if (sheet.getLastColumn() === 0) {
      problems.push('ชีต "' + name + '" ยังไม่มีหัวคอลัมน์ — รัน setupSheets()');
      return;
    }
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var missing = REQUIRED_SHEETS[name].filter(function (h) { return headers.indexOf(h) === -1; });
    if (missing.length) {
      problems.push('ชีต "' + name + '" ขาดคอลัมน์: ' + missing.join(', ') + ' — รัน setupSheets()');
    }
  });

  // 2. API token — ถ้าไม่มี แอปเรียกอะไรไม่ได้เลย
  var token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!token) {
    problems.push('ยังไม่ได้ตั้ง API_TOKEN ใน Project Settings > Script Properties');
  } else if (token.length < 16) {
    problems.push('API_TOKEN สั้นเกินไป (' + token.length + ' ตัวอักษร) — ควรยาวอย่างน้อย 16 ตัว');
  }

  // 3. พนักงานอย่างน้อยหนึ่งคน ไม่งั้นล็อกอินไม่ได้
  var staffSheet = spreadsheet.getSheetByName('Staff');
  if (staffSheet && staffSheet.getLastColumn() > 0) {
    var staff = sheetToObjects_(staffSheet);
    var active = staff.filter(function (s) { return s.Active === true && s.PinHash; });
    if (!active.length) {
      problems.push('ยังไม่มีพนักงานที่ใช้งานได้ในชีต Staff (ต้องมี PinHash และ Active = TRUE)');
    }
    var plainPins = staff.filter(function (s) {
      return s.PinHash && String(s.PinHash).length < 40;
    });
    if (plainPins.length) {
      problems.push('พบ PinHash ที่สั้นผิดปกติ ' + plainPins.length + ' แถว — ต้องเก็บเป็นค่า SHA-256 ไม่ใช่ตัวเลข PIN ตรงๆ');
    }
  }

  // 4. สินค้า — ไม่ถึงกับพัง แต่ต้องรู้
  var productsSheet = spreadsheet.getSheetByName('Products');
  if (productsSheet && productsSheet.getLastColumn() > 0) {
    var products = sheetToObjects_(productsSheet);
    if (!products.length) {
      problems.push('ยังไม่มีสินค้าในชีต Products — วาง build/sheet_products.csv ลงไปก่อน');
    } else {
      var withBarcode = products.filter(function (p) { return String(p.Barcode || '').trim(); });
      var withStock = products.filter(function (p) { return Number(p.StockQty) > 0; });
      notes.push('สินค้า ' + products.length + ' รายการ');
      notes.push('มีบาร์โค้ด ' + withBarcode.length + ' รายการ (ที่เหลือยิงขายไม่ได้ ใช้แท็บ "เก็บบาร์โค้ด")');
      notes.push('มียอดคงเหลือมากกว่า 0 อยู่ ' + withStock.length + ' รายการ (ที่เหลือขายไม่ได้จนกว่าจะตรวจนับ)');

      var duplicates = findDuplicateBarcodes_(products);
      if (duplicates.length) {
        problems.push('บาร์โค้ดซ้ำกัน: ' + duplicates.join('; ') + ' — ยิงขายแล้วจะได้สินค้าผิดตัว');
      }
    }
  }

  // 5. ชื่อร้านสำหรับใบเสร็จ
  var settingsSheet = spreadsheet.getSheetByName('Settings');
  if (settingsSheet && settingsSheet.getLastColumn() > 0) {
    var settings = getSettings_();
    if (!settings.ShopName) {
      notes.push('ยังไม่ได้ตั้ง ShopName ในชีต Settings — ใบเสร็จจะขึ้นว่า "sinthaiPOS"');
    }
  }

  var lines = ['=== ผลตรวจความพร้อม ==='];
  if (problems.length) {
    lines.push('พบปัญหา ' + problems.length + ' ข้อ ที่ต้องแก้ก่อนใช้งาน:');
    problems.forEach(function (p, i) { lines.push('  ' + (i + 1) + '. ' + p); });
  } else {
    lines.push('พร้อมใช้งาน ไม่พบปัญหาที่ทำให้ระบบทำงานไม่ได้');
  }
  if (notes.length) {
    lines.push('');
    lines.push('ข้อมูลปัจจุบัน:');
    notes.forEach(function (n) { lines.push('  - ' + n); });
  }

  var report = lines.join('\n');
  Logger.log(report);
  return report;
}

function findDuplicateBarcodes_(products) {
  var seen = {};
  var duplicates = [];
  products.forEach(function (p) {
    var barcode = String(p.Barcode || '').trim();
    if (!barcode) return;
    if (seen[barcode]) {
      duplicates.push(barcode + ' (' + seen[barcode] + ' และ ' + p.SKU + ')');
    } else {
      seen[barcode] = p.SKU;
    }
  });
  return duplicates;
}

/**
 * ช่วยสร้าง PinHash สำหรับพนักงานใหม่
 *
 * เดิมต้องไปเปิด console ของเบราว์เซอร์แล้วรัน crypto.subtle เอง ซึ่งยุ่งยากและ
 * ทำให้หลายคนเผลอเก็บ PIN เป็นตัวเลขตรงๆ ในชีตแทน
 *
 * วิธีใช้: แก้เลข PIN ในบรรทัดล่าง แล้ว Run ฟังก์ชันนี้ ค่า hash จะอยู่ใน Execution log
 */
function makePinHash() {
  var pin = '1234';   // <-- เปลี่ยนเป็น PIN ที่ต้องการ แล้วกด Run
  var hash = hashPin_(pin);
  Logger.log('PIN: ' + pin + '\nPinHash (คัดลอกค่านี้ไปใส่ในชีต Staff): ' + hash);
  return hash;
}

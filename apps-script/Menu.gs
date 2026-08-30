/**
 * Menu.gs — เมนูในตัว Google Sheet สำหรับเจ้าของร้าน
 *
 * ทำไมต้องมี: เครื่องมือตรวจสอบข้อมูลเดิมอยู่ในสคริปต์ Python ที่ต้องรันจาก terminal
 * ซึ่งเจ้าของร้านทำเองไม่ได้ ผลคือคนที่ต้องใช้ข้อมูลมากที่สุดกลับเข้าไม่ถึงมัน
 *
 * ไฟล์นี้ย้ายงานทั้งหมดที่เจ้าของร้านต้องทำเองมาไว้ในเมนูของ Google Sheet
 * — ที่ที่เขาทำงานอยู่แล้วทุกวัน ไม่ต้องเรียนรู้อะไรใหม่ ไม่ต้องแตะ terminal/GitHub
 *
 * เมนูจะโผล่เองทุกครั้งที่เปิดไฟล์ชีต (ฟังก์ชัน onOpen ของ Apps Script)
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🏪 sinthaiPOS')
    .addItem('🔍 ตรวจสอบข้อมูลสินค้า', 'validateCatalog')
    .addItem('➕ เพิ่มสินค้าใหม่', 'addNewProductRow')
    .addSeparator()
    .addItem('⚙️ ตรวจความพร้อมระบบ', 'showSetupCheck')
    .addToUi();
}

var ISSUE_SHEET = 'ตรวจสอบข้อมูล';

/**
 * ระดับความเร่งด่วน เรียงจากมากไปน้อย — ใช้จัดลำดับในรายงาน
 * เจ้าของร้านมีเวลาจำกัด ต้องเห็นเรื่องที่ทำให้เสียเงินก่อนเรื่องที่แค่ไม่สะดวก
 */
var SEVERITY = { เสียเงิน: 1, ขายไม่ได้: 2, ต้องแก้: 3, ควรทำ: 4 };

/**
 * ปัญหาชนิดเดียวกันที่เกินจำนวนนี้จะยุบเหลือบรรทัดสรุปบรรทัดเดียว
 *
 * ทำไมต้องยุบ: ข้อมูลจริงของร้านให้ผลออกมา 429 บรรทัด โดย 269 บรรทัดเป็น
 * "ไม่มีบาร์โค้ด" กับ "ไม่รู้ต้นทุน" ซึ่งเป็นงานที่รู้อยู่แล้วว่าต้องทยอยเก็บทั้งร้าน
 * ถ้าไล่ทีละบรรทัด เรื่องที่ทำให้ขาดทุนจริง 6 รายการจะจมหายไปจนไม่มีใครเห็น
 */
var COLLAPSE_THRESHOLD = 20;

/**
 * ตรวจข้อมูลในแผ่น Products แล้วบอกว่าอะไรผิดและควรทำอย่างไร
 *
 * แยกตรรกะออกจากการเขียนชีต เพื่อให้ทดสอบได้โดยไม่ต้องมี UI
 */
function findCatalogIssues_(products) {
  var issues = [];
  var seenBarcode = {};
  var seenSku = {};

  products.forEach(function (p) {
    var sku = String(p.SKU || '').trim();
    var name = String(p.Name || '').trim();
    var barcode = String(p.Barcode || '').trim();
    var cost = p.Cost === '' || p.Cost === null ? null : Number(p.Cost);
    var retail = p.RetailPrice === '' || p.RetailPrice === null ? null : Number(p.RetailPrice);
    var stock = Number(p.StockQty) || 0;

    if (!sku) {
      issues.push({ level: 'ต้องแก้', sku: '(ว่าง)', name: name,
        kind: 'no_sku', problem: 'ไม่มีรหัส SKU', fix: 'ใส่รหัสสินค้า ห้ามเว้นว่าง' });
      return;
    }

    if (seenSku[sku]) {
      issues.push({ level: 'ต้องแก้', sku: sku, name: name,
        kind: 'dup_sku', problem: 'รหัส SKU ซ้ำกับ "' + seenSku[sku] + '"',
        fix: 'เปลี่ยนรหัสให้ไม่ซ้ำ ไม่งั้นระบบตัดสต็อกผิดตัว' });
    } else {
      seenSku[sku] = name;
    }

    // ขายต่ำกว่าทุน — ยิ่งขายยิ่งเสียเงิน เร่งด่วนที่สุด
    if (cost !== null && retail !== null && retail < cost) {
      issues.push({ level: 'เสียเงิน', sku: sku, name: name,
        kind: 'below_cost', problem: 'ขาย ' + retail + ' แต่ทุน ' + cost + ' (ขาดทุนตัวละ ' + (cost - retail) + ')',
        fix: 'ขึ้นราคาเป็นอย่างน้อย ' + Math.ceil(cost * 1.12) + ' หรือเลิกขาย' });
    }

    // ไม่มีราคาขาย — คิดเงินไม่ได้เลย
    if (retail === null || isNaN(retail)) {
      issues.push({ level: 'ขายไม่ได้', sku: sku, name: name,
        kind: 'no_price', problem: 'ไม่มีราคาขาย', fix: 'ใส่ราคาในคอลัมน์ RetailPrice' });
    }

    // ไม่มีบาร์โค้ด — ยิงขายหน้าเคาน์เตอร์ไม่ได้
    if (!barcode) {
      issues.push({ level: 'ควรทำ', sku: sku, name: name,
        kind: 'no_barcode', problem: 'ไม่มีบาร์โค้ด', fix: 'ใช้แท็บ "เก็บบาร์โค้ด" ในแอปเดินยิงจากตัวสินค้าจริง' });
    } else {
      var check = validateBarcode_(barcode);
      if (!check.ok) {
        issues.push({ level: 'ต้องแก้', sku: sku, name: name,
          kind: 'bad_barcode', problem: 'บาร์โค้ดไม่ถูกต้อง: ' + check.reason,
          fix: 'ยิงใหม่จากตัวสินค้าจริงผ่านแท็บ "เก็บบาร์โค้ด"' });
      }
      if (seenBarcode[barcode]) {
        issues.push({ level: 'ต้องแก้', sku: sku, name: name,
          kind: 'dup_barcode', problem: 'บาร์โค้ดซ้ำกับ ' + seenBarcode[barcode],
          fix: 'ยิงขายแล้วจะได้สินค้าผิดตัว ต้องแก้ให้เหลือตัวเดียว' });
      } else {
        seenBarcode[barcode] = sku;
      }
    }

    // ไม่รู้ต้นทุน — ขายได้แต่ไม่รู้ว่ากำไรหรือขาดทุน
    if (cost === null || isNaN(cost)) {
      issues.push({ level: 'ควรทำ', sku: sku, name: name,
        kind: 'no_cost', problem: 'ไม่รู้ต้นทุน', fix: 'เก็บราคา Makro แล้วใส่ในคอลัมน์ Cost' });
    }

    // สต็อกเป็น 0 — ระบบจะไม่ยอมให้ขาย
    if (stock === 0) {
      issues.push({ level: 'ขายไม่ได้', sku: sku, name: name,
        kind: 'no_stock', problem: 'สต็อกเป็น 0', fix: 'ใช้แท็บ "ตรวจนับ" ในแอปกรอกจำนวนที่นับได้จริง' });
    }
  });

  issues.sort(function (a, b) {
    var d = SEVERITY[a.level] - SEVERITY[b.level];
    return d !== 0 ? d : String(a.sku).localeCompare(String(b.sku));
  });
  return issues;
}

/** นับจำนวนปัญหาแยกตามระดับ ใช้ทำสรุปหัวรายงาน */
function summarizeIssues_(issues) {
  var counts = {};
  issues.forEach(function (i) { counts[i.level] = (counts[i.level] || 0) + 1; });
  return counts;
}

/**
 * ยุบปัญหาชนิดที่เจอเยอะให้เหลือบรรทัดสรุปบรรทัดเดียว
 *
 * เก็บทุกบรรทัดของปัญหาที่ต้องแก้เป็นรายตัว (ขาดทุน/บาร์โค้ดซ้ำ/ไม่มีราคา) ไว้ครบ
 * แต่ยุบงานที่รู้อยู่แล้วว่าต้องทยอยทำทั้งร้าน (ไม่มีบาร์โค้ด/ไม่รู้ต้นทุน/ยังไม่ได้นับ)
 * เพราะการไล่ 139 บรรทัดว่า "ตัวนี้ก็ไม่มีบาร์โค้ด" ไม่ได้ช่วยให้ตัดสินใจอะไรเพิ่ม
 */
function collapseBulkIssues_(issues) {
  var byKind = {};
  issues.forEach(function (i) {
    (byKind[i.kind] = byKind[i.kind] || []).push(i);
  });

  var out = [];
  var collapsed = {};
  issues.forEach(function (i) {
    var group = byKind[i.kind];
    if (group.length <= COLLAPSE_THRESHOLD) {
      out.push(i);
      return;
    }
    if (collapsed[i.kind]) return;
    collapsed[i.kind] = true;
    out.push({
      level: i.level,
      sku: group.length + ' รายการ',
      name: '(ดูรายชื่อในแผ่น Products)',
      kind: i.kind,
      problem: i.problem + ' — รวม ' + group.length + ' รายการ',
      fix: i.fix
    });
  });
  return out;
}

function validateCatalog() {
  var ui = SpreadsheetApp.getUi();
  var products = sheetToObjects_(getSheet_(SHEET_NAMES.PRODUCTS));

  if (!products.length) {
    ui.alert('ยังไม่มีสินค้าในแผ่น Products');
    return;
  }

  var issues = findCatalogIssues_(products);
  writeIssueSheet_(products.length, issues);

  var counts = summarizeIssues_(issues);
  var lines = ['ตรวจสินค้า ' + products.length + ' รายการ', ''];
  if (!issues.length) {
    lines.push('ไม่พบปัญหา ข้อมูลพร้อมขายทุกรายการ');
  } else {
    ['เสียเงิน', 'ขายไม่ได้', 'ต้องแก้', 'ควรทำ'].forEach(function (level) {
      if (counts[level]) lines.push(level + ': ' + counts[level] + ' รายการ');
    });
    lines.push('', 'รายละเอียดอยู่ในแผ่น "' + ISSUE_SHEET + '"');
  }
  ui.alert('ผลตรวจสอบข้อมูล', lines.join('\n'), ui.ButtonSet.OK);
}

/** เขียนผลตรวจลงแผ่นแยก เพื่อให้พิมพ์พกไปแก้หน้าร้านได้ */
function writeIssueSheet_(productCount, issues) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(ISSUE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(ISSUE_SHEET);
  } else if (sheet.getLastRow() > 0) {
    // ล้างของเดิมก่อน ไม่งั้นปัญหาที่แก้ไปแล้วจะค้างอยู่จนเข้าใจผิด
    sheet.getRange(1, 1, sheet.getLastRow(), Math.max(sheet.getLastColumn(), 1)).clearContent();
  }

  var rows = [['ระดับ', 'SKU', 'ชื่อสินค้า', 'ปัญหา', 'ควรทำอย่างไร']];
  collapseBulkIssues_(issues).forEach(function (i) {
    rows.push([i.level, i.sku, i.name, i.problem, i.fix]);
  });
  if (issues.length === 0) {
    rows.push(['-', '-', '-', 'ไม่พบปัญหา', 'ข้อมูลพร้อมขายทุกรายการ']);
  }

  sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * เพิ่มแถวสินค้าใหม่พร้อมรหัส SKU ที่ไม่ซ้ำกับของเดิม
 *
 * ทำไมไม่ให้พิมพ์เอง: รหัสซ้ำทำให้ระบบตัดสต็อกผิดตัวโดยไม่มีอะไรเตือน และเป็นความผิดพลาด
 * ที่เกิดง่ายมากเมื่อมีสินค้าหลายร้อยรายการ ให้ระบบออกให้จึงปลอดภัยกว่า
 */
function nextSkuCode_(products) {
  var maxNumber = 0;
  products.forEach(function (p) {
    var match = String(p.SKU || '').match(/^SKU(\d+)$/);
    if (match) maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
  });
  return 'SKU' + String(maxNumber + 1).padStart(4, '0');
}

function addNewProductRow() {
  var ui = SpreadsheetApp.getUi();
  var sheet = getSheet_(SHEET_NAMES.PRODUCTS);
  var products = sheetToObjects_(sheet);
  var sku = nextSkuCode_(products);

  appendObject_(sheet, {
    SKU: sku,
    Barcode: '',
    Name: '',
    Category: '',
    Unit: 'ชิ้น',
    Cost: '',
    RetailPrice: '',
    WholesalePrice: '',
    WholesaleMinQty: 5,
    StockQty: 0,
    ReorderPoint: 3,
    Active: true
  });

  ui.alert(
    'เพิ่มสินค้าใหม่แล้ว',
    'รหัส: ' + sku + ' (แถวที่ ' + sheet.getLastRow() + ')\n\n' +
    'กรอกให้ครบก่อนเปิดขาย:\n' +
    '  • Name — ชื่อสินค้า\n' +
    '  • RetailPrice — ราคาขาย (ไม่ใส่จะขายไม่ได้)\n' +
    '  • Cost — ต้นทุนจาก Makro (ไม่ใส่จะไม่รู้กำไร)\n\n' +
    'บาร์โค้ดกับสต็อก ใช้แท็บ "เก็บบาร์โค้ด" และ "ตรวจนับ" ในแอป',
    ui.ButtonSet.OK
  );
}

/** แสดงผล checkSetup() เป็นกล่องข้อความ แทนที่จะต้องเปิด Execution log อ่านเอง */
function showSetupCheck() {
  var ui = SpreadsheetApp.getUi();
  ui.alert('ความพร้อมของระบบ', checkSetup(), ui.ButtonSet.OK);
}

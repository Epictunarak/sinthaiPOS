/**
 * Utils.gs — helper functions shared by every endpoint.
 *
 * Sheet access, JSON (de)serialization, auth token check, and PIN hashing
 * live here so the action handlers (Products.gs, Sales.gs, Auth.gs) stay
 * focused on business logic.
 */

var SHEET_NAMES = {
  PRODUCTS: 'Products',
  SALES: 'Sales',
  SALE_ITEMS: 'SaleItems',
  STOCK_MOVEMENTS: 'StockMovements',
  STAFF: 'Staff',
  SETTINGS: 'Settings',
  ACTIVITY_LOGS: 'ActivityLogs'
};

function getSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('ไม่พบชีตชื่อ "' + name + '" — ตรวจสอบ docs/SHEET_SCHEMA.md');
  }
  return sheet;
}

/** อ่านทั้งชีตเป็น array ของ object โดยใช้แถวแรกเป็นชื่อคอลัมน์ */
function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = values.slice(1);
  return rows
    .filter(function (row) {
      return row.some(function (cell) { return cell !== '' && cell !== null; });
    })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

/** หา row index (1-based, รวม header) ของแถวที่คอลัมน์ keyName == keyValue */
function findRowIndexByKey_(sheet, keyName, keyValue) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var colIndex = headers.indexOf(keyName);
  if (colIndex === -1) throw new Error('ไม่พบคอลัมน์ "' + keyName + '"');
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][colIndex]) === String(keyValue)) return r + 1;
  }
  return -1;
}

/** ต่อแถวใหม่ท้ายชีต โดยรับ object แล้วเรียงค่าตามหัวคอลัมน์ปัจจุบันของชีตให้เอง */
function appendObject_(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
  sheet.appendRow(row);
}

/** อัปเดตค่าบางคอลัมน์ของแถวที่ระบุ (rowIndex เป็น 1-based รวม header) */
function updateRowFields_(sheet, rowIndex, fields) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(fields).forEach(function (key) {
    var colIndex = headers.indexOf(key);
    if (colIndex !== -1) {
      sheet.getRange(rowIndex, colIndex + 1).setValue(fields[key]);
    }
  });
}

/**
 * อ่านชีต Settings เป็น object เดียว เช่น { ShopName: 'สินไทยพาณิชย์', ... }
 * ใช้กับหัวใบเสร็จและข้อความท้ายบิล
 */
function getSettings_() {
  var settings = {};
  sheetToObjects_(getSheet_(SHEET_NAMES.SETTINGS)).forEach(function (row) {
    var key = String(row.Key || '').trim();
    if (key) settings[key] = row.Value;
  });
  return settings;
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(message) {
  return jsonResponse_({ ok: false, error: message });
}

/**
 * Token กันคนสุ่มยิง URL ของ Web App เข้ามาแก้ข้อมูล
 * ตั้งค่าได้ที่ Project Settings > Script Properties > API_TOKEN
 * (ดูวิธีตั้งใน README.md ของ apps-script/)
 */
function checkToken_(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!expected) {
    throw new Error('ยังไม่ได้ตั้งค่า API_TOKEN ใน Script Properties');
  }
  if (token !== expected) {
    throw new Error('token ไม่ถูกต้อง');
  }
}

/** hash PIN ด้วย SHA-256 (ไม่เก็บ PIN แบบ plain text ใน Sheet) */
function hashPin_(pin) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin));
  return digest.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

function generateId_(prefix) {
  return prefix + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 10000);
}

/**
 * บันทึกกิจกรรมที่แก้ไขข้อมูลไว้ในชีต ActivityLogs เพื่อตรวจย้อนหลังได้ว่า
 * ใครทำอะไร เมื่อไหร่ — เรียกเฉพาะตอนข้อมูลเปลี่ยนจริง ไม่ใช่ทุกครั้งที่เรียก API
 * (เช่น ตรวจนับแล้วจำนวนไม่ต่างจากเดิมไม่ถือเป็นกิจกรรมที่ต้องบันทึก)
 */
function logActivity_(userId, action, details) {
  appendObject_(getSheet_(SHEET_NAMES.ACTIVITY_LOGS), {
    Timestamp: new Date(),
    UserId: userId || '',
    Action: action,
    Details: details || ''
  });
}

/** ใช้ LockService กันสองเครื่องขายพร้อมกันแล้วตัดสต็อกชนกัน */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * harness.mjs — รันโค้ด Apps Script (.gs) ใน Node โดยจำลอง API ของ Google
 *
 * ทำไมต้องมี: โค้ดฝั่ง Apps Script ทดสอบยากเพราะต้องรันบน Google เท่านั้น แต่ส่วนที่
 * เสี่ยงที่สุดคือ "ขั้นตอนติดตั้ง" — ถ้าสร้างชีตหรือหัวคอลัมน์ผิด ระบบจะพังตั้งแต่ก้าวแรก
 * และคนติดตั้งจะไม่รู้ว่าผิดตรงไหน
 *
 * ตัวจำลองนี้ทำเฉพาะส่วนที่โค้ดเราใช้จริง ไม่ได้จำลอง Sheets ทั้งหมด
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** ชีตจำลอง เก็บข้อมูลเป็น array 2 มิติเหมือน Sheets จริง */
class FakeSheet {
  constructor(name, rows = []) {
    this.name = name;
    this.rows = rows.map((r) => [...r]);
    this.numberFormats = {};
    this.frozenRows = 0;
  }

  getName() { return this.name; }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  getLastRow() { return this.rows.length; }
  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }
  setFrozenRows(n) { this.frozenRows = n; }

  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const source = sheet.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) {
            const value = source[col - 1 + c];
            line.push(value === undefined ? '' : value);
          }
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        values.forEach((line, r) => {
          const target = row - 1 + r;
          while (sheet.rows.length <= target) sheet.rows.push([]);
          line.forEach((value, c) => { sheet.rows[target][col - 1 + c] = value; });
        });
        return this;
      },
      getValue() { return this.getValues()[0][0]; },
      setValue(value) { return this.setValues([[value]]); },
      clearContent() {
        for (let r = 0; r < numRows; r++) {
          const target = sheet.rows[row - 1 + r];
          if (!target) continue;
          for (let c = 0; c < numCols; c++) target[col - 1 + c] = '';
        }
        // แถวที่ถูกล้างจนว่างหมดต้องหายไปจริง ไม่ใช่เหลือแถวว่างค้างไว้
        while (sheet.rows.length && sheet.rows[sheet.rows.length - 1].every((v) => v === '')) {
          sheet.rows.pop();
        }
        return this;
      },
      setNumberFormat(format) {
        sheet.numberFormats[`${row},${col},${numRows},${numCols}`] = format;
        return this;
      },
      setFontWeight() { return this; }
    };
  }

  getDataRange() {
    const rows = Math.max(this.rows.length, 1);
    return this.getRange(1, 1, rows, Math.max(this.getLastColumn(), 1));
  }

  appendRow(values) { this.rows.push([...values]); }
}

class FakeSpreadsheet {
  constructor(sheets = {}) {
    this.sheets = new Map();
    Object.entries(sheets).forEach(([name, rows]) => {
      this.sheets.set(name, new FakeSheet(name, rows));
    });
  }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

/**
 * โหลดไฟล์ .gs ที่ระบุเข้า sandbox พร้อม stub ของ Google APIs
 * คืน context ที่เรียกฟังก์ชันใน .gs ได้ตรงๆ
 */
export function loadAppsScript(fileNames, { sheets = {}, scriptProperties = {} } = {}) {
  const spreadsheet = new FakeSpreadsheet(sheets);
  const logs = [];
  const alerts = [];
  const menus = [];
  const properties = { ...scriptProperties };

  const context = {
    spreadsheet,
    logs,
    alerts,
    menus,
    properties,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      // เก็บกล่องข้อความและเมนูที่โค้ดสร้างไว้ให้เทสต์ตรวจได้ ของจริงเป็น UI ที่อ่านค่าไม่ได้
      getUi: () => ({
        alert: (...args) => { alerts.push(args.length === 1 ? args[0] : args.slice(0, 2).join('\n')); },
        ButtonSet: { OK: 'OK' },
        createMenu: (name) => {
          const menu = { name, items: [] };
          menus.push(menu);
          const builder = {
            addItem: (caption, fn) => { menu.items.push({ caption, fn }); return builder; },
            addSeparator: () => { menu.items.push({ separator: true }); return builder; },
            addToUi: () => menu
          };
          return builder;
        }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in properties ? properties[key] : null),
        setProperty: (key, value) => { properties[key] = value; }
      })
    },
    Logger: { log: (message) => logs.push(String(message)) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_algorithm, text) => {
        const digest = crypto.createHash('sha256').update(String(text), 'utf8').digest();
        // Apps Script คืนค่าเป็น byte แบบมีเครื่องหมาย (-128..127)
        return Array.from(digest).map((b) => (b > 127 ? b - 256 : b));
      },
      formatDate: (date, _tz, format) => {
        const d = new Date(date);
        const pad = (n) => String(n).padStart(2, '0');
        if (format === 'yyyy-MM-dd') {
          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      // เก็บข้อความที่ตอบกลับไว้ให้เทสต์อ่านได้ ของจริงคืน TextOutput ที่อ่านค่าไม่ได้ตรงๆ
      createTextOutput: (text) => {
        const output = {
          getContent: () => text,
          setMimeType() { return output; }
        };
        return output;
      }
    },
    console
  };

  vm.createContext(context);
  for (const name of fileNames) {
    const code = fs.readFileSync(path.join(ROOT, 'apps-script', name), 'utf8');
    vm.runInContext(code, context, { filename: name });
  }
  return context;
}

/**
 * เรียก doGet / doPost แล้วแกะ JSON ที่ตอบกลับมาให้
 * ใช้ทดสอบ API จริงแบบเดียวกับที่แอปเรียก ไม่ใช่เรียกฟังก์ชันภายในตรงๆ
 */
export function apiGet(ctx, action, params = {}, token = 'test-token') {
  const response = ctx.doGet({ parameter: { action, token, ...params } });
  return JSON.parse(response.getContent());
}

export function apiPost(ctx, action, payload = {}, token = 'test-token') {
  const response = ctx.doPost({
    postData: { contents: JSON.stringify({ action, token, payload }) }
  });
  return JSON.parse(response.getContent());
}

export { FakeSheet, FakeSpreadsheet };

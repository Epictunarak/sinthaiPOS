/**
 * เทสต์การตรวจสอบบาร์โค้ด — รันด้วย: npm test (ใน web/)
 * ใช้ test runner ที่ติดมากับ Node เอง ไม่ต้องลง dependency เพิ่ม
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gs1CheckDigit,
  validateBarcode,
  isInternalBarcode,
  makeInternalBarcode
} from './barcode.js';

test('รับบาร์โค้ดจริงของสินค้าในร้าน', () => {
  // สองค่านี้คือบาร์โค้ดจริงที่มีอยู่ในชีต (Coke ลัง 24 และ Lay's แพ็ค 6)
  assert.equal(validateBarcode('8851959142011').ok, true);
  assert.equal(validateBarcode('8850718801015').ok, true);
});

test('ตัดบาร์โค้ดที่หลักตรวจสอบไม่ตรง', () => {
  // เปลี่ยนหลักสุดท้ายจาก 1 เป็น 2 — ต้องจับได้
  const result = validateBarcode('8851959142012');
  assert.equal(result.ok, false);
  assert.match(result.reason, /หลักตรวจสอบ/);
});

test('จับการพิมพ์สลับตัวเลขกลางบาร์โค้ด', () => {
  // 8851959142011 -> สลับ 14 เป็น 41 ตรงกลาง
  assert.equal(validateBarcode('8851959412011').ok, false);
});

test('แปลง UPC-A 12 หลักเป็น EAN-13 โดยเติม 0 ข้างหน้า', () => {
  // 036000291452 คือ UPC-A ตัวอย่างมาตรฐานที่หลักตรวจสอบถูกต้อง
  const result = validateBarcode('036000291452');
  assert.equal(result.ok, true);
  assert.equal(result.normalized, '0036000291452');
  assert.equal(result.normalized.length, 13);
});

test('ปฏิเสธความยาวที่ไม่รองรับ', () => {
  assert.equal(validateBarcode('12345').ok, false);
  assert.equal(validateBarcode('123456789012345').ok, false);
});

test('ปฏิเสธค่าที่ไม่ใช่ตัวเลขล้วนและค่าว่าง', () => {
  assert.equal(validateBarcode('885195914201X').ok, false);
  assert.equal(validateBarcode('').ok, false);
  assert.equal(validateBarcode(null).ok, false);
  assert.equal(validateBarcode('  ').ok, false);
});

test('ตัดช่องว่างหัวท้ายที่ติดมาจากเครื่องยิงบาร์โค้ด', () => {
  assert.equal(validateBarcode('  8851959142011  ').ok, true);
});

test('บาร์โค้ดภายในร้านขึ้นต้นด้วย 2 และหลักตรวจสอบถูกต้อง', () => {
  const code = makeInternalBarcode(1);
  assert.equal(code.length, 13);
  assert.equal(code[0], '2');
  assert.equal(validateBarcode(code).ok, true);
  assert.equal(isInternalBarcode(code), true);
});

test('บาร์โค้ดภายในแต่ละลำดับต้องไม่ซ้ำกัน', () => {
  const codes = new Set([1, 2, 3, 42, 999].map(makeInternalBarcode));
  assert.equal(codes.size, 5);
  for (const code of codes) assert.equal(validateBarcode(code).ok, true);
});

test('บาร์โค้ดสินค้าทั่วไปไม่ถูกนับเป็นบาร์โค้ดภายใน', () => {
  assert.equal(isInternalBarcode('8851959142011'), false);
});

test('หลักตรวจสอบคำนวณตรงตามมาตรฐาน GS1', () => {
  assert.equal(gs1CheckDigit('885195914201'), 1);
  assert.equal(gs1CheckDigit('885071880101'), 5);
});

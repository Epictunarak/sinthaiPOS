/**
 * barcode.js — ตรวจสอบความถูกต้องของบาร์โค้ดก่อนบันทึก
 *
 * ทำไมต้องตรวจ: บาร์โค้ดที่พิมพ์ผิดหนึ่งหลักจะกลายเป็นบาร์โค้ดของสินค้าอื่นได้
 * พอยิงขายจริงจะตัดสต็อกผิดตัวและคิดเงินผิดราคา ตัวเลขหลักสุดท้ายของ EAN/UPC
 * เป็น "หลักตรวจสอบ" (check digit) ที่คำนวณจากหลักที่เหลือ จึงดักพิมพ์ผิดได้เกือบทั้งหมด
 * ตั้งแต่ก่อนบันทึกลงฐานข้อมูล
 */

/**
 * คำนวณหลักตรวจสอบตามมาตรฐาน GS1 (ใช้ได้ทั้ง EAN-8, EAN-13, UPC-A)
 * วิธี: คูณน้ำหนัก 3 และ 1 สลับกันจากขวาไปซ้าย แล้วหาส่วนเติมเต็มของ 10
 */
export function gs1CheckDigit(digitsWithoutCheck) {
  let sum = 0;
  // ไล่จากขวาสุดของส่วนข้อมูล น้ำหนักตัวขวาสุดคือ 3 เสมอ
  for (let i = digitsWithoutCheck.length - 1, weight = 3; i >= 0; i--) {
    sum += Number(digitsWithoutCheck[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * ตรวจบาร์โค้ดหนึ่งค่า คืน { ok, normalized, reason }
 *
 * รองรับ EAN-13 (มาตรฐานสินค้าทั่วไปในไทย), EAN-8 (สินค้าชิ้นเล็ก),
 * และ UPC-A 12 หลัก (สินค้านำเข้าจากอเมริกา) ซึ่งจะถูกเติม 0 ข้างหน้าให้เป็น EAN-13
 * เพื่อให้เก็บในระบบเป็นรูปแบบเดียวกันทั้งหมด
 */
export function validateBarcode(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, reason: 'ยังไม่ได้กรอกบาร์โค้ด' };
  if (!/^\d+$/.test(text)) return { ok: false, reason: 'บาร์โค้ดต้องเป็นตัวเลขล้วน' };

  // UPC-A 12 หลัก คือ EAN-13 ที่ขึ้นต้นด้วย 0 — เก็บให้เป็นรูปแบบเดียวกัน
  const normalized = text.length === 12 ? '0' + text : text;

  if (![8, 13].includes(normalized.length)) {
    return {
      ok: false,
      reason: `ความยาว ${text.length} หลักไม่ถูกต้อง (รองรับ 8, 12 หรือ 13 หลัก)`
    };
  }

  const expected = gs1CheckDigit(normalized.slice(0, -1));
  const actual = Number(normalized[normalized.length - 1]);
  if (expected !== actual) {
    return {
      ok: false,
      reason: `หลักตรวจสอบไม่ถูกต้อง (ควรลงท้ายด้วย ${expected}) — น่าจะยิงพลาดหรือพิมพ์ผิด`
    };
  }

  return { ok: true, normalized };
}

/**
 * บาร์โค้ดที่ร้านออกใช้เองภายใน (สินค้าแบ่งขาย ของไม่มีบาร์โค้ดโรงงาน)
 * GS1 สงวนรหัสขึ้นต้นด้วย 2 ไว้ให้ร้านใช้ภายในโดยเฉพาะ ไม่ชนกับบาร์โค้ดสินค้าจริง
 */
export function isInternalBarcode(barcode) {
  return /^2/.test(String(barcode || ''));
}

/** สร้างบาร์โค้ดภายในแบบ EAN-13 จากเลขลำดับ เช่น 1 → 2000000000015 */
export function makeInternalBarcode(sequence) {
  const n = Number(sequence);
  if (!Number.isInteger(n) || n < 1 || n > 999999999999) {
    throw new Error('ลำดับต้องเป็นจำนวนเต็มบวก');
  }
  const body = ('2' + String(n).padStart(11, '0')).slice(0, 12);
  return body + gs1CheckDigit(body);
}

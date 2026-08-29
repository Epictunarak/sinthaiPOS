/**
 * stock.js — ตัวช่วยเล็กๆ เกี่ยวกับยอดคงเหลือ ใช้ร่วมกันหลายหน้า
 */

/**
 * เขียนยอดคงเหลือใหม่ลงสินค้าเฉพาะเมื่อค่าที่ได้กลับมาเป็นตัวเลขจริง
 *
 * ถ้า server ตอบมาโดยไม่มี stockQty (เช่น เวอร์ชัน backend เก่า หรือ endpoint ที่ยังไม่ได้
 * ส่งค่ากลับ) การเขียนทับตรงๆ จะทำให้ยอดกลายเป็น undefined แล้วหน้าจอจะแสดงคำว่า
 * "undefined" และที่แย่กว่านั้นคือถูกนับเป็น 0 จนระบบบอกว่าสินค้าหมด ทั้งที่ของยังอยู่เต็มชั้น
 * — เจอจริงตอนทดสอบหน้าสั่งซื้อ ซึ่งจะทำให้สั่งของซ้ำโดยไม่จำเป็น
 *
 * คืนค่า true เมื่ออัปเดตจริง
 */
export function applyStockQty(product, value) {
  if (!product) return false;
  // ต้องกัน null และสตริงว่างก่อนแปลงเป็นตัวเลข เพราะ Number(null) และ Number('')
  // ได้ 0 ซึ่งผ่านการเช็ก isFinite ไปได้ แล้วจะไปตั้งยอดคงเหลือเป็น 0 เงียบๆ
  // กลายเป็นบอกว่าสินค้าหมดทั้งที่ของยังอยู่
  if (value === null || value === undefined || value === '') return false;
  const qty = Number(value);
  if (!Number.isFinite(qty)) return false;
  product.StockQty = qty;
  return true;
}

/** อ่านตัวเลขจากค่าที่อาจว่างหรือเป็นข้อความ โดยไม่คืน NaN */
export function toQty(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

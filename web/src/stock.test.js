import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStockQty, toQty } from './stock.js';

test('เขียนยอดคงเหลือใหม่เมื่อ server ส่งตัวเลขกลับมา', () => {
  const product = { SKU: 'SKU0001', StockQty: 24 };
  assert.equal(applyStockQty(product, 18), true);
  assert.equal(product.StockQty, 18);
});

test('รับเลข 0 เป็นค่าที่ถูกต้อง (ของหมดจริง ไม่ใช่ค่าว่าง)', () => {
  const product = { StockQty: 5 };
  assert.equal(applyStockQty(product, 0), true);
  assert.equal(product.StockQty, 0);
});

test('ไม่ทับยอดเดิมเมื่อ server ไม่ส่งยอดกลับมา', () => {
  // เคสจริงที่เจอ: หน้าสั่งซื้อแสดง "undefined" แล้วนับว่าสินค้าหมด
  // ทั้งที่ของยังอยู่เต็มชั้น ซึ่งจะทำให้สั่งซื้อซ้ำโดยไม่จำเป็น
  for (const bad of [undefined, null, '', 'abc', NaN]) {
    const product = { StockQty: 24 };
    assert.equal(applyStockQty(product, bad), false, `ค่า ${JSON.stringify(bad)} ไม่ควรถูกเขียนทับ`);
    assert.equal(product.StockQty, 24);
  }
});

test('ไม่พังเมื่อไม่พบสินค้าในเครื่อง', () => {
  assert.equal(applyStockQty(undefined, 10), false);
  assert.equal(applyStockQty(null, 10), false);
});

test('toQty ไม่คืน NaN ให้ไปโผล่บนหน้าจอ', () => {
  assert.equal(toQty(12), 12);
  assert.equal(toQty('7'), 7);
  assert.equal(toQty(undefined), 0);
  assert.equal(toQty(''), 0);
  assert.equal(toQty('ไม่ใช่ตัวเลข'), 0);
});

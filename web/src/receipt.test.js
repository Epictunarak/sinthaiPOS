import test from 'node:test';
import assert from 'node:assert/strict';
import { totalsFor, money, formatThaiDateTime, receiptHtml } from './receipt.js';

const items = [
  { productName: 'ยูโร่ คัสตาร์ดเค้ก 17 ก. x12', qty: 2, unitPrice: 50 },
  { productName: 'SINGHA Drinking Water 1.5L Pack 6', qty: 3, unitPrice: 50 }
];

test('รวมยอดจากรายการสินค้าถูกต้อง', () => {
  const t = totalsFor(items, 0);
  assert.equal(t.subtotal, 250);
  assert.equal(t.total, 250);
});

test('หักส่วนลดออกจากยอดรวม', () => {
  const t = totalsFor(items, 25);
  assert.equal(t.discount, 25);
  assert.equal(t.total, 225);
});

test('ส่วนลดที่เป็นค่าว่างหรือ undefined ต้องไม่ทำให้ยอดกลายเป็น NaN', () => {
  for (const bad of ['', null, undefined, 'abc']) {
    const t = totalsFor(items, bad);
    assert.equal(t.total, 250, `ส่วนลด ${JSON.stringify(bad)} ทำให้ยอดเพี้ยน`);
  }
});

test('ตะกร้าว่างให้ยอดเป็นศูนย์ ไม่ใช่ NaN', () => {
  const t = totalsFor([], 0);
  assert.equal(t.subtotal, 0);
  assert.equal(t.total, 0);
});

test('แสดงจำนวนเงินเป็นทศนิยมสองตำแหน่งเสมอ', () => {
  assert.equal(money(50), '50.00');
  assert.equal(money(1234.5), '1,234.50');
  assert.equal(money(0), '0.00');
});

test('วันที่บนใบเสร็จเป็นพุทธศักราช', () => {
  const text = formatThaiDateTime(new Date('2026-08-27T14:05:00'));
  assert.match(text, /2569/);        // 2026 + 543
  assert.match(text, /ส\.ค\./);
  assert.match(text, /14:05/);
});

test('ใบเสร็จมีชื่อสินค้า จำนวน และยอดสุทธิครบ', () => {
  const html = receiptHtml({
    sale: { saleId: 'SALE_1', discount: 25, paymentMethod: 'cash', timestamp: new Date() },
    items,
    settings: { ShopName: 'สินไทยพาณิชย์' },
    staffName: 'เจ้าของร้าน'
  });
  assert.match(html, /สินไทยพาณิชย์/);
  assert.match(html, /ยูโร่ คัสตาร์ดเค้ก/);
  assert.match(html, /SALE_1/);
  assert.match(html, /225\.00/);      // ยอดสุทธิหลังหักส่วนลด
  assert.match(html, /-25\.00/);      // บรรทัดส่วนลด
  assert.match(html, /เงินสด/);
});

test('ไม่แสดงบรรทัดส่วนลดเมื่อไม่มีส่วนลด', () => {
  const html = receiptHtml({
    sale: { saleId: 'SALE_2', discount: 0, paymentMethod: 'cash' },
    items
  });
  assert.ok(!html.includes('ส่วนลด'), 'ไม่ควรมีบรรทัดส่วนลดเมื่อส่วนลดเป็น 0');
});

test('ชื่อสินค้าที่มีอักขระ HTML ต้องถูก escape กันหน้าเพี้ยน', () => {
  const html = receiptHtml({
    sale: { saleId: 'S3', discount: 0 },
    items: [{ productName: '<script>x</script> น้ำ & โซดา', qty: 1, unitPrice: 10 }]
  });
  assert.ok(!html.includes('<script>'), 'ต้องไม่มีแท็ก script ดิบในใบเสร็จ');
  assert.match(html, /&amp;/);
});

test('ใช้ชื่อร้านและข้อความท้ายบิลเริ่มต้นเมื่อยังไม่ได้ตั้งค่า', () => {
  const html = receiptHtml({ sale: { saleId: 'S4', discount: 0 }, items });
  assert.match(html, /sinthaiPOS/);
  assert.match(html, /ขอบคุณ/);
});

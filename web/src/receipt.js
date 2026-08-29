/**
 * receipt.js — สร้างใบเสร็จ
 *
 * ร้านค้าส่งจำเป็นต้องมีบิลให้ลูกค้าถือกลับ ไม่ใช่แค่ข้อความบนจอ
 * แยกไฟล์ออกมาจากหน้าขายเพื่อให้ทดสอบตัวเลขบนใบเสร็จได้โดยไม่ต้องเปิดเบราว์เซอร์
 */

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const PAYMENT_LABELS = {
  cash: 'เงินสด',
  transfer: 'โอน/พร้อมเพย์',
  other: 'อื่นๆ'
};

export function formatThaiDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  // ปีพุทธศักราช เพราะใบเสร็จในไทยใช้ พ.ศ.
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543} ${time}`;
}

export function money(value) {
  return Number(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * รวมยอดจากรายการสินค้า
 *
 * คำนวณใหม่จาก items เสมอ ไม่รับยอดรวมที่ส่งมาจากที่อื่น เพื่อให้ตัวเลขบนใบเสร็จ
 * ตรงกับรายการที่พิมพ์อยู่บนใบเสร็จนั้นจริงๆ ไม่ใช่ยอดที่อาจคำนวณจากตะกร้าคนละชุด
 */
export function totalsFor(items, discount) {
  const subtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const off = Number(discount) || 0;
  return { subtotal, discount: off, total: subtotal - off };
}

/**
 * สร้าง HTML ใบเสร็จ
 *
 * ออกแบบให้พิมพ์ได้ทั้งเครื่องพิมพ์ใบเสร็จความร้อน (กระดาษ 58/80 มม.) และ A4
 * โดยใช้ความกว้างเต็มพื้นที่กระดาษที่มี ไม่ตรึงความกว้างเป็นพิกเซล
 */
export function receiptHtml({ sale, items, settings = {}, staffName = '' }) {
  const { subtotal, discount, total } = totalsFor(items, sale.discount);
  const shopName = settings.ShopName || 'sinthaiPOS';
  const footer = settings.ReceiptFooter || 'ขอบคุณที่อุดหนุนครับ';
  const escape = (text) => String(text == null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const rows = items.map((item) => `
    <tr>
      <td class="name">${escape(item.productName || item.name)}
        <div class="unit">${item.qty} × ${money(item.unitPrice)}</div>
      </td>
      <td class="amount">${money(item.qty * item.unitPrice)}</td>
    </tr>`).join('');

  return `
<div class="receipt">
  <div class="head">
    <div class="shop">${escape(shopName)}</div>
    ${settings.ShopAddress ? `<div class="line">${escape(settings.ShopAddress)}</div>` : ''}
    ${settings.ShopPhone ? `<div class="line">โทร. ${escape(settings.ShopPhone)}</div>` : ''}
  </div>

  <div class="meta">
    <div>เลขที่บิล: ${escape(sale.saleId || sale.clientSaleId || '-')}</div>
    <div>วันที่: ${formatThaiDateTime(sale.timestamp || new Date())}</div>
    ${sale.customerName ? `<div>ลูกค้า: ${escape(sale.customerName)}</div>` : ''}
    ${staffName ? `<div>ผู้ขาย: ${escape(staffName)}</div>` : ''}
  </div>

  <table class="items">
    <tbody>${rows}</tbody>
  </table>

  <table class="sums">
    <tr><td>รวม ${items.length} รายการ</td><td class="amount">${money(subtotal)}</td></tr>
    ${discount > 0 ? `<tr><td>ส่วนลด</td><td class="amount">-${money(discount)}</td></tr>` : ''}
    <tr class="grand"><td>ยอดสุทธิ</td><td class="amount">${money(total)}</td></tr>
    <tr><td>ชำระโดย</td><td class="amount">${PAYMENT_LABELS[sale.paymentMethod] || sale.paymentMethod || '-'}</td></tr>
  </table>

  <div class="foot">${escape(footer)}</div>
</div>`;
}

/**
 * เปิดหน้าต่างพิมพ์
 *
 * ใช้ iframe ซ่อนแทนการเปิดหน้าต่างใหม่ เพราะ Safari บน iOS มักบล็อก window.open
 * ที่ไม่ได้เกิดจากการแตะโดยตรง ทำให้พิมพ์ไม่ออกบนเครื่องที่หน้าร้านใช้จริง
 */
export function printReceipt(html) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>ใบเสร็จ</title><style>${RECEIPT_PRINT_CSS}</style></head><body>${html}</body></html>`);
  doc.close();

  const cleanup = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener('afterprint', cleanup);
  // เผื่อเบราว์เซอร์ไม่ยิง afterprint (เกิดบ่อยบนมือถือ) จะได้ไม่มี iframe ค้างสะสม
  setTimeout(cleanup, 8000);

  frame.contentWindow.focus();
  frame.contentWindow.print();
}

export const RECEIPT_PRINT_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 6mm 4mm;
    font-family: 'Sarabun', 'Segoe UI', -apple-system, sans-serif;
    font-size: 12px; color: #000; background: #fff;
  }
  .receipt { width: 100%; max-width: 76mm; margin: 0 auto; }
  .head { text-align: center; margin-bottom: 6px; }
  .shop { font-size: 15px; font-weight: 700; }
  .line { font-size: 11px; }
  .meta { font-size: 11px; border-top: 1px dashed #000; border-bottom: 1px dashed #000;
          padding: 5px 0; margin-bottom: 5px; }
  table { width: 100%; border-collapse: collapse; }
  .items td { padding: 3px 0; vertical-align: top; }
  .items .unit { font-size: 10px; color: #444; }
  .amount { text-align: right; white-space: nowrap; padding-left: 6px; }
  .sums { border-top: 1px dashed #000; margin-top: 5px; padding-top: 5px; }
  .sums td { padding: 2px 0; }
  .sums .grand td { font-size: 14px; font-weight: 700;
                    border-top: 1px solid #000; padding-top: 4px; }
  .foot { text-align: center; margin-top: 8px; font-size: 11px; }
  @page { margin: 4mm; }
`;

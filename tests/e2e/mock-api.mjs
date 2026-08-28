/**
 * mock-api.mjs — จำลอง Apps Script Web App สำหรับทดสอบ
 *
 * ตอบด้วยข้อมูลสินค้าจริงจาก data/products_master.csv ทั้ง 141 รายการ
 * เพื่อให้ทดสอบกับข้อมูลขนาดจริง ไม่ใช่ข้อมูลตัวอย่างไม่กี่แถวที่ซ่อนปัญหาไว้
 *
 * ใช้: node tests/e2e/mock-api.mjs   (ฟังที่พอร์ต 5599)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.MOCK_PORT || 5599);

/** อ่าน CSV แบบรองรับ field ที่มี quote ครอบ (ชื่อสินค้าไทยบางตัวมีคอมมา) */
function parseCsvLine(line) {
  const out = [];
  let current = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(current); current = ''; }
    else current += ch;
  }
  out.push(current);
  return out;
}

const lines = fs.readFileSync(path.join(ROOT, 'data/products_master.csv'), 'utf8').trim().split('\n');
const headers = parseCsvLine(lines[0]);

const products = lines.slice(1).map((line) => {
  const cells = parseCsvLine(line);
  const row = {};
  headers.forEach((h, i) => (row[h] = cells[i]));
  return {
    SKU: row.sku_code,
    Barcode: row.barcode,
    Name: row.product_name,
    Category: row.category,
    Unit: Number(row.pack_qty) > 1 ? 'แพ็ค' : (row.pack_size_unit || 'ชิ้น'),
    Cost: '',
    RetailPrice: Number(row.retail_price || 0),
    WholesalePrice: '',
    WholesaleMinQty: 5,
    StockQty: 24,
    ReorderPoint: 5,
    Active: true
  };
});

// ใส่ต้นทุนจริงบางรายการ เพื่อให้เห็นทั้งกรณีกำไร ขาดทุน และยังไม่รู้ต้นทุน
const knownCosts = { SKU0014: 149, SKU0016: 51, SKU0023: 48, SKU0003: 49, SKU0006: 47 };
products.forEach((p) => { if (knownCosts[p.SKU]) p.Cost = knownCosts[p.SKU]; });

// จำบิลที่ถูกยกเลิกไว้ เพื่อให้ทดสอบได้ว่ากดยกเลิกซ้ำแล้วระบบปฏิเสธจริง
const voidedSales = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (payload) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(payload));
  };

  if (req.method === 'GET') {
    switch (url.searchParams.get('action')) {
      case 'products':
        return send({ ok: true, products });
      case 'settings':
        return send({ ok: true, settings: {
          ShopName: 'สินไทยพาณิชย์',
          ShopAddress: '123 ถนนตัวอย่าง อ.เมือง',
          ShopPhone: '02-000-0000',
          ReceiptFooter: 'ขอบคุณที่อุดหนุนครับ'
        } });
      case 'report':
        return send({
          ok: true,
          date: url.searchParams.get('date'),
          orderCount: 7,
          totalSales: 2480.5,
          totalDiscount: 40,
          grossProfit: -18,
          revenueWithKnownCost: 800,
          unknownCostRevenue: 1680.5,
          itemCount: 23,
          topSellers: [
            { sku: 'SKU0016', name: 'ยูโร่ คัสตาร์ดเค้ก 17 ก. 12 ชิ้น', qty: 9, revenue: 450, profit: -9, soldBelowCost: true },
            { sku: 'SKU0003', name: 'SINGHA Drinking Water 1.5L Pack 6', qty: 7, revenue: 350, profit: 7, soldBelowCost: false },
            { sku: 'SKU0009', name: 'Coke Original 999ml x 12 units', qty: 4, revenue: 1040, profit: null, soldBelowCost: false }
          ],
          bills: [
            { saleId: 'SALE_TEST_1', time: '13:40', customerName: 'ร้านป้าสมศรี', total: 650, paymentMethod: 'cash' },
            { saleId: 'SALE_TEST_2', time: '11:02', customerName: '', total: 120, paymentMethod: 'cash' }
          ],
          soldBelowCost: [
            { sku: 'SKU0016', name: 'ยูโร่ คัสตาร์ดเค้ก 17 ก. 12 ชิ้น', qty: 9, revenue: 450, profit: -9, soldBelowCost: true }
          ]
        });
      default:
        return send({ ok: true, time: new Date().toISOString() });
    }
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const { action, payload = {} } = JSON.parse(body || '{}');
    switch (action) {
      case 'login':
        return send({ ok: true, staff: { userId: 'U1', name: 'เจ้าของร้าน', role: 'owner' } });
      case 'createSale':
        // ออกเลขบิลไม่ซ้ำเหมือนของจริง ไม่งั้นทดสอบยกเลิกบิลรอบสองจะไปชนบิลเดิม
        // ที่ถูกยกเลิกไปแล้วในรอบก่อน
        return send({ ok: true, saleId: `SALE_${Date.now()}`, total: 0 });
      case 'setBarcode':
        return send({ ok: true, sku: payload.sku, barcode: payload.barcode });
      case 'voidSale': {
        if (voidedSales.has(payload.saleId)) {
          return send({ ok: false, error: 'บิลนี้ถูกยกเลิกไปแล้ว' });
        }
        voidedSales.add(payload.saleId);
        return send({ ok: true, saleId: payload.saleId, itemsRestored: 2, itemCount: 2 });
      }
      case 'countStock':
        return send({
          ok: true,
          sku: payload.sku,
          stockQty: payload.countedQty,
          before: 24,
          difference: payload.countedQty - 24
        });
      default:
        return send({ ok: true });
    }
  });
});

server.listen(PORT, () => console.log(`mock api พร้อมที่พอร์ต ${PORT} (สินค้า ${products.length} รายการ)`));

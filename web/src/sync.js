/**
 * sync.js — พยายามส่งบิลที่ค้างอยู่ใน IndexedDB (ขายตอนเน็ตหลุด) ขึ้น Apps Script
 * เรียกตอนแอปเปิด, ตอน network กลับมา online, และหลังขายของสำเร็จทุกครั้ง
 */

import { api } from './api.js';
import { getPendingSales, removePendingSale } from './db.js';

let syncing = false;

export async function syncPendingSales(onProgress) {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const pending = await getPendingSales();
    for (const sale of pending) {
      try {
        const result = await api.createSale(sale);
        if (result.ok) {
          await removePendingSale(sale.clientSaleId);
          onProgress && onProgress({ sale, result });
        }
      } catch (err) {
        // เน็ตหลุดกลางทาง — เลิก loop แล้วรอรอบถัดไป
        break;
      }
    }
  } finally {
    syncing = false;
  }
}

export function watchConnectivity(onProgress) {
  window.addEventListener('online', () => syncPendingSales(onProgress));
}

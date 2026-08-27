/**
 * db.js — IndexedDB สำหรับ:
 *  - cache รายการสินค้า (ให้เปิดหน้าขายได้แม้เน็ตหลุด)
 *  - คิว "pendingSales" การขายที่เกิดตอน offline รอ sync ขึ้น Apps Script
 *
 * เขียนด้วย native IndexedDB API ตรงๆ (ไม่พึ่ง library ภายนอก) เพื่อคุมขนาด bundle
 */

const DB_NAME = 'sinthaipos';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'products';
const STORE_PENDING_SALES = 'pendingSales';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        db.createObjectStore(STORE_PRODUCTS, { keyPath: 'SKU' });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING_SALES)) {
        db.createObjectStore(STORE_PENDING_SALES, { keyPath: 'clientSaleId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheProducts(products) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
    const store = tx.objectStore(STORE_PRODUCTS);
    store.clear();
    products.forEach((p) => store.put(p));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCachedProducts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PRODUCTS, 'readonly');
    const req = tx.objectStore(STORE_PRODUCTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function queueSale(sale) {
  return withStore(STORE_PENDING_SALES, 'readwrite', (store) => {
    store.put(sale);
  });
}

export async function getPendingSales() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PENDING_SALES, 'readonly');
    const req = tx.objectStore(STORE_PENDING_SALES).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingSale(clientSaleId) {
  return withStore(STORE_PENDING_SALES, 'readwrite', (store) => {
    store.delete(clientSaleId);
  });
}

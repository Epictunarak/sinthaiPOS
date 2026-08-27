/**
 * api.js — เรียก Apps Script Web App
 *
 * ตั้งค่า VITE_API_BASE_URL / VITE_API_TOKEN ใน web/.env (ดู .env.example)
 * ค่าเหล่านี้ถูก bake เข้าไปใน build ตอน compile — เหมาะกับแอปที่ใช้เฉพาะร้านเดียว
 * (single-tenant) ไม่ใช่ SaaS หลายร้าน ถ้าจะทำหลายร้านต้องเปลี่ยนวิธีตั้งค่านี้
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;
const API_TOKEN = import.meta.env.VITE_API_TOKEN;

function assertConfigured() {
  if (!API_BASE_URL || !API_TOKEN) {
    throw new Error(
      'ยังไม่ได้ตั้งค่า VITE_API_BASE_URL / VITE_API_TOKEN — คัดลอก web/.env.example เป็น web/.env แล้วใส่ค่า'
    );
  }
}

async function apiGet(action, params) {
  assertConfigured();
  const url = new URL(API_BASE_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), { method: 'GET' });
  return res.json();
}

async function apiPost(action, payload) {
  assertConfigured();
  // Content-Type: text/plain กันไม่ให้ browser ยิง CORS preflight (OPTIONS)
  // ซึ่ง Apps Script Web App ไม่รองรับดี — ฝั่ง server (Code.gs) parse เป็น JSON เอง
  const res = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: API_TOKEN, payload })
  });
  return res.json();
}

export const api = {
  ping: () => apiGet('ping'),
  login: (pin) => apiPost('login', { pin }),
  getProducts: () => apiGet('products'),
  getReport: (dateStr) => apiGet('report', { date: dateStr }),
  createSale: (sale) => apiPost('createSale', sale),
  adjustStock: (adjustment) => apiPost('adjustStock', adjustment)
};

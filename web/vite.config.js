import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Base path ต้องตรงกับชื่อ repo เวลา deploy ขึ้น GitHub Pages (https://<user>.github.io/sinthaiPOS/)
// ถ้า deploy ขึ้น Cloudflare Pages หรือ custom domain แทน ให้เปลี่ยนเป็น '/'
const BASE_PATH = process.env.VITE_BASE_PATH || '/sinthaiPOS/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'sinthaiPOS',
        short_name: 'sinthaiPOS',
        description: 'ระบบหลังบ้าน POS สำหรับร้านค้าปลีก/ส่งขนาดเล็ก',
        theme_color: '#0f766e',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: BASE_PATH,
        scope: BASE_PATH,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // precache หน้าเว็บ; ข้อมูลสินค้า/การขาย จัดการ cache เองใน src/db.js (IndexedDB)
        globPatterns: ['**/*.{js,css,html,svg,png}']
      }
    })
  ]
});

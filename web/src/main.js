import './styles.css';
import { getSession, clearSession } from './session.js';
import { watchConnectivity, syncPendingSales } from './sync.js';
import { renderLogin } from './pages/login.js';
import { renderPos } from './pages/pos.js';
import { renderInventory } from './pages/inventory.js';
import { renderReports } from './pages/reports.js';
import { renderBarcodes } from './pages/barcodes.js';
import { renderStocktake } from './pages/stocktake.js';

const ROUTES = {
  '#/pos': { render: renderPos, label: 'ขายของ' },
  '#/inventory': { render: renderInventory, label: 'สต็อก' },
  '#/reports': { render: renderReports, label: 'รายงาน' },
  '#/barcodes': { render: renderBarcodes, label: 'เก็บบาร์โค้ด' },
  '#/stocktake': { render: renderStocktake, label: 'ตรวจนับ' }
};

const app = document.getElementById('app');

function navigate(hash) {
  if (location.hash === hash) {
    renderApp();
  } else {
    location.hash = hash;
  }
}

function renderShell(activeHash) {
  const staff = getSession();
  const shell = document.createElement('div');
  shell.innerHTML = `
    <div class="topbar">
      <span class="brand">sinthaiPOS</span>
      <nav class="tabs">
        ${Object.entries(ROUTES)
          .map(([hash, r]) => `<a href="${hash}" class="${hash === activeHash ? 'active' : ''}">${r.label}</a>`)
          .join('')}
      </nav>
      <div style="display:flex; align-items:center; gap:10px;">
        <span class="text-dim">${staff ? staff.name : ''}</span>
        <button id="logout">ออกจากระบบ</button>
      </div>
    </div>
    <main id="page"></main>
  `;
  shell.querySelector('#logout').addEventListener('click', () => {
    clearSession();
    navigate('#/login');
  });
  return shell;
}

function renderApp() {
  const staff = getSession();
  const hash = location.hash || (staff ? '#/pos' : '#/login');

  if (!staff && hash !== '#/login') {
    location.hash = '#/login';
    return;
  }

  if (hash === '#/login' || !ROUTES[hash]) {
    if (staff && !ROUTES[hash]) {
      location.hash = '#/pos';
      return;
    }
    app.innerHTML = '';
    renderLogin(app, navigate);
    return;
  }

  const shell = renderShell(hash);
  app.innerHTML = '';
  app.appendChild(shell);
  ROUTES[hash].render(shell.querySelector('#page'), navigate);
}

window.addEventListener('hashchange', renderApp);
watchConnectivity();
renderApp();
if (navigator.onLine) syncPendingSales();

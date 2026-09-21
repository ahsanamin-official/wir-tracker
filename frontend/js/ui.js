/* ===========================================================
   ui.js — toast notifications, modals, small DOM helpers
   =========================================================== */

const UI = {
  toast(message, type = 'info', timeout = 3500) {
    const host = document.getElementById('toastHost');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, timeout);
  },

  confirm(message, { title = 'Please confirm', okText = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `
        <div class="modal">
          <h3>${title}</h3>
          <p class="text-sm text-muted">${message}</p>
          <div class="flex-end flex-gap mt-16">
            <button class="btn ghost" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${okText}</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) { backdrop.remove(); resolve(false); }
        const act = e.target.getAttribute('data-act');
        if (act === 'cancel') { backdrop.remove(); resolve(false); }
        if (act === 'ok') { backdrop.remove(); resolve(true); }
      });
    });
  },

  openModal(innerHtml) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    return backdrop;
  },

  closeModal(backdrop) { if (backdrop) backdrop.remove(); },

  el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  },

  formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  },

  formatDateShort(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
};

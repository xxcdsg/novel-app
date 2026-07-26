// Utility functions
(function (global) {
  'use strict';

  const Utils = {
    uuid() {
      if (crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    },

    escapeHtml(s) {
      if (s == null) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    blobToBase64(blob) {
      return new Promise((resolve, reject) => {
        if (!blob) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          // result is data URL: data:<type>;base64,<data>
          const result = reader.result;
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.substring(idx + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },

    base64ToBlob(b64, type) {
      if (!b64) return null;
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: type || 'application/octet-stream' });
    },

    formatDate(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },

    formatDateTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    todayISO() {
      const d = new Date();
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },

    formatSize(bytes) {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      let i = 0;
      let n = bytes;
      while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
      return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
    },

    debounce(fn, ms) {
      let timer = null;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
      };
    },

    // Download a blob as a file
    downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    // Pick file via input element. Returns promise resolving to File[] or []
    pickFile(accept, multiple) {
      return new Promise(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept || '';
        if (multiple) input.multiple = true;
        input.onchange = () => {
          const files = input.files ? Array.from(input.files) : [];
          resolve(files);
        };
        input.click();
      });
    },

    // Render star rating as HTML string (supports .5)
    // rating: number 0-5
    // interactive: if true, adds data attributes for click handling
    renderStars(rating, interactive) {
      rating = Number(rating) || 0;
      if (rating < 0) rating = 0;
      if (rating > 5) rating = 5;
      let html = '<span class="stars' + (interactive ? ' stars-interactive' : '') + '">';
      for (let i = 1; i <= 5; i++) {
        let cls = 'star';
        if (rating >= i) cls += ' star-full';
        else if (rating >= i - 0.5) cls += ' star-half';
        else cls += ' star-empty';
        if (interactive) {
          html += `<i class="${cls}" data-value="${i - 0.5}" title="${i - 0.5}">★</i>`;
          html += `<i class="${cls} star-frac" data-value="${i}" title="${i}"></i>`;
        } else {
          html += `<i class="${cls}">★</i>`;
        }
      }
      html += '</span>';
      return html;
    },

    // Build a simple URL hash router
    parseHash() {
      const raw = location.hash.replace(/^#/, '') || '/';
      const [path, queryStr] = raw.split('?');
      const query = {};
      if (queryStr) {
        for (const pair of queryStr.split('&')) {
          const [k, v] = pair.split('=');
          query[decodeURIComponent(k)] = decodeURIComponent(v || '');
        }
      }
      return { path, query };
    },

    navigate(path) {
      location.hash = path;
    },

    // Show toast notification
    toast(message, type) {
      const root = document.getElementById('toast-root');
      const el = document.createElement('div');
      el.className = `toast toast-${type || 'info'}`;
      el.textContent = message;
      root.appendChild(el);
      // Force reflow then add show class
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 300);
      }, 3000);
    },

    // Confirmation modal
    confirm(message, options) {
      return new Promise(resolve => {
        const root = document.getElementById('modal-root');
        const opts = options || {};
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
          <div class="modal">
            <div class="modal-body">${Utils.escapeHtml(message)}</div>
            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" data-act="cancel">${opts.cancelText || '取消'}</button>
              <button type="button" class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${opts.okText || '确定'}</button>
            </div>
          </div>
        `;
        root.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('show'));
        function close(result) {
          overlay.classList.remove('show');
          setTimeout(() => overlay.remove(), 200);
          resolve(result);
        }
        overlay.querySelector('[data-act="ok"]').onclick = () => close(true);
        overlay.querySelector('[data-act="cancel"]').onclick = () => close(false);
        overlay.onclick = (e) => { if (e.target === overlay) close(false); };
      });
    },

    // Encode JSON to URL-safe base64 (no padding) for URL hash
    // Uses - and _ instead of + and /, and removes = padding
    encodeForHash(obj) {
      const json = JSON.stringify(obj);
      const bytes = new TextEncoder().encode(json);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      // Standard base64 -> URL-safe: replace +/, and strip = padding
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },

    // Decode URL-safe base64 (with or without padding) back to JSON
    decodeFromHash(b64) {
      try {
        if (!b64) return null;
        // URL-safe -> standard
        let std = b64.replace(/-/g, '+').replace(/_/g, '/');
        // Re-add padding
        while (std.length % 4 !== 0) std += '=';
        const binary = atob(std);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json);
      } catch (e) {
        console.warn('[decodeFromHash] failed:', e);
        return null;
      }
    }
  };

  global.Utils = Utils;
})(window);

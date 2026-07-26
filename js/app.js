// Main app: router, theme, navigation
(function () {
  'use strict';

  const app = document.getElementById('app');

  // Theme management
  async function initTheme() {
    const saved = await DB.getSetting('theme', 'auto');
    applyTheme(saved);
    document.getElementById('theme-toggle').onclick = async () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      const next = cur === 'light' ? 'dark' : 'light';
      applyTheme(next);
      await DB.setSetting('theme', next);
    };
  }

  function applyTheme(theme) {
    if (theme === 'auto') {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = prefersDark ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  // Highlight active nav link
  function updateNav(path) {
    document.querySelectorAll('.nav-link').forEach(link => {
      const route = link.getAttribute('data-route');
      const isActive = (route === '/' && path === '/') ||
        (route !== '/' && path.startsWith(route));
      link.classList.toggle('active', isActive);
    });
  }

  // Router
  async function route() {
    const { path, query } = Utils.parseHash();
    updateNav(path);
    window.scrollTo(0, 0);

    try {
      // Routes:
      //   /                  -> list
      //   /add               -> edit (new)
      //   /edit/:id          -> edit
      //   /detail/:id        -> detail
      //   /sync              -> sync/import
      const parts = path.split('/').filter(Boolean);

      if (path === '/' || parts.length === 0) {
        await ListView.render(app, query);
      } else if (parts[0] === 'add') {
        await EditView.render(app, null);
      } else if (parts[0] === 'edit' && parts[1]) {
        await EditView.render(app, decodeURIComponent(parts[1]));
      } else if (parts[0] === 'detail' && parts[1]) {
        await DetailView.render(app, decodeURIComponent(parts[1]));
      } else if (parts[0] === 'sync') {
        await SyncView.render(app, query);
      } else {
        app.innerHTML = '<div class="empty-state"><div class="icon">🤷</div><h3>页面未找到</h3><p>检查 URL 是否正确</p><a href="#/" class="btn btn-primary">返回书架</a></div>';
      }
    } catch (e) {
      console.error(e);
      app.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><h3>加载失败</h3><p>${Utils.escapeHtml(e.message || String(e))}</p><a href="#/" class="btn btn-primary">返回书架</a></div>`;
    }
  }

  async function init() {
    await initTheme();
    window.addEventListener('hashchange', route);
    await route();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

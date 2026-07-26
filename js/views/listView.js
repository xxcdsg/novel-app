// List view: bookshelf with search, filter, sort, grid/list toggle
(function (global) {
  'use strict';

  const state = {
    novels: [],
    search: '',
    activeTag: null,
    sort: 'updated',
    view: 'grid',
    objectUrls: []
  };

  function revokeUrls() {
    state.objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    state.objectUrls = [];
  }

  function makeCoverUrl(novel) {
    if (novel.coverImage) {
      const url = URL.createObjectURL(novel.coverImage);
      state.objectUrls.push(url);
      return url;
    }
    return null;
  }

  function collectAllTags(novels) {
    const counts = new Map();
    for (const n of novels) {
      for (const t of (n.tags || [])) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ tag: t, count: c }));
  }

  function filterNovels() {
    let list = state.novels;
    const q = state.search.trim().toLowerCase();
    if (q) {
      list = list.filter(n => {
        const fields = [
          n.mainTitle, n.originalTitle, n.author,
          ...(n.altTitles || []), ...(n.tags || [])
        ].filter(Boolean).join(' ').toLowerCase();
        return fields.includes(q);
      });
    }
    if (state.activeTag) {
      list = list.filter(n => (n.tags || []).includes(state.activeTag));
    }
    return list;
  }

  function sortNovels(list) {
    const arr = [...list];
    switch (state.sort) {
      case 'title':
        arr.sort((a, b) => (a.mainTitle || '').localeCompare(b.mainTitle || '', 'zh'));
        break;
      case 'rating':
        arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case 'created':
        arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        break;
      case 'updated':
      default:
        arr.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        break;
    }
    return arr;
  }

  function positionText(novel) {
    const p = novel.lastReadPosition;
    if (!p || !p.value) return '';
    return p.value;
  }

  function renderGrid(novels) {
    if (!novels.length) {
      return `<div class="empty-state">
        <div class="icon">📚</div>
        <h3>${state.search || state.activeTag ? '没有匹配的小说' : '书架还是空的'}</h3>
        <p>${state.search || state.activeTag ? '尝试修改搜索或筛选条件' : '添加你的第一本小说，或从 esjzone / novelia 同步阅读记录'}</p>
        ${state.search || state.activeTag ? '' : '<a href="#/add" class="btn btn-primary">添加小说</a> <a href="#/sync" class="btn">同步阅读记录</a>'}
      </div>`;
    }
    const cards = novels.map(n => {
      const coverUrl = makeCoverUrl(n);
      const sourceBadge = n.source ? `<span class="source-badge">${escapeSource(n.source)}</span>` : '';
      const rating = n.rating ? `<span class="book-rating">${Utils.renderStars(n.rating)}</span>` : '';
      const pos = positionText(n);
      const posHtml = pos ? `<span class="book-position" title="${Utils.escapeHtml(pos)}">${Utils.escapeHtml(pos)}</span>` : '';
      return `
        <div class="book-card" data-id="${Utils.escapeHtml(n.id)}">
          <div class="book-cover">
            ${coverUrl ? `<img src="${coverUrl}" alt="${Utils.escapeHtml(n.mainTitle)}" loading="lazy">` : '<span class="placeholder">📖</span>'}
            ${sourceBadge}
          </div>
          <div class="book-info">
            <div class="book-title">${Utils.escapeHtml(n.mainTitle)}</div>
            <div class="book-author">${n.author ? Utils.escapeHtml(n.author) : '&nbsp;'}</div>
            <div class="book-meta">
              ${rating}
              ${posHtml}
            </div>
          </div>
        </div>`;
    }).join('');
    return `<div class="book-grid">${cards}</div>`;
  }

  function renderList(novels) {
    if (!novels.length) return renderGrid(novels);
    const items = novels.map(n => {
      const coverUrl = makeCoverUrl(n);
      const rating = n.rating ? Utils.renderStars(n.rating) : '';
      const pos = positionText(n);
      const posHtml = pos ? `<span>${Utils.escapeHtml(pos)}</span>` : '';
      const tagsHtml = (n.tags || []).slice(0, 3).map(t => `<span class="tag-pill">${Utils.escapeHtml(t)}</span>`).join('');
      return `
        <div class="book-list-item" data-id="${Utils.escapeHtml(n.id)}">
          <div class="mini-cover">
            ${coverUrl ? `<img src="${coverUrl}" alt="${Utils.escapeHtml(n.mainTitle)}">` : '<span class="placeholder">📖</span>'}
          </div>
          <div class="item-info">
            <div class="item-title">${Utils.escapeHtml(n.mainTitle)}${n.originalTitle ? ` <span class="muted text-sm">/ ${Utils.escapeHtml(n.originalTitle)}</span>` : ''}</div>
            <div class="item-sub">
              ${n.author ? `<span>✍️ ${Utils.escapeHtml(n.author)}</span>` : ''}
              ${rating ? `<span>${rating}</span>` : ''}
              ${posHtml}
              ${tagsHtml}
            </div>
          </div>
        </div>`;
    }).join('');
    return `<div class="book-list">${items}</div>`;
  }

  function escapeSource(src) {
    const map = { esjzone: 'ESJ', novelia: 'NVL' };
    return map[src] || Utils.escapeHtml(src).substring(0, 3).toUpperCase();
  }

  async function render(container, query) {
    Components.mountSpinner(container);
    state.novels = await DB.getAllNovels();

    // Restore state from query
    if (query.q) state.search = query.q;
    if (query.tag) state.activeTag = query.tag;
    if (query.sort) state.sort = query.sort;
    if (query.view) state.view = query.view;

    // Persist view preference
    const savedView = await DB.getSetting('listView', 'grid');
    if (!query.view) state.view = savedView;

    revokeUrls();
    draw(container);
  }

  function draw(container) {
    const allTags = collectAllTags(state.novels);
    const filtered = sortNovels(filterNovels());

    const tagFilterHtml = allTags.length ? `
      <div class="row" style="margin-bottom: 12px; gap: 6px;">
        ${state.activeTag ? `<button class="btn btn-sm btn-ghost" data-clear-tag="1">✕ 清除筛选</button>` : ''}
        ${allTags.slice(0, 20).map(t => `
          <span class="tag-pill clickable ${state.activeTag === t.tag ? 'active' : ''}" data-tag="${Utils.escapeHtml(t.tag)}">${Utils.escapeHtml(t.tag)} <span class="muted">(${t.count})</span></span>
        `).join('')}
      </div>
    ` : '';

    container.innerHTML = `
      <div class="bookshelf-toolbar">
        <div class="search-box">
          <input type="text" id="search-input" placeholder="搜索书名 / 作者 / 别名 / 标签..." value="${Utils.escapeHtml(state.search)}">
        </div>
        <div class="toolbar-right">
          <select id="sort-select" class="form-select" style="width: auto;">
            <option value="updated" ${state.sort === 'updated' ? 'selected' : ''}>最近更新</option>
            <option value="created" ${state.sort === 'created' ? 'selected' : ''}>最近添加</option>
            <option value="title" ${state.sort === 'title' ? 'selected' : ''}>书名</option>
            <option value="rating" ${state.sort === 'rating' ? 'selected' : ''}>评分</option>
          </select>
          <div class="view-toggle">
            <button data-view="grid" class="${state.view === 'grid' ? 'active' : ''}" title="网格视图">▦</button>
            <button data-view="list" class="${state.view === 'list' ? 'active' : ''}" title="列表视图">☰</button>
          </div>
          <a href="#/add" class="btn btn-primary btn-sm">+ 添加</a>
        </div>
      </div>
      ${tagFilterHtml}
      <div id="list-container"></div>
      <div class="muted text-sm" style="margin-top: 12px;">共 ${filtered.length} 本 / 总计 ${state.novels.length} 本</div>
    `;

    const listContainer = container.querySelector('#list-container');
    listContainer.innerHTML = state.view === 'grid' ? renderGrid(filtered) : renderList(filtered);

    // Bind events
    const searchInput = container.querySelector('#search-input');
    const debouncedSearch = Utils.debounce(() => {
      state.search = searchInput.value;
      updateUrl();
      revokeUrls();
      draw(container);
    }, 250);
    searchInput.addEventListener('input', debouncedSearch);

    container.querySelector('#sort-select').onchange = (e) => {
      state.sort = e.target.value;
      updateUrl();
      revokeUrls();
      draw(container);
    };

    container.querySelectorAll('.view-toggle button').forEach(btn => {
      btn.onclick = async () => {
        state.view = btn.dataset.view;
        await DB.setSetting('listView', state.view);
        updateUrl();
        revokeUrls();
        draw(container);
      };
    });

    container.querySelectorAll('[data-tag]').forEach(el => {
      el.onclick = () => {
        state.activeTag = el.dataset.tag;
        updateUrl();
        revokeUrls();
        draw(container);
      };
    });
    const clearBtn = container.querySelector('[data-clear-tag]');
    if (clearBtn) {
      clearBtn.onclick = () => {
        state.activeTag = null;
        updateUrl();
        revokeUrls();
        draw(container);
      };
    }

    container.querySelectorAll('[data-id]').forEach(el => {
      el.onclick = () => {
        Utils.navigate(`/detail/${encodeURIComponent(el.dataset.id)}`);
      };
    });
  }

  function updateUrl() {
    const q = new URLSearchParams();
    if (state.search) q.set('q', state.search);
    if (state.activeTag) q.set('tag', state.activeTag);
    if (state.sort !== 'updated') q.set('sort', state.sort);
    if (state.view !== 'grid') q.set('view', state.view);
    const qs = q.toString();
    Utils.navigate('/' + (qs ? '?' + qs : ''));
  }

  global.ListView = { render };
})(window);

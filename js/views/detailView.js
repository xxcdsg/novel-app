// Detail view: show all fields of a novel record
(function (global) {
  'use strict';

  let objectUrls = [];

  function revokeUrls() {
    objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    objectUrls = [];
  }

  function url(blob) {
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    objectUrls.push(u);
    return u;
  }

  async function render(container, id) {
    Components.mountSpinner(container);
    revokeUrls();
    const novel = await DB.getNovel(id);
    if (!novel) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>未找到这本小说</h3><p>可能已被删除</p><a href="#/" class="btn btn-primary">返回书架</a></div>`;
      return;
    }

    const coverUrl = url(novel.coverImage);
    const altTitles = (novel.altTitles || []).filter(Boolean);
    const tags = novel.tags || [];
    const links = novel.links || [];
    const files = novel.files || [];
    const illusts = novel.illustrations || [];
    const reviews = novel.readingReviews || [];
    const pos = novel.lastReadPosition;

    container.innerHTML = `
      <div class="row" style="margin-bottom: 16px;">
        <a href="#/" class="btn btn-ghost btn-sm">← 返回书架</a>
        <div class="spacer"></div>
        <a href="#/edit/${encodeURIComponent(novel.id)}" class="btn btn-sm">✏️ 编辑</a>
        <button type="button" class="btn btn-sm btn-danger" id="btn-delete">🗑 删除</button>
      </div>

      <div class="detail-header">
        <div class="detail-cover">
          ${coverUrl ? `<img src="${coverUrl}" alt="${Utils.escapeHtml(novel.mainTitle)}">` : '<span class="placeholder">📖</span>'}
        </div>
        <div class="detail-info">
          <h1>${Utils.escapeHtml(novel.mainTitle)}</h1>
          ${altTitles.length ? `<div class="alt-titles">${altTitles.map(t => Utils.escapeHtml(t)).join(' · ')}</div>` : ''}
          ${novel.originalTitle ? `<div class="info-row"><span class="info-label">原名</span><span class="info-value">${Utils.escapeHtml(novel.originalTitle)}</span></div>` : ''}
          ${novel.author ? `<div class="info-row"><span class="info-label">作者</span><span class="info-value">${Utils.escapeHtml(novel.author)}</span></div>` : ''}
          ${novel.rating ? `<div class="info-row"><span class="info-label">评分</span><span class="info-value">${Utils.renderStars(novel.rating)} <span class="muted text-sm">${novel.rating.toFixed(1)} / 5</span></span></div>` : ''}
          ${tags.length ? `<div class="info-row"><span class="info-label">标签</span><span class="info-value"><div class="tag-display">${tags.map(t => `<span class="tag-pill clickable" data-tag="${Utils.escapeHtml(t)}">${Utils.escapeHtml(t)}</span>`).join('')}</div></span></div>` : ''}
          ${(novel.wordCount || novel.chapterCount || novel.volumeCount) ? `<div class="info-row"><span class="info-label">篇幅</span><span class="info-value">${
            [
              novel.volumeCount ? `${novel.volumeCount} 卷` : '',
              novel.chapterCount ? `${novel.chapterCount} 章` : '',
              novel.wordCount ? `${formatWordCount(novel.wordCount)}` : ''
            ].filter(Boolean).join(' · ')
          }</span></div>` : ''}
          ${pos && pos.value ? `<div class="info-row"><span class="info-label">阅读到</span><span class="info-value">${Utils.escapeHtml(pos.value)}</span></div>` : ''}
          ${novel.source ? `<div class="info-row"><span class="info-label">来源</span><span class="info-value">${sourceLabel(novel.source)}${novel.sources && novel.sources.length > 1 ? ' + ' + novel.sources.filter(s => s !== novel.source).map(sourceLabel).join(' / ') : ''}</span></div>` : ''}
          <div class="info-row"><span class="info-label">更新</span><span class="info-value muted text-sm">${Utils.formatDateTime(novel.updatedAt)}</span></div>
          <div class="detail-actions">
            ${links.length ? links.map(l => `<a href="${Utils.escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm">🔗 ${Utils.escapeHtml(l.label || hostnameOf(l.url))}</a>`).join('') : ''}
            ${pos && pos.value ? `<button type="button" class="btn btn-sm" id="btn-continue">📍 继续阅读</button>` : ''}
          </div>
        </div>
      </div>

      ${novel.description ? `
        <div class="section">
          <h2>简介</h2>
          <div class="description-text">${Utils.escapeHtml(novel.description)}</div>
        </div>
      ` : ''}

      ${novel.overallReview ? `
        <div class="section">
          <h2>整体评价</h2>
          <div class="overall-review">${Utils.escapeHtml(novel.overallReview)}</div>
        </div>
      ` : ''}

      ${reviews.length ? `
        <div class="section">
          <h2>阅读笔记 <span class="actions"><button type="button" class="btn btn-sm" id="btn-add-review">+ 添加</button></span></h2>
          <div id="reviews-list">
            ${reviews.map((r, i) => `
              <div class="review-entry" data-idx="${i}">
                <div class="review-meta">
                  <span>📅 ${Utils.escapeHtml(r.date || '')}${r.position ? ' · 📍 ' + Utils.escapeHtml(r.position) : ''}</span>
                  <span class="row">
                    <button type="button" class="btn btn-sm btn-ghost" data-edit-review="${i}">编辑</button>
                    <button type="button" class="btn btn-sm btn-ghost" data-del-review="${i}">删除</button>
                  </span>
                </div>
                <div class="review-body">${Utils.escapeHtml(r.content || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : `
        <div class="section">
          <h2>阅读笔记</h2>
          <div class="muted">还没有阅读笔记。<button type="button" class="btn btn-sm btn-ghost" id="btn-add-review">+ 添加第一条笔记</button></div>
        </div>
      `}

      ${links.length ? `
        <div class="section">
          <h2>链接</h2>
          <div class="links-list">
            ${links.map(l => `<a href="${Utils.escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">🔗 ${Utils.escapeHtml(l.label || hostnameOf(l.url))} <span class="muted text-sm">${Utils.escapeHtml(l.url)}</span></a>`).join('')}
          </div>
        </div>
      ` : ''}

      ${files.length ? `
        <div class="section">
          <h2>小说文件 <span class="actions"><span class="muted text-sm">${files.length} 个文件</span></span></h2>
          <div class="file-list">
            ${files.map((f, i) => `
              <div class="file-item">
                <span class="file-icon">${fileIcon(f.name)}</span>
                <span class="file-name" title="${Utils.escapeHtml(f.name)}">${Utils.escapeHtml(f.name)}</span>
                <span class="file-size">${Utils.formatSize(f.size || (f.blob && f.blob.size) || 0)}</span>
                <span class="file-actions">
                  <button type="button" class="btn btn-sm" data-download-file="${i}">下载</button>
                  <button type="button" class="btn btn-sm btn-ghost" data-del-file="${i}">删除</button>
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${illusts.length ? `
        <div class="section">
          <h2>插图 <span class="actions"><span class="muted text-sm">${illusts.length} 张</span></span></h2>
          <div class="illustrations-grid">
            ${illusts.map((im, i) => {
              const u = url(im.blob);
              return `<img src="${u}" alt="${Utils.escapeHtml(im.name || '')}" data-illust="${i}">`;
            }).join('')}
          </div>
        </div>
      ` : ''}
    `;

    bindEvents(container, novel);
  }

  function bindEvents(container, novel) {
    container.querySelector('#btn-delete').onclick = async () => {
      const ok = await Utils.confirm(`确认删除《${novel.mainTitle}》吗？此操作不可恢复。`, { danger: true, okText: '删除' });
      if (!ok) return;
      await DB.deleteNovel(novel.id);
      Utils.toast('已删除', 'success');
      Utils.navigate('/');
    };

    container.querySelectorAll('[data-tag]').forEach(el => {
      el.onclick = () => {
        Utils.navigate(`/?tag=${encodeURIComponent(el.dataset.tag)}`);
      };
    });

    const continueBtn = container.querySelector('#btn-continue');
    if (continueBtn) {
      continueBtn.onclick = () => {
        const links = novel.links || [];
        if (!links.length) { Utils.toast('没有可继续阅读的链接', 'error'); return; }
        // Prefer the source link if available
        const srcLink = novel.source ? links.find(l => l.url && l.url.includes(novel.source)) : null;
        const target = srcLink || links[0];
        window.open(target.url, '_blank', 'noopener,noreferrer');
      };
    }

    // Illustrations lightbox
    container.querySelectorAll('[data-illust]').forEach(img => {
      img.onclick = () => Components.openLightbox(img.src, img.alt);
    });

    // Files: download / delete
    container.querySelectorAll('[data-download-file]').forEach(btn => {
      btn.onclick = () => {
        const idx = +btn.dataset.downloadFile;
        const f = novel.files[idx];
        if (f && f.blob) Utils.downloadBlob(f.blob, f.name);
      };
    });
    container.querySelectorAll('[data-del-file]').forEach(btn => {
      btn.onclick = async () => {
        const idx = +btn.dataset.delFile;
        const ok = await Utils.confirm(`删除文件 ${novel.files[idx].name}？`, { danger: true, okText: '删除' });
        if (!ok) return;
        novel.files.splice(idx, 1);
        await DB.saveNovel(novel);
        Utils.toast('文件已删除', 'success');
        render(container, novel.id);
      };
    });

    // Reviews: add / edit / delete
    const addBtn = container.querySelector('#btn-add-review');
    if (addBtn) {
      addBtn.onclick = () => openReviewEditor(container, novel, null);
    }
    container.querySelectorAll('[data-edit-review]').forEach(btn => {
      btn.onclick = () => {
        const idx = +btn.dataset.editReview;
        openReviewEditor(container, novel, idx);
      };
    });
    container.querySelectorAll('[data-del-review]').forEach(btn => {
      btn.onclick = async () => {
        const idx = +btn.dataset.delReview;
        const r = novel.readingReviews[idx];
        const ok = await Utils.confirm(`删除 ${r.date} 的笔记？`, { danger: true, okText: '删除' });
        if (!ok) return;
        novel.readingReviews.splice(idx, 1);
        await DB.saveNovel(novel);
        Utils.toast('笔记已删除', 'success');
        render(container, novel.id);
      };
    });
  }

  function openReviewEditor(container, novel, idx) {
    const root = document.getElementById('modal-root');
    const isEdit = idx != null;
    const existing = isEdit ? novel.readingReviews[idx] : { date: Utils.todayISO(), position: novel.lastReadPosition?.value || '', content: '' };
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width: 560px;">
        <h3 style="margin: 0 0 16px;">${isEdit ? '编辑笔记' : '添加阅读笔记'}</h3>
        <div class="form-group">
          <label class="form-label">日期</label>
          <input type="date" class="form-input" id="rev-date" value="${Utils.escapeHtml(existing.date)}">
        </div>
        <div class="form-group">
          <label class="form-label">阅读位置 <span class="hint">可选，例如：第3卷第5章</span></label>
          <input type="text" class="form-input" id="rev-position" value="${Utils.escapeHtml(existing.position || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">内容</label>
          <textarea class="form-textarea" id="rev-content" rows="5">${Utils.escapeHtml(existing.content || '')}</textarea>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">取消</button>
          <button type="button" class="btn btn-primary" data-act="save">保存</button>
        </div>
      </div>
    `;
    root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    function close() {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    }
    overlay.querySelector('[data-act="cancel"]').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    overlay.querySelector('[data-act="save"]').onclick = async () => {
      const date = overlay.querySelector('#rev-date').value;
      const position = overlay.querySelector('#rev-position').value.trim();
      const content = overlay.querySelector('#rev-content').value;
      if (!date) { Utils.toast('请填写日期', 'error'); return; }
      const entry = { date, position, content };
      if (!novel.readingReviews) novel.readingReviews = [];
      if (isEdit) novel.readingReviews[idx] = entry;
      else novel.readingReviews.push(entry);
      // Sort by date desc
      novel.readingReviews.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      // If position provided and no lastReadPosition, update it
      if (position && (!novel.lastReadPosition || !novel.lastReadPosition.value)) {
        novel.lastReadPosition = { type: 'chapter_name', value: position };
      }
      await DB.saveNovel(novel);
      Utils.toast('笔记已保存', 'success');
      close();
      render(container, novel.id);
    };
  }

  function formatWordCount(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万字';
    return n + ' 字';
  }

  function hostnameOf(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; }
  }

  function sourceLabel(s) {
    const map = { esjzone: 'ESJ Zone', novelia: 'Novelia', manual: '手动添加' };
    return map[s] || s;
  }

  function fileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['epub'].includes(ext)) return '📕';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
    if (['txt'].includes(ext)) return '📄';
    if (['pdf'].includes(ext)) return '📕';
    return '📁';
  }

  global.DetailView = { render };
})(window);

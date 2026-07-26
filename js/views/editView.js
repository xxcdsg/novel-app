// Edit view: add or edit a novel record with all fields
(function (global) {
  'use strict';

  let objectUrls = [];

  function revokeUrls() {
    objectUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
    objectUrls = [];
  }

  async function render(container, id) {
    Components.mountSpinner(container);
    revokeUrls();
    let novel;
    let isEdit = false;
    if (id) {
      novel = await DB.getNovel(id);
      if (!novel) {
        container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>未找到这本小说</h3><a href="#/" class="btn btn-primary">返回书架</a></div>`;
        return;
      }
      isEdit = true;
    } else {
      novel = {
        mainTitle: '',
        altTitles: [],
        originalTitle: '',
        author: '',
        tags: [],
        rating: 0,
        links: [],
        coverImage: null,
        coverImageType: null,
        illustrations: [],
        wordCount: null,
        chapterCount: null,
        volumeCount: null,
        lastReadPosition: { type: 'chapter_name', value: '' },
        files: [],
        overallReview: '',
        readingReviews: [],
        source: 'manual',
        sources: ['manual']
      };
    }

    const coverUrl = novel.coverImage ? URL.createObjectURL(novel.coverImage) : null;
    if (coverUrl) objectUrls.push(coverUrl);

    container.innerHTML = `
      <div class="edit-form">
        <div class="row" style="margin-bottom: 16px;">
          <a href="${isEdit ? `#/detail/${encodeURIComponent(novel.id)}` : '#/'}" class="btn btn-ghost btn-sm">← 返回</a>
        </div>
        <h1>${isEdit ? '编辑小说' : '添加小说'}</h1>

        <div class="form-group">
          <label class="form-label">主要小说名字<span class="req">*</span></label>
          <input type="text" class="form-input" id="f-mainTitle" value="${Utils.escapeHtml(novel.mainTitle)}" required>
        </div>

        <div class="form-group">
          <label class="form-label">其他名字 <span class="hint">同一小说的别名、译名等，可添加多个</span></label>
          <div id="alt-titles-input"></div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">原始语言名字 <span class="hint">日文 / 韩文 / 英文 等</span></label>
            <input type="text" class="form-input" id="f-originalTitle" value="${Utils.escapeHtml(novel.originalTitle || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">作者</label>
            <input type="text" class="form-input" id="f-author" value="${Utils.escapeHtml(novel.author || '')}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">标签 <span class="hint">回车添加，可多个</span></label>
          <div id="tags-input"></div>
        </div>

        <div class="form-group">
          <label class="form-label">评分 <span class="hint">满分 5 星，支持半星</span></label>
          <div class="row" id="rating-input" style="gap: 12px;"></div>
        </div>

        <div class="form-group">
          <label class="form-label">链接 <span class="hint">可添加多条并列的链接</span></label>
          <div id="links-list"></div>
          <button type="button" class="btn btn-sm btn-ghost" id="add-link" style="margin-top: 6px;">+ 添加链接</button>
        </div>

        <div class="form-group">
          <label class="form-label">封面图 <span class="hint">可选，添加后在搜索和列表中显示</span></label>
          <div class="cover-row">
            <div class="cover-preview-box" id="cover-preview">
              ${coverUrl ? `<img src="${coverUrl}" style="width:100%; height:100%; object-fit: cover; border-radius: 5px;">` : '封面预览'}
            </div>
            <div class="stack">
              <button type="button" class="btn btn-sm" id="pick-cover">选择图片</button>
              <button type="button" class="btn btn-sm btn-ghost" id="remove-cover" ${!coverUrl ? 'disabled' : ''}>移除封面</button>
            </div>
          </div>
        </div>

        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">字数</label>
            <input type="number" class="form-input" id="f-wordCount" value="${novel.wordCount || ''}" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">章节数</label>
            <input type="number" class="form-input" id="f-chapterCount" value="${novel.chapterCount || ''}" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">卷数</label>
            <input type="number" class="form-input" id="f-volumeCount" value="${novel.volumeCount || ''}" min="0">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">最后阅读到的位置 <span class="hint">可以是卷、章节数、或章节名</span></label>
          <div class="form-row">
            <select class="form-select" id="f-posType" style="max-width: 160px;">
              <option value="volume" ${novel.lastReadPosition?.type === 'volume' ? 'selected' : ''}>卷</option>
              <option value="chapter_number" ${novel.lastReadPosition?.type === 'chapter_number' ? 'selected' : ''}>章节号</option>
              <option value="chapter_name" ${novel.lastReadPosition?.type === 'chapter_name' || !novel.lastReadPosition ? 'selected' : ''}>章节名</option>
            </select>
            <input type="text" class="form-input" id="f-posValue" value="${Utils.escapeHtml(novel.lastReadPosition?.value || '')}" placeholder="例如：第3卷 / 第45章 / 序章">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">小说文件 <span class="hint">压缩包 / 多卷 epub / txt 等，仅存储与导出</span></label>
          <div id="files-list"></div>
          <button type="button" class="btn btn-sm btn-ghost" id="add-files" style="margin-top: 6px;">+ 添加文件</button>
        </div>

        <div class="form-group">
          <label class="form-label">插图 <span class="hint">可选</span></label>
          <div id="illusts-list"></div>
          <button type="button" class="btn btn-sm btn-ghost" id="add-illust" style="margin-top: 6px;">+ 添加插图</button>
        </div>

        <div class="form-group">
          <label class="form-label">整体评价</label>
          <textarea class="form-textarea" id="f-overallReview" rows="5" placeholder="对这本小说的整体评价...">${Utils.escapeHtml(novel.overallReview || '')}</textarea>
        </div>

        <div class="form-actions">
          <a href="${isEdit ? `#/detail/${encodeURIComponent(novel.id)}` : '#/'}" class="btn btn-secondary">取消</a>
          <button type="button" class="btn btn-primary" id="btn-save">${isEdit ? '保存修改' : '添加'}</button>
        </div>
      </div>
    `;

    bindForm(container, novel, isEdit);
  }

  function bindForm(container, novel, isEdit) {
    // Alt titles (simple list editor)
    let altTitles = [...(novel.altTitles || [])];
    const altTitlesContainer = container.querySelector('#alt-titles-input');
    function renderAltTitles() {
      altTitlesContainer.innerHTML = altTitles.map((t, i) => `
        <div class="repeat-section">
          <div class="row">
            <input type="text" class="form-input" data-alt="${i}" value="${Utils.escapeHtml(t)}">
            <button type="button" class="icon-btn" data-alt-del="${i}" title="删除">✕</button>
          </div>
        </div>
      `).join('') + `<button type="button" class="btn btn-sm btn-ghost repeat-add" id="add-alt">+ 添加别名</button>`;
      altTitlesContainer.querySelectorAll('[data-alt]').forEach(inp => {
        inp.oninput = () => { altTitles[+inp.dataset.alt] = inp.value; };
      });
      altTitlesContainer.querySelectorAll('[data-alt-del]').forEach(btn => {
        btn.onclick = () => { altTitles.splice(+btn.dataset.altDel, 1); renderAltTitles(); };
      });
      altTitlesContainer.querySelector('#add-alt').onclick = () => { altTitles.push(''); renderAltTitles(); };
    }
    renderAltTitles();

    // Tags
    let tags = [...(novel.tags || [])];
    Components.mountTagInput(container.querySelector('#tags-input'), tags, (v) => { tags = v; });

    // Rating
    let rating = novel.rating || 0;
    Components.mountStarRating(container.querySelector('#rating-input'), rating, (v) => { rating = v; });

    // Links (repeatable)
    let links = (novel.links || []).map(l => ({ ...l }));
    if (!links.length) links.push({ label: '', url: '' });
    const linksList = container.querySelector('#links-list');
    function renderLinks() {
      linksList.innerHTML = links.map((l, i) => `
        <div class="repeat-section">
          <div class="row">
            <input type="text" class="form-input" data-link-label="${i}" placeholder="标签（例如：esjzone）" value="${Utils.escapeHtml(l.label || '')}">
            <input type="text" class="form-input" data-link-url="${i}" placeholder="https://" value="${Utils.escapeHtml(l.url || '')}">
            <button type="button" class="icon-btn" data-link-del="${i}" title="删除">✕</button>
          </div>
        </div>
      `).join('');
      linksList.querySelectorAll('[data-link-label]').forEach(inp => {
        inp.oninput = () => { links[+inp.dataset.linkLabel].label = inp.value; };
      });
      linksList.querySelectorAll('[data-link-url]').forEach(inp => {
        inp.oninput = () => { links[+inp.dataset.linkUrl].url = inp.value; };
      });
      linksList.querySelectorAll('[data-link-del]').forEach(btn => {
        btn.onclick = () => { links.splice(+btn.dataset.linkDel, 1); if (!links.length) links.push({ label: '', url: '' }); renderLinks(); };
      });
    }
    renderLinks();
    container.querySelector('#add-link').onclick = () => { links.push({ label: '', url: '' }); renderLinks(); };

    // Cover image
    let coverImage = novel.coverImage || null;
    let coverImageType = novel.coverImageType || null;
    const coverPreview = container.querySelector('#cover-preview');
    container.querySelector('#pick-cover').onclick = async () => {
      const files = await Utils.pickFile('image/*', false);
      if (!files.length) return;
      coverImage = files[0];
      coverImageType = files[0].type;
      const url = URL.createObjectURL(coverImage);
      objectUrls.push(url);
      coverPreview.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit: cover; border-radius: 5px;">`;
      container.querySelector('#remove-cover').disabled = false;
    };
    container.querySelector('#remove-cover').onclick = () => {
      coverImage = null;
      coverImageType = null;
      coverPreview.innerHTML = '封面预览';
      container.querySelector('#remove-cover').disabled = true;
    };

    // Files
    let filesArr = (novel.files || []).map(f => ({ ...f }));
    const filesList = container.querySelector('#files-list');
    function renderFiles() {
      if (!filesArr.length) {
        filesList.innerHTML = '<div class="muted text-sm">暂无文件</div>';
        return;
      }
      filesList.innerHTML = filesArr.map((f, i) => `
        <div class="repeat-section">
          <div class="row">
            <span class="file-icon">${fileIcon(f.name)}</span>
            <span class="file-name" title="${Utils.escapeHtml(f.name)}">${Utils.escapeHtml(f.name)}</span>
            <span class="file-size muted text-sm">${Utils.formatSize(f.size || f.blob?.size || 0)}</span>
            <button type="button" class="icon-btn" data-file-del="${i}" title="删除">✕</button>
          </div>
        </div>
      `).join('');
      filesList.querySelectorAll('[data-file-del]').forEach(btn => {
        btn.onclick = () => { filesArr.splice(+btn.dataset.fileDel, 1); renderFiles(); };
      });
    }
    renderFiles();
    container.querySelector('#add-files').onclick = async () => {
      const picked = await Utils.pickFile('', true);
      if (!picked.length) return;
      for (const f of picked) {
        filesArr.push({ name: f.name, type: f.type, size: f.size, blob: f });
      }
      renderFiles();
    };

    // Illustrations
    let illusts = (novel.illustrations || []).map(i => ({ ...i }));
    const illustsList = container.querySelector('#illusts-list');
    function renderIllusts() {
      if (!illusts.length) {
        illustsList.innerHTML = '<div class="muted text-sm">暂无插图</div>';
        return;
      }
      illustsList.innerHTML = illusts.map((im, i) => {
        const u = URL.createObjectURL(im.blob);
        objectUrls.push(u);
        return `
          <div class="repeat-section">
            <div class="row">
              <img src="${u}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; flex: 0 0 auto;">
              <span class="file-name" title="${Utils.escapeHtml(im.name)}">${Utils.escapeHtml(im.name)}</span>
              <button type="button" class="icon-btn" data-illust-del="${i}" title="删除">✕</button>
            </div>
          </div>
        `;
      }).join('');
      illustsList.querySelectorAll('[data-illust-del]').forEach(btn => {
        btn.onclick = () => { illusts.splice(+btn.dataset.illustDel, 1); renderIllusts(); };
      });
    }
    renderIllusts();
    container.querySelector('#add-illust').onclick = async () => {
      const picked = await Utils.pickFile('image/*', true);
      if (!picked.length) return;
      for (const f of picked) {
        illusts.push({ name: f.name, type: f.type, blob: f });
      }
      renderIllusts();
    };

    // Save
    container.querySelector('#btn-save').onclick = async () => {
      const mainTitle = container.querySelector('#f-mainTitle').value.trim();
      if (!mainTitle) { Utils.toast('请填写主要小说名字', 'error'); return; }

      const updated = {
        ...novel,
        mainTitle,
        altTitles: altTitles.map(s => s.trim()).filter(Boolean),
        originalTitle: container.querySelector('#f-originalTitle').value.trim(),
        author: container.querySelector('#f-author').value.trim(),
        tags,
        rating,
        links: links.filter(l => l.url && l.url.trim()).map(l => ({ label: l.label?.trim() || '', url: l.url.trim() })),
        coverImage,
        coverImageType,
        wordCount: numOrNull(container.querySelector('#f-wordCount').value),
        chapterCount: numOrNull(container.querySelector('#f-chapterCount').value),
        volumeCount: numOrNull(container.querySelector('#f-volumeCount').value),
        lastReadPosition: {
          type: container.querySelector('#f-posType').value,
          value: container.querySelector('#f-posValue').value.trim()
        },
        files: filesArr,
        illustrations: illusts,
        overallReview: container.querySelector('#f-overallReview').value
      };
      if (!updated.lastReadPosition.value) updated.lastReadPosition = null;

      try {
        const saved = await DB.saveNovel(updated);
        Utils.toast(isEdit ? '已保存修改' : '已添加', 'success');
        Utils.navigate(`/detail/${encodeURIComponent(saved.id)}`);
      } catch (e) {
        Utils.toast('保存失败：' + (e.message || e), 'error');
      }
    };
  }

  function numOrNull(v) {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function fileIcon(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['epub'].includes(ext)) return '📕';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
    if (['txt'].includes(ext)) return '📄';
    if (['pdf'].includes(ext)) return '📕';
    return '📁';
  }

  global.EditView = { render };
})(window);

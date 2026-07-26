// Sync view: import via URL hash (from userscript), manual JSON import/export, userscript install guide
(function (global) {
  'use strict';

  async function render(container, query) {
    Components.mountSpinner(container);

    const novelsCount = (await DB.getAllNovels()).length;
    let pendingImport = null;

    // Check for URL hash import (format: #/sync?import=<base64> OR #/sync#import=<base64>)
    // We accept both query-style and hash-style. The userscript will navigate to:
    //   https://<github-pages-url>/#/sync?import=<base64-encoded-data>
    const hashParams = new URLSearchParams();
    const rawHash = location.hash.replace(/^#\/sync\??/, '');
    if (rawHash.startsWith('import=')) {
      hashParams.set('import', rawHash.substring('import='.length));
    } else if (query && query.import) {
      hashParams.set('import', query.import);
    }
    const importData = hashParams.get('import');
    if (importData) {
      pendingImport = Utils.decodeFromHash(importData);
    }

    container.innerHTML = `
      <div class="row" style="margin-bottom: 16px;">
        <a href="#/" class="btn btn-ghost btn-sm">← 返回书架</a>
        <h1 style="margin: 0; flex: 1; font-size: 22px;">同步与导入</h1>
        <span class="muted text-sm">当前书架共 ${novelsCount} 本</span>
      </div>

      <div id="import-status"></div>

      <div class="sync-grid">
        <div class="sync-card">
          <h2>🐍 本地脚本自动同步（推荐）</h2>
          <div class="desc">
            在本地运行 Python 脚本，自动登录 esjzone.cc / novelia.cc 抓取阅读历史，
            并启动本地服务器自动打开本站完成导入。账号信息保存在本地 <code>sync/config.json</code>。
          </div>
          <ol>
            <li>编辑 <code>sync/config.json</code> 填入 esjzone / novelia 账号</li>
            <li>安装依赖：<code>pip install -r sync/requirements.txt</code></li>
            <li>运行：<code>python sync/sync.py</code></li>
            <li>脚本会自动抓取两个站点的阅读记录并打开浏览器完成导入</li>
          </ol>
          <div class="actions">
            <button type="button" class="btn btn-primary btn-sm" id="copy-sync-cmd">📋 复制运行命令</button>
            <button type="button" class="btn btn-sm" id="copy-site-url">📋 复制本站地址</button>
          </div>
        </div>

        <div class="sync-card">
          <h2>🎭 Tampermonkey 用户脚本</h2>
          <div class="desc">
            通过 Tampermonkey 用户脚本，在你登录 esjzone.cc / novelia.cc 时手动触发抓取，
            跳转回本站通过 URL 自动导入。无需本地 Python 环境。
          </div>
          <ol>
            <li>安装 <a href="https://www.tampermonkey.net/" target="_blank" rel="noopener">Tampermonkey</a> 浏览器扩展</li>
            <li>点击下方"安装用户脚本"按钮，在新页面按提示安装</li>
            <li>登录并打开 <code>esjzone.cc/my/view</code> 或 <code>n.novelia.cc/read-history</code></li>
            <li>页面右上角会出现"同步到阅读记录"按钮，点击即可自动跳转回本站并完成导入</li>
          </ol>
          <div class="actions">
            <button type="button" class="btn btn-primary btn-sm" id="install-userscript">📜 安装用户脚本</button>
            <a href="userscript/novel-sync.user.js" download class="btn btn-sm" target="_blank">⬇ 下载 .user.js</a>
          </div>
        </div>

        <div class="sync-card">
          <h2>📥 手动导入 / 导出</h2>
          <div class="desc">
            从备份文件或用户脚本下载的 JSON 文件导入；或将书架导出为 JSON 备份。
          </div>
          <div class="actions">
            <button type="button" class="btn btn-primary btn-sm" id="import-json">📥 导入 JSON</button>
            <button type="button" class="btn btn-sm" id="export-json">📤 导出全部</button>
            <button type="button" class="btn btn-sm btn-danger" id="clear-all">🗑 清空全部</button>
          </div>
          <div class="mt-12">
            <label class="form-label">合并模式</label>
            <select class="form-select" id="import-mode" style="max-width: 240px;">
              <option value="merge" selected>合并（保留已有，补充缺失字段）</option>
              <option value="overwrite">覆盖（同名的用导入数据替换）</option>
            </select>
          </div>
        </div>

        <div class="sync-card" style="grid-column: 1 / -1;">
          <h2>ℹ️ 关于同步机制</h2>
          <div class="desc">
            <p style="margin: 6px 0;">
              由于 <code>esjzone.cc</code> 和 <code>n.novelia.cc</code> 需要登录且禁止跨域访问（CORS），
              本站作为静态站点无法直接抓取这些网站的数据。本地 Python 脚本在你本地运行，
              登录两个站点并提取阅读记录，再通过 URL hash 跳转回本站完成导入。
            </p>
            <p style="margin: 6px 0;">
              <strong>数据匹配与去重：</strong>导入时按 "主标题 + 作者" 进行匹配，
              已存在的小说会按所选合并模式处理，避免重复添加。
            </p>
            <p style="margin: 6px 0;">
              <strong>数据隐私：</strong>所有数据仅存储在你当前浏览器的 IndexedDB 中，不会上传到任何服务器。
              账号密码仅保存在本地的 <code>sync/config.json</code>，请勿提交到 git。
            </p>
          </div>
        </div>
      </div>
    `;

    bindEvents(container);

    // Auto-process pending import
    if (pendingImport) {
      await processImport(container, pendingImport, 'merge', true);
      // Clean URL
      history.replaceState(null, '', '#/sync');
    }
  }

  function bindEvents(container) {
    // Install userscript - open the .user.js file which Tampermonkey will intercept
    container.querySelector('#install-userscript').onclick = () => {
      window.open('userscript/novel-sync.user.js', '_blank');
    };

    // Copy sync command (for local Python script)
    const copyCmdBtn = container.querySelector('#copy-sync-cmd');
    if (copyCmdBtn) {
      copyCmdBtn.onclick = async () => {
        const cmd = 'pip install -r sync/requirements.txt && python sync/sync.py';
        try {
          await navigator.clipboard.writeText(cmd);
          Utils.toast('已复制命令：' + cmd, 'success');
        } catch (e) {
          Utils.toast('复制失败，请手动复制：' + cmd, 'error');
        }
      };
    }

    // Copy site URL
    container.querySelector('#copy-site-url').onclick = async () => {
      const url = location.origin + location.pathname + '#/sync';
      try {
        await navigator.clipboard.writeText(url);
        Utils.toast('已复制本站地址：' + url, 'success');
      } catch (e) {
        // Fallback
        const input = document.createElement('input');
        input.value = url;
        document.body.appendChild(input);
        input.select();
        try { Utils.toast('已复制：' + url, 'success'); }
        catch (e2) { Utils.toast('复制失败，请手动复制：' + url, 'error'); }
        input.remove();
      }
    };

    // Import JSON
    container.querySelector('#import-json').onclick = async () => {
      const files = await Utils.pickFile('.json,application/json', false);
      if (!files.length) return;
      try {
        const text = await files[0].text();
        const data = JSON.parse(text);
        const mode = container.querySelector('#import-mode').value;
        await processImport(container, data, mode, false);
      } catch (e) {
        showStatus(container, '导入失败：' + (e.message || e), 'error');
      }
    };

    // Export JSON
    container.querySelector('#export-json').onclick = async () => {
      try {
        const data = await DB.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const ts = new Date().toISOString().slice(0, 10);
        Utils.downloadBlob(blob, `novel-records-${ts}.json`);
        Utils.toast(`已导出 ${data.novels.length} 本小说`, 'success');
      } catch (e) {
        Utils.toast('导出失败：' + (e.message || e), 'error');
      }
    };

    // Clear all
    container.querySelector('#clear-all').onclick = async () => {
      const ok = await Utils.confirm('确认清空所有小说记录？此操作不可恢复！建议先导出备份。', { danger: true, okText: '清空全部' });
      if (!ok) return;
      const ok2 = await Utils.confirm('再次确认：将删除全部 ' + (await DB.getAllNovels()).length + ' 本小说记录', { danger: true, okText: '我确认要清空' });
      if (!ok2) return;
      await DB.clearAllNovels();
      Utils.toast('已清空全部记录', 'success');
      render(container, {});
    };
  }

  async function processImport(container, data, mode, isAutoSync) {
    const statusEl = container.querySelector('#import-status');
    if (!data || (data.format !== 'novel-records-export' && !Array.isArray(data.novels) && !Array.isArray(data))) {
      showStatus(container, '导入失败：数据格式无效', 'error');
      return;
    }
    // Normalize: support both { novels: [...] } and [...]
    let importData;
    if (Array.isArray(data)) {
      importData = { format: 'novel-records-export', version: 1, novels: data };
    } else {
      importData = data;
    }

    showStatus(container, `正在导入 ${importData.novels.length} 本小说...`, 'info');
    try {
      const result = await DB.importAll(importData, mode);
      const total = result.added + result.updated + result.skipped;
      let msg = `导入完成 ✓ 共处理 ${total} 本：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`;
      if (isAutoSync) msg = '✨ 自动同步成功！' + msg;
      showStatus(container, msg, 'success');
      Utils.toast('导入完成', 'success');
    } catch (e) {
      showStatus(container, '导入失败：' + (e.message || e), 'error');
    }
  }

  function showStatus(container, message, type) {
    const el = container.querySelector('#import-status');
    el.innerHTML = `<div class="sync-status ${type}">${Utils.escapeHtml(message)}</div>`;
    if (type === 'success') {
      setTimeout(() => { el.innerHTML = ''; }, 8000);
    }
  }

  global.SyncView = { render };
})(window);

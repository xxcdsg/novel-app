// ==UserScript==
// @name         小说阅读记录同步
// @namespace    https://github.com/novel-records/novel-sync
// @version      1.0.0
// @description  从 esjzone.cc / novelia.cc 抓取阅读记录并同步到你的小说阅读记录站点（GitHub Pages 静态站点）
// @author       you
// @match        https://www.esjzone.cc/my/view*
// @match        https://www.esjzone.cc/my/view/*
// @match        https://n.novelia.cc/read-history*
// @match        https://n.novelia.cc/read-history/*
// @match        https://n.novelia.cc/history*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @connect      *
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/novel-records/novel-sync
// @supportURL   https://github.com/novel-records/novel-sync/issues
// @updateURL    https://raw.githubusercontent.com/novel-records/novel-sync/main/userscript/novel-sync.user.js
// @downloadURL  https://raw.githubusercontent.com/novel-records/novel-sync/main/userscript/novel-sync.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * 配置区：把 SITE_URL 改成你部署在 GitHub Pages 上的站点地址
   * 例如：https://yourname.github.io/novel-app/
   * ============================================================ */
  const SITE_URL = GM_getValue('SITE_URL', 'https://yourname.github.io/novel-app/');

  // 注册菜单命令：修改目标站点 URL
  GM_registerMenuCommand('🔧 设置目标站点 URL', () => {
    const cur = GM_getValue('SITE_URL', '');
    const v = prompt('目标站点 URL（GitHub Pages 地址，以 / 结尾）：', cur);
    if (v != null) {
      const trimmed = v.trim().replace(/[^\/]$/, '$&/');
      GM_setValue('SITE_URL', trimmed);
      alert('已保存，新地址：' + trimmed);
    }
  });

  // 注册菜单命令：手动触发当前页面同步
  GM_registerMenuCommand('🔄 立即同步当前页面', () => syncCurrentPage(true));

  const SITE = detectSite();
  if (!SITE) {
    console.warn('[novel-sync] 未识别的站点，脚本终止');
    return;
  }

  console.log('[novel-sync] 已加载，识别站点：', SITE.name);

  // 在页面右上角添加同步按钮
  addButton();

  /**
   * 识别当前站点
   */
  function detectSite() {
    const host = location.hostname;
    const path = location.pathname;
    if (host.includes('esjzone.cc')) {
      return { name: 'esjzone', host, base: 'https://www.esjzone.cc', parser: parseEsjzone };
    }
    if (host.includes('novelia.cc')) {
      return { name: 'novelia', host, base: 'https://n.novelia.cc', parser: parseNovelia };
    }
    return null;
  }

  function addButton() {
    const btn = document.createElement('button');
    btn.textContent = '📚 同步到阅读记录';
    btn.style.cssText = `
      position: fixed; top: 12px; right: 12px; z-index: 99999;
      padding: 8px 14px; background: #4f6df5; color: white;
      border: none; border-radius: 6px; cursor: pointer;
      font-size: 13px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,.2);
      transition: background .15s, transform .1s;
    `;
    btn.onmouseenter = () => btn.style.background = '#3b58e0';
    btn.onmouseleave = () => btn.style.background = '#4f6df5';
    btn.onclick = () => syncCurrentPage(false);
    document.body.appendChild(btn);

    // 状态指示
    const status = document.createElement('div');
    status.id = 'novel-sync-status';
    status.style.cssText = `
      position: fixed; top: 56px; right: 12px; z-index: 99999;
      padding: 6px 12px; background: rgba(0,0,0,.8); color: white;
      border-radius: 6px; font-size: 12px; max-width: 320px;
      display: none; line-height: 1.5;
    `;
    document.body.appendChild(status);
  }

  function setStatus(text, type) {
    const el = document.getElementById('novel-sync-status');
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
    if (type === 'error') el.style.background = 'rgba(229,72,77,.95)';
    else if (type === 'success') el.style.background = 'rgba(45,164,78,.95)';
    else el.style.background = 'rgba(0,0,0,.8)';
  }

  /**
   * 主同步流程
   */
  async function syncCurrentPage(silent) {
    setStatus('正在解析页面...', 'info');
    try {
      const records = await SITE.parser(document);
      if (!records.length) {
        setStatus('未在当前页面找到阅读记录', 'error');
        if (!silent) alert('未在当前页面找到阅读记录。\n请确保你在阅读历史页面（esjzone.cc/my/view 或 n.novelia.cc/read-history）');
        return;
      }
      setStatus(`已解析 ${records.length} 条记录，正在抓取详细信息...`, 'info');

      // 可选：抓取每本书的详情页（OG 标签），最多 20 本避免过载
      const enriched = await enrichRecords(records.slice(0, 50));

      setStatus(`准备导入 ${enriched.length} 本小说...`, 'info');

      // 构造导入数据
      const payload = {
        format: 'novel-records-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        source: SITE.name,
        novels: enriched
      };

      // 编码并跳转
      const encoded = encodeForHash(payload);
      const targetUrl = SITE_URL + (SITE_URL.includes('#') ? '' : '#') + '/sync?import=' + encoded;

      setStatus('正在打开阅读记录站点...', 'success');
      // 使用 GM_openInTab 优先；如果不可用则 location.href
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(targetUrl, { active: true, insert: true });
      } else {
        window.open(targetUrl, '_blank');
      }
      setTimeout(() => setStatus('', ''), 3000);
    } catch (e) {
      console.error('[novel-sync]', e);
      setStatus('同步失败：' + (e.message || e), 'error');
    }
  }

  /* ============================================================
   * esjzone.cc 解析
   * 阅读历史页面：https://www.esjzone.cc/my/view
   * ============================================================ */
  async function parseEsjzone(doc) {
    const records = [];

    // 尝试多种可能的列表选择器
    // esjzone 历史通常显示为卡片列表
    const selectors = [
      '.my-history-list .item, .my-history-list > div',
      '.history-list .item, .history-list > div',
      '.list-item, .book-item',
      '[class*="history"] [class*="item"]',
      'a[href*="/detail/"]'  // 兜底：所有指向详情页的链接
    ];

    let items = [];
    for (const sel of selectors) {
      items = doc.querySelectorAll(sel);
      if (items.length) break;
    }

    const seen = new Set();
    items.forEach(item => {
      try {
        // 找标题与链接
        const link = item.tagName === 'A' ? item : item.querySelector('a[href*="/detail/"], a[href*="/archives/"]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        if (!href) return;
        const url = new URL(href, SITE.base).href;
        if (seen.has(url)) return;
        seen.add(url);

        // 标题
        let title = '';
        const titleEl = item.querySelector('.title, .book-title, .name, h3, h4, h5, strong, b') || link;
        title = (titleEl.textContent || '').trim();
        if (!title) title = (link.textContent || '').trim();
        title = title.replace(/\s+/g, ' ').trim();
        if (!title) return;

        // 封面图
        let coverUrl = null;
        const img = item.querySelector('img');
        if (img) {
          coverUrl = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
          if (coverUrl) coverUrl = new URL(coverUrl, SITE.base).href;
        }

        // 作者
        let author = '';
        const authorEl = item.querySelector('.author, .book-author, [class*="author"]');
        if (authorEl) author = (authorEl.textContent || '').trim().replace(/^作者[:：]\s*/, '');

        // 最后阅读位置
        let lastPos = '';
        const posEl = item.querySelector('.last, .last-read, .chapter, [class*="chapter"], [class*="last"]');
        if (posEl) lastPos = (posEl.textContent || '').trim();

        // 从 URL 提取 sourceId
        const idMatch = url.match(/\/(?:detail|archives)\/(\d+)/);
        const sourceId = idMatch ? idMatch[1] : null;

        records.push({
          mainTitle: title,
          author,
          coverImageUrl: coverUrl,
          lastReadPosition: lastPos ? { type: 'chapter_name', value: lastPos } : null,
          links: [{ label: 'esjzone', url }],
          source: 'esjzone',
          sourceId,
          sources: ['esjzone']
        });
      } catch (e) {
        console.warn('[novel-sync] 解析条目失败', e);
      }
    });

    return records;
  }

  /* ============================================================
   * novelia.cc 解析
   * 阅读历史页面：https://n.novelia.cc/read-history
   * ============================================================ */
  async function parseNovelia(doc) {
    const records = [];

    const selectors = [
      '.history-list .item, .history-list > *',
      '.read-history .item, .read-history > *',
      '.history-item, .history-entry',
      '[class*="history"] [class*="item"], [class*="history"] [class*="book"]',
      'a[href*="/novel/"], a[href*="/book/"]'
    ];

    let items = [];
    for (const sel of selectors) {
      items = doc.querySelectorAll(sel);
      if (items.length) break;
    }

    const seen = new Set();
    items.forEach(item => {
      try {
        const link = item.tagName === 'A' ? item : item.querySelector('a[href*="/novel/"], a[href*="/book/"], a[href*="/archives/"]');
        if (!link) return;
        const href = link.getAttribute('href') || '';
        if (!href) return;
        const url = new URL(href, SITE.base).href;
        if (seen.has(url)) return;
        seen.add(url);

        let title = '';
        const titleEl = item.querySelector('.title, .book-title, .name, .novel-title, h3, h4, h5, strong, b') || link;
        title = (titleEl.textContent || '').trim();
        if (!title) title = (link.textContent || '').trim();
        title = title.replace(/\s+/g, ' ').trim();
        if (!title) return;

        let coverUrl = null;
        const img = item.querySelector('img');
        if (img) {
          coverUrl = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '';
          if (coverUrl) coverUrl = new URL(coverUrl, SITE.base).href;
        }

        let author = '';
        const authorEl = item.querySelector('.author, .novel-author, [class*="author"]');
        if (authorEl) author = (authorEl.textContent || '').trim().replace(/^作者[:：]\s*/, '');

        let lastPos = '';
        const posEl = item.querySelector('.last, .last-chapter, .chapter, [class*="chapter"], [class*="last"], [class*="progress"]');
        if (posEl) lastPos = (posEl.textContent || '').trim();

        const idMatch = url.match(/\/(?:novel|book|archives)\/([^\/?#]+)/);
        const sourceId = idMatch ? idMatch[1] : null;

        records.push({
          mainTitle: title,
          author,
          coverImageUrl: coverUrl,
          lastReadPosition: lastPos ? { type: 'chapter_name', value: lastPos } : null,
          links: [{ label: 'novelia', url }],
          source: 'novelia',
          sourceId,
          sources: ['novelia']
        });
      } catch (e) {
        console.warn('[novel-sync] 解析条目失败', e);
      }
    });

    return records;
  }

  /* ============================================================
   * 详情页信息增强（OG 标签）
   * ============================================================ */
  async function enrichRecords(records) {
    const limit = Math.min(records.length, 20);
    const enriched = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      // 复制基础数据
      const out = { ...r };
      // 为前 limit 条抓取详情页获取更完整信息
      if (i < limit && r.links && r.links[0]) {
        try {
          const html = await fetchText(r.links[0].url);
          const og = extractOGTags(html);
          if (og['og:title'] && !out.mainTitle) out.mainTitle = og['og:title'];
          if (og['og:novel:author'] || og['article:author']) {
            out.author = out.author || (og['og:novel:author'] || og['article:author']);
          }
          if (og['og:novel:novel_tag'] || og['og:novel:tag']) {
            const tag = og['og:novel:novel_tag'] || og['og:novel:tag'];
            out.tags = tag.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
          }
          if (og['og:novel:latest_chapter_name']) {
            out.lastReadPosition = out.lastReadPosition || {
              type: 'chapter_name',
              value: og['og:novel:latest_chapter_name']
            };
          }
          if (og['og:image'] && !out.coverImageUrl) {
            out.coverImageUrl = new URL(og['og:image'], SITE.base).href;
          }
          if (og['og:novel:status']) {
            out.tags = out.tags || [];
            const status = og['og:novel:status'];
            if (!out.tags.includes(status)) out.tags.push(status);
          }
        } catch (e) {
          console.warn('[novel-sync] 详情页抓取失败', r.links[0].url, e);
        }
        // 小延迟避免被限流
        await sleep(150);
      }

      // 抓取封面图（如果有 URL 但还没下载）
      if (out.coverImageUrl) {
        try {
          const blob = await fetchBlob(out.coverImageUrl);
          if (blob) {
            out._cover = blobToBase64(blob);
            out._coverType = blob.type;
          }
        } catch (e) {
          console.warn('[novel-sync] 封面下载失败', out.coverImageUrl);
        }
        // 不在数据中保留 URL（已下载为 base64）
        // 但保留 URL 以便后续重新尝试
      }

      enriched.push(out);
    }
    return enriched;
  }

  /**
   * 从 HTML 提取 OG 标签
   */
  function extractOGTags(html) {
    const og = {};
    // 使用 DOMParser 更可靠
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('meta[property]').forEach(m => {
        const key = m.getAttribute('property');
        const val = m.getAttribute('content');
        if (key && val && key.startsWith('og:')) og[key] = val;
      });
      // 也提取 article: 标签
      doc.querySelectorAll('meta[property^="article:"]').forEach(m => {
        const key = m.getAttribute('property');
        const val = m.getAttribute('content');
        if (key && val) og[key] = val;
      });
      // 提取 JSON-LD
      const ld = doc.querySelector('script[type="application/ld+json"]');
      if (ld) {
        try {
          const data = JSON.parse(ld.textContent);
          if (data && data.author && data.author.name && !og['og:novel:author']) {
            og['article:author'] = data.author.name;
          }
        } catch (e) {}
      }
    } catch (e) {
      // Fallback: 正则
      const re = /<meta\s+property=["'](og:[^"']+)["']\s+content=["']([^"']*)["']/gi;
      let m;
      while ((m = re.exec(html)) !== null) og[m[1]] = m[2];
    }
    return og;
  }

  function fetchText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload: r => r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error('HTTP ' + r.status)),
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout'))
      });
    });
  }

  function fetchBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        timeout: 20000,
        onload: r => {
          if (r.status >= 200 && r.status < 300 && r.response) {
            resolve(r.response);
          } else {
            reject(new Error('HTTP ' + r.status));
          }
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Timeout'))
      });
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const idx = result.indexOf(',');
        resolve(idx >= 0 ? result.substring(idx + 1) : result);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  function encodeForHash(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    // URL-safe base64 (no padding) so it works in URL hash without breaking = parsing
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();

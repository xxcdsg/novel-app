// IndexedDB wrapper for novel reading records
(function (global) {
  'use strict';

  const DB_NAME = 'novel-records-db';
  const DB_VERSION = 1;
  const STORE_NOVELS = 'novels';
  const STORE_SETTINGS = 'settings';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NOVELS)) {
          const store = db.createObjectStore(STORE_NOVELS, { keyPath: 'id' });
          store.createIndex('mainTitle', 'mainTitle', { unique: false });
          store.createIndex('author', 'author', { unique: false });
          store.createIndex('source', 'source', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return openDB().then(db => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---------- Novel CRUD ----------

  async function getAllNovels() {
    const store = await tx(STORE_NOVELS, 'readonly');
    return reqToPromise(store.getAll());
  }

  async function getNovel(id) {
    const store = await tx(STORE_NOVELS, 'readonly');
    return reqToPromise(store.get(id));
  }

  async function saveNovel(novel) {
    const store = await tx(STORE_NOVELS, 'readwrite');
    if (!novel.id) novel.id = Utils.uuid();
    const now = Date.now();
    if (!novel.createdAt) novel.createdAt = now;
    novel.updatedAt = now;
    await reqToPromise(store.put(novel));
    return novel;
  }

  async function deleteNovel(id) {
    const store = await tx(STORE_NOVELS, 'readwrite');
    return reqToPromise(store.delete(id));
  }

  async function clearAllNovels() {
    const store = await tx(STORE_NOVELS, 'readwrite');
    return reqToPromise(store.clear());
  }

  // ---------- Settings ----------

  async function getSetting(key, defaultValue) {
    const store = await tx(STORE_SETTINGS, 'readonly');
    const result = await reqToPromise(store.get(key));
    return result === undefined ? defaultValue : result.value;
  }

  async function setSetting(key, value) {
    const store = await tx(STORE_SETTINGS, 'readwrite');
    await reqToPromise(store.put({ key, value }));
    return value;
  }

  // ---------- Bulk import / export ----------

  // Encode novel for export: replace Blob fields with base64 (smaller & portable)
  async function novelToExportable(novel) {
    const out = { ...novel };
    // Remove blob fields; they will be exported as separate base64
    out._cover = novel.coverImage ? await Utils.blobToBase64(novel.coverImage) : null;
    out._coverType = novel.coverImageType || null;
    out.coverImage = null;
    out._illustrations = [];
    if (Array.isArray(novel.illustrations)) {
      for (const ill of novel.illustrations) {
        out._illustrations.push({
          name: ill.name,
          type: ill.type,
          data: await Utils.blobToBase64(ill.blob)
        });
      }
    }
    out._files = [];
    if (Array.isArray(novel.files)) {
      for (const f of novel.files) {
        out._files.push({
          name: f.name,
          type: f.type,
          size: f.size,
          data: await Utils.blobToBase64(f.blob)
        });
      }
    }
    return out;
  }

  async function exportableToNovel(obj) {
    const novel = { ...obj };
    if (obj._cover) {
      // 旧格式：base64 嵌入 JSON
      novel.coverImage = Utils.base64ToBlob(obj._cover, obj._coverType || 'image/jpeg');
      novel.coverImageType = obj._coverType;
    } else if (obj._coverFile) {
      // 新格式：图片文件引用，需要从 sync/images/ 加载
      try {
        const resp = await fetch('sync/images/' + encodeURIComponent(obj._coverFile));
        if (resp.ok) {
          const blob = await resp.blob();
          novel.coverImage = blob;
          novel.coverImageType = obj._coverType || blob.type || 'image/jpeg';
        } else {
          novel.coverImage = null;
        }
      } catch (e) {
        console.warn('[exportableToNovel] 加载封面失败:', obj._coverFile, e);
        novel.coverImage = null;
      }
    } else {
      novel.coverImage = null;
    }
    delete novel._cover;
    delete novel._coverType;
    delete novel._coverFile;
    novel.illustrations = (obj._illustrations || []).map(i => ({
      name: i.name,
      type: i.type,
      blob: Utils.base64ToBlob(i.data, i.type || 'application/octet-stream')
    }));
    delete novel._illustrations;
    novel.files = (obj._files || []).map(f => ({
      name: f.name,
      type: f.type,
      size: f.size,
      blob: Utils.base64ToBlob(f.data, f.type || 'application/octet-stream')
    }));
    delete novel._files;
    return novel;
  }

  async function exportAll() {
    const novels = await getAllNovels();
    const out = [];
    for (const n of novels) out.push(await novelToExportable(n));
    return {
      format: 'novel-records-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      novels: out
    };
  }

  // Import: returns { added, updated, skipped }
  async function importAll(importData, mode) {
    // mode: 'merge' | 'overwrite'
    let added = 0, updated = 0, skipped = 0;
    if (!importData || !Array.isArray(importData.novels)) {
      throw new Error('无效的导入数据格式');
    }
    const existing = await getAllNovels();
    const byKey = new Map();
    for (const n of existing) {
      byKey.set(n.id, n);
      byKey.set(matchKey(n), n);
    }
    for (const item of importData.novels) {
      const novel = await exportableToNovel(item);
      const existingMatch = byKey.get(novel.id) || byKey.get(matchKey(novel));
      if (existingMatch) {
        if (mode === 'overwrite') {
          novel.id = existingMatch.id;
          novel.createdAt = existingMatch.createdAt;
          await saveNovel(novel);
          byKey.set(novel.id, novel);
          byKey.set(matchKey(novel), novel);
          updated++;
        } else {
          // merge: keep existing, fill missing fields
          const merged = mergeNovel(existingMatch, novel);
          if (merged !== existingMatch) {
            await saveNovel(merged);
            byKey.set(merged.id, merged);
            byKey.set(matchKey(merged), merged);
            updated++;
          } else {
            skipped++;
          }
        }
      } else {
        novel.id = Utils.uuid();
        await saveNovel(novel);
        byKey.set(novel.id, novel);
        byKey.set(matchKey(novel), novel);
        added++;
      }
    }
    return { added, updated, skipped };
  }

  // Match key: lowercase main title + author, for dedup across sources
  function matchKey(novel) {
    const t = (novel.mainTitle || '').trim().toLowerCase();
    const a = (novel.author || '').trim().toLowerCase();
    return `t:${t}|a:${a}`;
  }

  // 从 GitHub 上的 /sync/sync-data.json 加载备份
  // 仅在 IndexedDB 为空或缺少关键字段（如 description）且用户未禁用时执行
  // 返回 true 表示已加载备份，false 表示跳过
  async function initFromBackupIfEmpty() {
    // 用户已主动关闭自动恢复，跳过
    const disabled = await getSetting('autoRestoreDisabled', false);
    if (disabled) return false;

    // 避免循环：检查 sessionStorage 标记（防止 fetch 失败后无限刷新）
    if (sessionStorage.getItem('novel-restore-attempted')) {
      return false;
    }
    sessionStorage.setItem('novel-restore-attempted', '1');

    const existing = await getAllNovels();
    // 检查是否需要恢复：IndexedDB 为空，或已有数据缺少 description 字段（旧数据）
    const needRestore = existing.length === 0 ||
      existing.some(n => !n.description && !n._coverFile && !n.coverImage);
    if (!needRestore) return false;

    try {
      const resp = await fetch('sync/sync-data.json', { cache: 'no-store' });
      if (!resp.ok) {
        console.warn('[initFromBackupIfEmpty] sync-data.json not found:', resp.status);
        return false;
      }
      const data = await resp.json();
      if (!data || !Array.isArray(data.novels) || data.novels.length === 0) {
        return false;
      }
      // 静默导入（merge 模式），不弹 toast
      const result = await importAll(data, 'merge');
      console.info(`[initFromBackupIfEmpty] 从备份恢复: +${result.added} 新增, ${result.updated} 更新, ${result.skipped} 跳过`);
      return result.added > 0 || result.updated > 0;
    } catch (e) {
      console.warn('[initFromBackupIfEmpty] failed:', e);
      return false;
    }
  }

  // Merge non-conflicting fields from src into dst
  function mergeNovel(dst, src) {
    let changed = false;
    const result = { ...dst };
    const fields = ['mainTitle', 'originalTitle', 'author', 'description', 'overallReview', 'wordCount', 'chapterCount', 'volumeCount'];
    for (const f of fields) {
      if ((result[f] == null || result[f] === '') && (src[f] != null && src[f] !== '')) {
        result[f] = src[f];
        changed = true;
      }
    }
    // arrays
    if ((!result.altTitles || result.altTitles.length === 0) && src.altTitles?.length) {
      result.altTitles = [...src.altTitles];
      changed = true;
    }
    if ((!result.tags || result.tags.length === 0) && src.tags?.length) {
      result.tags = [...src.tags];
      changed = true;
    } else if (src.tags?.length) {
      const merged = new Set([...(result.tags || []), ...src.tags]);
      if (merged.size !== (result.tags?.length || 0)) {
        result.tags = [...merged];
        changed = true;
      }
    }
    // links
    if (src.links?.length) {
      const existing = new Set((result.links || []).map(l => l.url));
      const newLinks = [...(result.links || [])];
      for (const l of src.links) {
        if (l.url && !existing.has(l.url)) {
          newLinks.push(l);
          existing.add(l.url);
          changed = true;
        }
      }
      result.links = newLinks;
    }
    // rating: take higher if both
    if ((result.rating == null || result.rating === 0) && src.rating) {
      result.rating = src.rating;
      changed = true;
    }
    // cover
    if (!result.coverImage && src.coverImage) {
      result.coverImage = src.coverImage;
      result.coverImageType = src.coverImageType;
      changed = true;
    }
    // lastReadPosition: prefer the more recent source's
    if (src.lastReadPosition && (!result.lastReadPosition || !result.lastReadPosition.value)) {
      result.lastReadPosition = src.lastReadPosition;
      changed = true;
    }
    // reading reviews: append new ones by date+position+content
    if (src.readingReviews?.length) {
      const existing = result.readingReviews || [];
      const seen = new Set(existing.map(r => `${r.date}|${r.position || ''}|${r.content || ''}`));
      for (const r of src.readingReviews) {
        const k = `${r.date}|${r.position || ''}|${r.content || ''}`;
        if (!seen.has(k)) {
          existing.push(r);
          seen.add(k);
          changed = true;
        }
      }
      result.readingReviews = existing;
    }
    // source tracking
    if (src.source && (!result.source || result.source !== src.source)) {
      if (!result.sources) result.sources = result.source ? [result.source] : [];
      if (!result.sources.includes(src.source)) {
        result.sources.push(src.source);
        changed = true;
      }
    }
    return changed ? result : dst;
  }

  global.DB = {
    getAllNovels,
    getNovel,
    saveNovel,
    deleteNovel,
    clearAllNovels,
    getSetting,
    setSetting,
    exportAll,
    importAll,
    novelToExportable,
    exportableToNovel,
    matchKey,
    mergeNovel,
    initFromBackupIfEmpty
  };
})(window);

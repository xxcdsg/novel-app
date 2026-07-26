#!/usr/bin/env python3
"""
小说阅读记录自动同步脚本

登录 esjzone.cc 和 novelia.cc，抓取阅读历史，同步到本地小说记录站点。

用法:
    python sync/sync.py                # 同步并打开浏览器
    python sync/sync.py --no-browser   # 只保存 JSON，不打开浏览器
    python sync/sync.py --debug        # 显示详细调试信息
"""

import argparse
import base64
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import webbrowser
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

# ===== 路径与常量 =====
SCRIPT_DIR = Path(__file__).parent.resolve()
PROJECT_DIR = SCRIPT_DIR.parent
CONFIG_PATH = SCRIPT_DIR / 'config.json'
SYNC_DATA_PATH = SCRIPT_DIR / 'sync-data.json'

SITE_PORT = 8000
SITE_URL = f'http://localhost:{SITE_PORT}/'

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) '
    'Chrome/120.0.0.0 Safari/537.36'
)

DEBUG = False


def log(msg, level='info'):
    """简单日志输出"""
    prefix = {'info': '', 'ok': '✓ ', 'warn': '⚠ ', 'err': '❌ '}.get(level, '')
    print(f'{prefix}{msg}')


def dprint(msg):
    """调试日志"""
    if DEBUG:
        print(f'  [debug] {msg}')


# ===== 配置加载 =====
def load_config():
    if not CONFIG_PATH.exists():
        log(f'配置文件不存在: {CONFIG_PATH}', 'err')
        log(f'请复制 config.example.json 为 config.json 并填写账号信息')
        sys.exit(1)
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


# ===== URL hash 编码（与前端 utils.js 一致）=====
def encode_for_hash(obj):
    json_str = json.dumps(obj, ensure_ascii=False)
    b64 = base64.b64encode(json_str.encode('utf-8')).decode('ascii')
    # URL-safe base64，去掉 padding
    return b64.replace('+', '-').replace('/', '_').rstrip('=')


# ===== 本地服务器管理 =====
def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def ensure_server_running():
    """确保本地 HTTP 服务器在运行，返回 subprocess.Popen 或 None"""
    if is_port_in_use(SITE_PORT):
        log(f'本地服务器已在 {SITE_PORT} 端口运行')
        return None
    log(f'启动本地服务器 (端口 {SITE_PORT})...')
    proc = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(SITE_PORT)],
        cwd=str(PROJECT_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    )
    for _ in range(20):
        if is_port_in_use(SITE_PORT):
            log(f'服务器已启动: {SITE_URL}', 'ok')
            return proc
        time.sleep(0.25)
    log('服务器启动失败，请手动运行: python -m http.server 8000', 'warn')
    return None


# ===== esjzone.cc =====

def login_esjzone(session, email, password):
    """登录 esjzone.cc，返回 True/False"""
    base = 'https://www.esjzone.cc'

    # 1. 获取登录页（拿 cookies）
    dprint('GET /my/login')
    try:
        session.get(f'{base}/my/login', timeout=15)
    except Exception as e:
        log(f'无法访问登录页: {e}', 'err')
        return False

    # 2. 通过 JinJing RPC 获取 auth token
    dprint('POST /my/login plxf=getAuthToken')
    try:
        r = session.post(f'{base}/my/login', data={'plxf': 'getAuthToken'},
                         timeout=15, headers={'X-Requested-With': 'XMLHttpRequest'})
        m = re.search(r'<JinJing>([^<]+)</JinJing>', r.text)
        if not m:
            log(f'获取 auth token 失败，响应: {r.text[:200]}', 'err')
            return False
        token = m.group(1)
    except Exception as e:
        log(f'获取 auth token 异常: {e}', 'err')
        return False

    # 3. POST 到 /inc/mem_login.php，带 Authorization 头
    dprint(f'POST /inc/mem_login.php (Authorization: {token[:20]}...)')
    try:
        r = session.post(f'{base}/inc/mem_login.php', data={
            'email': email,
            'pwd': password,
            'remember_me': 'on'
        }, timeout=15, headers={
            'Authorization': token,
            'X-Requested-With': 'XMLHttpRequest'
        })
        dprint(f'登录响应: {r.status_code} {r.text[:200]}')
        if r.status_code != 200:
            log(f'登录请求失败: HTTP {r.status_code}', 'err')
            return False
        # 尝试解析 JSON 响应
        try:
            data = r.json()
            if data.get('status') == 200:
                log('登录成功', 'ok')
                return True
            else:
                log(f'登录失败: {data.get("msg", "未知错误")}', 'err')
                return False
        except json.JSONDecodeError:
            # 非 JSON 响应，检查是否是错误页面
            if 'login' in r.text.lower() and len(r.text) < 2000:
                log('登录失败：凭据可能错误', 'err')
                return False
            # 如果响应较长，可能是登录成功后直接返回了页面
            log('登录响应非 JSON，假设成功', 'warn')
            return True
    except Exception as e:
        log(f'登录请求异常: {e}', 'err')
        return False


def scrape_esjzone(session):
    """抓取 esjzone.cc 阅读历史"""
    base = 'https://www.esjzone.cc'
    url = f'{base}/my/view'

    log(f'抓取 {url}...')
    try:
        r = session.get(url, timeout=15)
        r.raise_for_status()
    except Exception as e:
        log(f'抓取失败: {e}', 'err')
        return []

    # 检查是否被重定向到登录页
    if 'window.location.href' in r.text and '/my/login' in r.text:
        log('未登录或会话已过期', 'err')
        return []

    soup = BeautifulSoup(r.text, 'html.parser')
    records = []
    seen = set()

    # 保存 HTML 供调试
    if DEBUG:
        debug_path = SCRIPT_DIR / 'debug_esjzone_view.html'
        with open(debug_path, 'w', encoding='utf-8') as f:
            f.write(r.text)
        dprint(f'HTML 已保存到 {debug_path}')

    # esjzone /my/view 页面结构：
    #   <tr id="view_XXX">
    #     <td><div class="product-item"><div class="product-info">
    #       <div class="view-log"><div class="column">
    #         <h5 class="product-title"><a href="/detail/XXX.html">标题</a></h5>
    #       </div></div>
    #       <div class="book-ep"><span>最後觀看：<a href="/forum/...">章节名</a></span></div>
    #     </div></div></td>
    #   </tr>
    items = soup.select('tr[id^="view_"]')
    dprint(f'tr[id^="view_"]: {len(items)} 条')

    # 兜底：所有指向详情页的链接
    if not items:
        items = soup.select('a[href*="/detail/"]')
        dprint(f'兜底选择器: a[href*="/detail/"] ({len(items)} 条)')

    for item in items:
        try:
            # 标题与链接（在 h5.product-title a 内）
            title_link = item.select_one('h5.product-title a, .product-title a')
            if not title_link:
                # 兜底：item 本身就是 <a>
                if item.name == 'a':
                    title_link = item
                else:
                    title_link = item.find('a', href=True)
            if not title_link:
                continue

            href = title_link.get('href', '')
            if not href or '/detail/' not in href:
                continue
            full_url = urljoin(base, href)
            if full_url in seen:
                continue
            seen.add(full_url)

            title = title_link.get_text(strip=True)
            title = ' '.join(title.split())
            if not title:
                continue

            # 最后阅读位置（在 .book-ep span 内，格式："最後觀看：<a>章节名</a>"）
            # 优先取 <a> 内的章节名，去掉 "最後觀看：" 前缀
            last_pos = ''
            book_ep = item.select_one('.book-ep')
            if book_ep:
                ep_link = book_ep.find('a')
                if ep_link:
                    last_pos = ep_link.get_text(strip=True)
                else:
                    ep_text = book_ep.get_text(strip=True)
                    last_pos = re.sub(r'^最後觀看[:：]\s*', '', ep_text)

            # 封面图（列表页通常没有，留空，由详情页 OG 标签补充）
            cover_url = None

            # 作者（列表页通常没有，留空，由详情页 OG 标签补充）
            author = ''

            # sourceId
            id_match = re.search(r'/detail/(\d+)', full_url)
            source_id = id_match.group(1) if id_match else None

            records.append({
                'mainTitle': title,
                'author': author,
                'coverImageUrl': cover_url,
                'lastReadPosition': {'type': 'chapter_name', 'value': last_pos} if last_pos else None,
                'links': [{'label': 'esjzone', 'url': full_url}],
                'source': 'esjzone',
                'sourceId': source_id,
                'sources': ['esjzone']
            })
        except Exception as e:
            dprint(f'解析条目失败: {e}')

    return records


# ===== novelia.cc =====

def login_novelia(session, username, password):
    """登录 novelia.cc，返回 True/False"""
    auth_base = 'https://auth.novelia.cc'

    dprint(f'POST {auth_base}/api/v1/auth/login')
    try:
        r = session.post(f'{auth_base}/api/v1/auth/login', json={
            'app': 'n',
            'username': username,
            'password': password
        }, timeout=15)
        dprint(f'登录响应: {r.status_code} {r.text[:200]}')
        if r.status_code != 200:
            try:
                err = r.json()
                log(f'登录失败: {err.get("message", r.text[:100])}', 'err')
            except Exception:
                log(f'登录失败: HTTP {r.status_code}', 'err')
            return False
    except Exception as e:
        log(f'登录请求异常: {e}', 'err')
        return False

    # 登录成功，响应是 JWT 文本
    # 然后需要 refresh 拿到 n.novelia.cc 域可用的 JWT
    dprint('POST /api/v1/auth/refresh?app=n')
    try:
        r2 = session.post(f'{auth_base}/api/v1/auth/refresh?app=n', timeout=15)
        dprint(f'refresh 响应: {r2.status_code} {r2.text[:200]}')
        if r2.status_code != 200:
            log(f'refresh token 失败: HTTP {r2.status_code}', 'err')
            return False
        # 保存 JWT
        jwt = r2.text.strip()
        session.headers['Authorization'] = f'Bearer {jwt}'
        log('登录成功', 'ok')
        return True
    except Exception as e:
        log(f'refresh 请求异常: {e}', 'err')
        return False


def scrape_novelia(session):
    """抓取 novelia.cc 阅读历史"""
    api_base = 'https://n.novelia.cc'

    # 调用 API 获取阅读历史
    url = f'{api_base}/api/user/read-history?page=0&pageSize=100'
    log(f'调用 API {url}...')
    try:
        r = session.get(url, timeout=15)
        dprint(f'API 响应: {r.status_code} {r.text[:500]}')
        if r.status_code == 401:
            log('未登录或 token 已过期', 'err')
            return []
        if r.status_code != 200:
            log(f'API 请求失败: HTTP {r.status_code}', 'err')
            return []
        data = r.json()
    except Exception as e:
        log(f'API 请求异常: {e}', 'err')
        return []

    # 解析 JSON 响应，尝试多种可能的数据结构
    records = []
    items = []

    # 可能的结构1: { data: [...] }
    if isinstance(data, dict):
        items = data.get('data') or data.get('list') or data.get('items') or data.get('records') or []
    elif isinstance(data, list):
        items = data

    dprint(f'解析到 {len(items)} 条记录')

    for item in items:
        try:
            # novelia API 实际返回的字段：titleZh / titleJp / keywords / cover / author 等
            # 优先用中文标题，没有再用日文/英文
            title = (item.get('titleZh') or item.get('titleJp') or
                     item.get('novelName') or item.get('name') or
                     item.get('title') or item.get('novelTitle') or '')
            title = title.strip() if isinstance(title, str) else ''
            if not title:
                continue

            author = item.get('author') or item.get('novelAuthor') or ''
            author = author.strip() if isinstance(author, str) else ''

            # 小说 ID 与 URL
            # novelia 详情页格式: https://n.novelia.cc/novel/{providerId}/{novelId}
            novel_id = (item.get('novelId') or item.get('id') or
                        item.get('novel_id') or item.get('bookId') or '')
            provider_id = item.get('providerId') or item.get('provider_id') or ''
            if novel_id and provider_id:
                novel_url = f'{api_base}/novel/{provider_id}/{novel_id}'
            elif novel_id:
                novel_url = f'{api_base}/novel/{novel_id}'
            else:
                novel_url = ''
            # 详情 API: https://n.novelia.cc/api/novel/{providerId}/{novelId}
            novel_api_url = f'{api_base}/api/novel/{provider_id}/{novel_id}' if novel_id and provider_id else ''

            # 封面图
            cover_url = item.get('cover') or item.get('coverUrl') or item.get('coverImage') or item.get('img') or None

            # 标签（novelia 用 keywords 字段，可能是字符串或数组）
            tags = []
            keywords = item.get('keywords') or item.get('tags')
            if keywords:
                if isinstance(keywords, str):
                    tags = [t.strip() for t in re.split(r'[,，、]', keywords) if t.strip()]
                elif isinstance(keywords, list):
                    tags = [str(t).strip() for t in keywords if t]

            # 最后阅读位置
            last_pos = ''
            last_chapter = (item.get('lastChapter') or item.get('lastChapterName') or
                            item.get('lastReadChapter') or item.get('chapterTitle') or
                            item.get('lastReadPosition') or '')
            if last_chapter:
                last_pos = last_chapter.strip() if isinstance(last_chapter, str) else str(last_chapter)
            elif item.get('lastReadChapterNo'):
                last_pos = f"第{item['lastReadChapterNo']}章"

            # 进度百分比
            progress = item.get('progress') or item.get('readProgress')
            if not last_pos and progress:
                last_pos = f"进度 {progress}%"

            record = {
                'mainTitle': title,
                'author': author,
                'coverImageUrl': cover_url,
                'lastReadPosition': {'type': 'chapter_name', 'value': last_pos} if last_pos else None,
                'links': [{'label': 'novelia', 'url': novel_url}] if novel_url else [],
                'source': 'novelia',
                'sourceId': str(novel_id) if novel_id else None,
                'sources': ['novelia']
            }
            if tags:
                record['tags'] = tags
            # 同时保存日文标题作为 otherTitles
            if item.get('titleJp') and item.get('titleJp') != title:
                record['otherTitles'] = [item['titleJp']]
            # 保存详情 API URL 供 enrich 使用
            if novel_api_url:
                record['_detailApiUrl'] = novel_api_url

            records.append(record)
        except Exception as e:
            dprint(f'解析条目失败: {e}')

    return records


# ===== 详情页增强 =====

def enrich_with_og(session, records, base_url, limit=20):
    """根据 source 调用对应的详情抓取器，补充作者、标签、封面、简介等信息"""
    enriched = []
    to_fetch = min(len(records), limit)
    for i, r in enumerate(records):
        out = dict(r)
        source = r.get('source')
        if i < to_fetch:
            try:
                if source == 'esjzone':
                    enrich_esjzone_detail(session, out, base_url)
                elif source == 'novelia':
                    enrich_novelia_detail(session, out)
                else:
                    # 兜底：用通用 OG 标签
                    if r.get('links') and r['links'][0].get('url'):
                        enrich_generic_og(session, out, r['links'][0]['url'], base_url)
                dprint(f'详情 [{i+1}/{to_fetch}] {out.get("mainTitle","")[:30]}: '
                       f'封面={"有" if out.get("coverImageUrl") else "无"} '
                       f'标签={len(out.get("tags", []))} '
                       f'简介={"有" if out.get("description") else "无"}')
            except Exception as e:
                dprint(f'详情 [{i+1}/{to_fetch}] 失败: {e}')
            time.sleep(0.15)  # 避免限流
            if (i + 1) % 5 == 0:
                log(f'  详情页抓取进度: {i+1}/{to_fetch}')
        # 清理临时字段
        out.pop('_detailApiUrl', None)
        enriched.append(out)
    return enriched


def enrich_esjzone_detail(session, out, base_url):
    """抓取 esjzone 详情页，提取封面图、作者、其他書名、标签、简介"""
    if not (out.get('links') and out['links'][0].get('url')):
        return
    link_url = out['links'][0]['url']
    resp = session.get(link_url, timeout=15)
    if resp.status_code != 200:
        return
    soup = BeautifulSoup(resp.text, 'html.parser')

    # 封面图：.product-gallery img
    if not out.get('coverImageUrl'):
        gallery_img = soup.select_one('.product-gallery img')
        if gallery_img:
            src = gallery_img.get('src') or gallery_img.get('data-src') or ''
            if src:
                out['coverImageUrl'] = urljoin(base_url, src)

    # 作者、其他書名：从 ul.book-detail li 提取
    for li in soup.select('ul.book-detail li'):
        text = li.get_text(strip=True)
        if text.startswith('作者:'):
            if not out.get('author'):
                a = li.find('a')
                if a:
                    out['author'] = a.get_text(strip=True)
        elif text.startswith('其他書名:') or text.startswith('其他书名:'):
            # 提取 <strong> 之后的文本作为原始语言标题
            other = li.get_text(strip=True).replace('其他書名:', '').replace('其他书名:', '').strip()
            if other:
                out.setdefault('otherTitles', [])
                if other not in out['otherTitles']:
                    out['otherTitles'].append(other)
                if not out.get('originalTitle'):
                    out['originalTitle'] = other

    # 标签：.widget-tags a.tag（注意：不要用 a[href*="/tags/"]，会把作者误识别为标签）
    tag_els = soup.select('.widget-tags a.tag')
    if tag_els:
        tags = [a.get_text(strip=True) for a in tag_els if a.get_text(strip=True)]
        # 去重并保留顺序
        existing = out.get('tags', [])
        merged = list(existing)
        for t in tags:
            if t not in merged:
                merged.append(t)
        out['tags'] = merged

    # 简介：.description
    if not out.get('description'):
        desc_el = soup.select_one('.description')
        if desc_el:
            # 保留段落结构，转为纯文本
            desc_text = desc_el.get_text('\n', strip=True)
            # 压缩多余空行
            desc_text = re.sub(r'\n{3,}', '\n\n', desc_text)
            if desc_text:
                out['description'] = desc_text


def enrich_novelia_detail(session, out):
    """调用 novelia 详情 API，提取作者、简介、总字数、类型"""
    api_url = out.get('_detailApiUrl')
    if not api_url:
        return
    resp = session.get(api_url, timeout=15)
    if resp.status_code != 200:
        return
    try:
        data = resp.json()
    except Exception:
        return

    # 作者：authors 数组
    if not out.get('author') and data.get('authors'):
        authors = data['authors']
        if isinstance(authors, list) and authors:
            names = [a.get('name', '').strip() for a in authors if isinstance(a, dict) and a.get('name')]
            if names:
                out['author'] = ' / '.join(names)

    # 简介：introductionZh 优先，没有再用 introductionJp
    if not out.get('description'):
        desc = data.get('introductionZh') or data.get('introductionJp')
        if desc and isinstance(desc, str):
            out['description'] = desc.strip()

    # 标签：keywords + attentions
    existing_tags = out.get('tags', [])
    merged = list(existing_tags)
    for key in ('keywords', 'attentions'):
        vals = data.get(key)
        if isinstance(vals, list):
            for v in vals:
                v = str(v).strip()
                if v and v not in merged:
                    merged.append(v)
    if merged:
        out['tags'] = merged

    # 总字数
    if not out.get('wordCount') and data.get('totalCharacters'):
        try:
            out['wordCount'] = int(data['totalCharacters'])
        except (TypeError, ValueError):
            pass

    # 封面图：尝试多个可能的字段名
    if not out.get('coverImageUrl'):
        cover = (data.get('cover') or data.get('coverUrl') or
                 data.get('coverImage') or data.get('img') or
                 data.get('image') or data.get('imageUrl'))
        if cover and isinstance(cover, str) and cover.strip():
            cover = cover.strip()
            # 相对路径补全为绝对路径
            if cover.startswith('//'):
                cover = 'https:' + cover
            elif cover.startswith('/'):
                cover = 'https://n.novelia.cc' + cover
            out['coverImageUrl'] = cover

    # novelia 详情 API 没有封面字段，根据 providerId 从原始 source 抓 OG 标签
    # provider 映射：kakuyomu → kakuyomu.jp, syosetu → ncode.syosetu.com, hameln → syosetu.org
    if not out.get('coverImageUrl') and api_url:
        parts = api_url.rstrip('/').split('/')
        if len(parts) >= 2:
            provider_id = parts[-2]
            novel_id = parts[-1]
            src_url = None
            if provider_id == 'kakuyomu':
                src_url = f'https://kakuyomu.jp/works/{novel_id}'
            elif provider_id == 'syosetu':
                src_url = f'https://ncode.syosetu.com/{novel_id}/'
            elif provider_id == 'hameln':
                src_url = f'https://syosetu.org/novel/{novel_id}/'
            if src_url:
                try:
                    src_resp = session.get(src_url, timeout=15)
                    if src_resp.status_code == 200:
                        og = extract_og_tags(src_resp.text)
                        if og.get('og:image'):
                            out['coverImageUrl'] = og['og:image']
                except Exception as e:
                    dprint(f'novelia 原始 source OG 抓取失败 ({provider_id}): {e}')

    # 类型（连载中/完结等）作为标签的一部分
    if data.get('type'):
        type_str = str(data['type']).strip()
        if type_str and type_str not in out.get('tags', []):
            out.setdefault('tags', [])
            out['tags'].append(type_str)


def enrich_generic_og(session, out, link_url, base_url):
    """通用 OG 标签兜底"""
    resp = session.get(link_url, timeout=15)
    if resp.status_code != 200:
        return
    og = extract_og_tags(resp.text)
    if og.get('og:title') and not out.get('mainTitle'):
        out['mainTitle'] = og['og:title']
    author = og.get('og:novel:author') or og.get('article:author')
    if author and not out.get('author'):
        out['author'] = author
    tag = og.get('og:novel:novel_tag') or og.get('og:novel:tag')
    if tag:
        out['tags'] = [t.strip() for t in re.split(r'[,，、]', tag) if t.strip()]
    if og.get('og:image') and not out.get('coverImageUrl'):
        out['coverImageUrl'] = urljoin(base_url, og['og:image'])


def extract_og_tags(html):
    og = {}
    soup = BeautifulSoup(html, 'html.parser')
    for m in soup.find_all('meta', attrs={'property': True}):
        key = m.get('property')
        val = m.get('content')
        if key and val and (key.startswith('og:') or key.startswith('article:')):
            og[key] = val
    # JSON-LD
    ld = soup.find('script', {'type': 'application/ld+json'})
    if ld and ld.string:
        try:
            data = json.loads(ld.string)
            if isinstance(data, dict) and data.get('author', {}).get('name'):
                if 'article:author' not in og:
                    og['article:author'] = data['author']['name']
        except Exception:
            pass
    return og


# ===== 封面图下载 =====

def download_covers(session, records):
    """下载封面图，保存到 sync/images/ 文件夹，JSON 中只存文件名引用

    部分图床（如 novelpia.com）返回 Content-Type: application/octet-stream，
    但实际是图片。通过 URL 扩展名或文件头魔术字节判断。
    """
    images_dir = SCRIPT_DIR / 'images'
    images_dir.mkdir(exist_ok=True)

    downloaded = 0
    # 图片扩展名 -> MIME 类型映射
    img_ext_map = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.file': 'image/jpeg',  # novelpia 的 .file 实际是 jpg
    }
    # MIME -> 扩展名
    mime_ext_map = {
        'image/jpeg': '.jpg', 'image/png': '.png',
        'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
    }
    # 文件头魔术字节
    def sniff_image(content):
        if content.startswith(b'\xff\xd8\xff'):
            return 'image/jpeg'
        if content.startswith(b'\x89PNG\r\n\x1a\n'):
            return 'image/png'
        if content.startswith(b'GIF87a') or content.startswith(b'GIF89a'):
            return 'image/gif'
        if content[:4] == b'RIFF' and content[8:12] == b'WEBP':
            return 'image/webp'
        return None

    for r in records:
        url = r.get('coverImageUrl')
        if not url:
            continue
        try:
            resp = session.get(url, timeout=20)
            if resp.status_code != 200 or not resp.content:
                continue
            content_type = resp.headers.get('Content-Type', '')
            # 1. Content-Type 已是图片
            if 'image' in content_type:
                final_type = content_type.split(';')[0].strip()
            # 2. 用文件头判断
            else:
                sniffed = sniff_image(resp.content)
                if sniffed:
                    final_type = sniffed
                # 3. 用 URL 扩展名判断
                else:
                    url_lower = url.lower().split('?')[0]
                    final_type = None
                    for ext, mime in img_ext_map.items():
                        if url_lower.endswith(ext):
                            final_type = mime
                            break
                    if not final_type:
                        dprint(f'封面类型未知 {url}: Content-Type={content_type}')
                        continue

            # 生成文件名：用 source + sourceId 保证唯一，没有则用 hash(url)
            source = r.get('source', 'unknown')
            source_id = r.get('sourceId') or ''
            ext = mime_ext_map.get(final_type, '.jpg')
            if source_id:
                filename = f'{source}-{source_id}{ext}'
            else:
                # fallback: 用 url 的 hash
                url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()[:12]
                filename = f'{source}-{url_hash}{ext}'

            # 保存到 sync/images/
            img_path = images_dir / filename
            with open(img_path, 'wb') as f:
                f.write(resp.content)

            # JSON 中只存文件名引用（不再存 base64）
            r['_coverFile'] = filename
            r['_coverType'] = final_type
            # 删除旧的 _cover 字段（如果有）
            r.pop('_cover', None)
            downloaded += 1
        except Exception as e:
            dprint(f'封面下载失败 {url}: {e}')
    log(f'  下载封面: {downloaded}/{sum(1 for r in records if r.get("coverImageUrl"))}')
    return records


# ===== Git 备份推送 =====

def git_push_backup():
    """提交并推送 sync/ 目录到 GitHub（sync-data.json + images/ + sync.py），
    让 GitHub Pages 上的网站能加载最新备份和图片。"""
    log('推送备份到 GitHub...')
    try:
        # 检查是否在 git 仓库内
        result = subprocess.run(
            ['git', 'rev-parse', '--is-inside-work-tree'],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            log('当前目录不是 git 仓库，跳过推送', 'warn')
            return False

        # 检查是否有 remote
        result = subprocess.run(
            ['git', 'remote'],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=10
        )
        if not result.stdout.strip():
            log('未配置 git remote，跳过推送', 'warn')
            return False

        # 检查是否有改动（sync-data.json、images/、sync.py）
        sync_rel = SYNC_DATA_PATH.relative_to(PROJECT_DIR).as_posix()
        images_rel = (SCRIPT_DIR / 'images').relative_to(PROJECT_DIR).as_posix()
        sync_py_rel = (SCRIPT_DIR / 'sync.py').relative_to(PROJECT_DIR).as_posix()
        result = subprocess.run(
            ['git', 'status', '--porcelain', sync_rel, images_rel, sync_py_rel],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=10
        )
        if not result.stdout.strip():
            log('无改动，无需推送', 'ok')
            return True

        # git add（分别添加，避免误提交 config.json）
        for p in (sync_rel, images_rel, sync_py_rel):
            subprocess.run(['git', 'add', p],
                           cwd=str(PROJECT_DIR), check=True, capture_output=True, timeout=30)

        # git commit
        commit_msg = f'chore(sync): update sync-data.json + images ({datetime.now().strftime("%Y-%m-%d %H:%M")})'
        result = subprocess.run(
            ['git', 'commit', '-m', commit_msg],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            # commit 可能因为 nothing to commit 失败，不算错误
            dprint(f'commit 输出: {result.stdout} {result.stderr}')

        # git push
        result = subprocess.run(
            ['git', 'push'],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            log('备份已推送到 GitHub，Pages 会在 1-2 分钟后更新', 'ok')
            return True
        else:
            log(f'git push 失败: {result.stderr.strip() or result.stdout.strip()}', 'err')
            log('请手动执行: git push', 'warn')
            return False
    except subprocess.TimeoutExpired:
        log('git 操作超时（可能等待认证），跳过推送', 'warn')
        log('请手动执行: git add sync/sync-data.json sync/images sync/sync.py && git commit && git push', 'warn')
        return False
    except Exception as e:
        log(f'git 推送异常: {e}', 'err')
        return False


# ===== 主流程 =====

def main():
    parser = argparse.ArgumentParser(description='小说阅读记录自动同步')
    parser.add_argument('--no-browser', action='store_true', help='不自动打开浏览器')
    parser.add_argument('--debug', action='store_true', help='显示调试信息')
    parser.add_argument('--no-covers', action='store_true', help='不下载封面图')
    parser.add_argument('--no-push', action='store_true', help='不自动 git push 备份到 GitHub')
    args = parser.parse_args()

    global DEBUG
    DEBUG = args.debug

    print('=' * 60)
    print('  小说阅读记录自动同步')
    print('=' * 60)

    config = load_config()
    all_records = []
    # 跟踪哪些源本次成功抓取，未成功的源将从旧备份保留
    succeeded_sources = set()

    # ----- esjzone -----
    esj_cfg = config.get('esjzone')
    if esj_cfg and esj_cfg.get('email') and esj_cfg.get('password'):
        print('\n[1/2] 同步 esjzone.cc')
        session = requests.Session()
        session.headers['User-Agent'] = USER_AGENT
        if login_esjzone(session, esj_cfg['email'], esj_cfg['password']):
            records = scrape_esjzone(session)
            log(f'抓取到 {len(records)} 条记录', 'ok')
            if records:
                enrich_limit = config.get('enrich_limit', 200)
                if enrich_limit > 0:
                    log('抓取详情页补充信息...')
                    records = enrich_with_og(session, records, 'https://www.esjzone.cc', limit=enrich_limit)
                if config.get('download_covers', True) and not args.no_covers:
                    log('下载封面图...')
                    records = download_covers(session, records)
            all_records.extend(records)
            succeeded_sources.add('esjzone')
        else:
            log('esjzone 登录失败，跳过', 'warn')
    else:
        print('\n[1/2] 跳过 esjzone.cc（未配置）')

    # ----- novelia -----
    nov_cfg = config.get('novelia')
    if nov_cfg and nov_cfg.get('username') and nov_cfg.get('password'):
        print('\n[2/2] 同步 novelia.cc')
        session = requests.Session()
        session.headers['User-Agent'] = USER_AGENT
        if login_novelia(session, nov_cfg['username'], nov_cfg['password']):
            records = scrape_novelia(session)
            log(f'抓取到 {len(records)} 条记录', 'ok')
            if records:
                enrich_limit = config.get('enrich_limit', 200)
                if enrich_limit > 0:
                    log('抓取详情页补充信息...')
                    records = enrich_with_og(session, records, 'https://n.novelia.cc', limit=enrich_limit)
                if config.get('download_covers', True) and not args.no_covers:
                    log('下载封面图...')
                    records = download_covers(session, records)
            all_records.extend(records)
            succeeded_sources.add('novelia')
        else:
            log('novelia 登录失败，跳过', 'warn')
    else:
        print('\n[2/2] 跳过 novelia.cc（未配置）')

    # ----- 从旧备份补充未成功的源（避免数据丢失） -----
    if succeeded_sources and SYNC_DATA_PATH.exists():
        try:
            with open(SYNC_DATA_PATH, 'r', encoding='utf-8') as f:
                old_data = json.load(f)
            old_novels = old_data.get('novels', []) if isinstance(old_data, dict) else []
            # 按 source 分组旧数据
            old_by_source = {}
            for n in old_novels:
                src = n.get('source')
                if src:
                    old_by_source.setdefault(src, []).append(n)
            # 补充本次未成功的源
            for src, novels in old_by_source.items():
                if src not in succeeded_sources:
                    log(f'保留上次 {src} 的 {len(novels)} 本小说（本次未抓取）', 'warn')
                    all_records.extend(novels)
        except Exception as e:
            dprint(f'读取旧备份失败: {e}')

    # ----- 构建并保存数据 -----
    # 为每条记录生成稳定 id（基于 source + sourceId），避免每次恢复生成不同 UUID
    # 这样多设备/多会话恢复时同一本书的 id 一致，详情页链接可稳定访问
    for r in all_records:
        if r.get('id'):
            continue
        source = r.get('source') or 'unknown'
        source_id = r.get('sourceId') or ''
        if source_id:
            stable = f'{source}-{source_id}'
        else:
            # 没有 sourceId 时，用 mainTitle+author 的 hash
            key = f'{source}-{r.get("mainTitle", "")}-{r.get("author", "")}'
            stable = f'{source}-{hashlib.md5(key.encode("utf-8")).hexdigest()[:12]}'
        r['id'] = stable

    payload = {
        'format': 'novel-records-export',
        'version': 1,
        'exportedAt': datetime.now().isoformat(),
        'novels': all_records
    }

    with open(SYNC_DATA_PATH, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f'\n{"=" * 60}')
    log(f'数据已保存到 {SYNC_DATA_PATH}', 'ok')
    log(f'共 {len(all_records)} 本小说', 'ok')
    print('=' * 60)

    # 推送备份到 GitHub（让 GitHub Pages 上的网站能加载最新数据）
    if not args.no_push:
        git_push_backup()
    else:
        dprint('已跳过 git push（--no-push）')

    if not all_records:
        print('\n⚠ 未抓取到任何记录，请检查账号或网站结构是否变化')
        return

    # ----- 导入到网站 -----
    if args.no_browser:
        print(f'\n数据已保存。请手动导入 sync-data.json，或去掉 --no-browser 参数自动打开浏览器')
        return

    # 从 config 读取 site_url，默认为本地服务器
    site_url = config.get('site_url') or SITE_URL
    if not site_url.endswith('/'):
        site_url += '/'
    is_remote = not site_url.startswith('http://localhost') and not site_url.startswith('http://127.')

    print('\n准备导入到网站...')
    server_proc = None
    if not is_remote:
        # 本地模式：启动 http.server
        server_proc = ensure_server_running()
    else:
        # 远程模式（GitHub Pages 等）：直接打开远程站点
        log(f'使用远程站点: {site_url}')

    # 编码为 URL hash
    encoded = encode_for_hash(payload)

    # 如果数据太大（>1MB），去掉封面图避免 URL 过长
    # 浏览器 URL 长度限制通常在 2MB 左右，保守用 1MB
    if len(encoded) > 1_000_000:
        log('数据较大，URL hash 中省略封面图（完整数据已在 sync-data.json 中）', 'warn')
        light_payload = json.loads(json.dumps(payload))
        for n in light_payload['novels']:
            n.pop('_cover', None)
            n.pop('_coverType', None)
        encoded = encode_for_hash(light_payload)

    if len(encoded) > 2_000_000:
        log(f'URL hash 数据过大（{len(encoded)} 字符），浏览器可能无法打开', 'warn')
        log('建议改用本地模式（site_url 留空或设为 http://localhost:8000/）', 'warn')
        log('或手动通过 syncView 的"导入 JSON"按钮上传 sync-data.json', 'warn')

    import_url = f'{site_url}#/sync?import={encoded}'
    print(f'打开浏览器: {site_url}')
    webbrowser.open(import_url)

    print('\n' + '=' * 60)
    print('  ✓ 同步完成！浏览器已打开，数据将自动导入')
    print('=' * 60)

    if server_proc:
        print('\n本地服务器正在运行。按 Ctrl+C 停止。')
        try:
            server_proc.wait()
        except KeyboardInterrupt:
            server_proc.terminate()
            print('\n服务器已停止')


if __name__ == '__main__':
    main()

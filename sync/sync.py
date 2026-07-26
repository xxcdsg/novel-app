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
            novel_id = (item.get('novelId') or item.get('id') or
                        item.get('novel_id') or item.get('bookId') or '')
            novel_url = f'{api_base}/novel/{novel_id}' if novel_id else ''

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

            records.append(record)
        except Exception as e:
            dprint(f'解析条目失败: {e}')

    return records


# ===== 详情页增强（OG 标签）=====

def enrich_with_og(session, records, base_url, limit=20):
    """抓取详情页的 OG 标签，补充作者、标签等信息"""
    enriched = []
    to_fetch = min(len(records), limit)
    for i, r in enumerate(records):
        out = dict(r)
        if i < limit and r.get('links') and r['links'][0].get('url'):
            link_url = r['links'][0]['url']
            try:
                resp = session.get(link_url, timeout=15)
                if resp.status_code == 200:
                    og = extract_og_tags(resp.text)
                    if og.get('og:title') and not out.get('mainTitle'):
                        out['mainTitle'] = og['og:title']
                    author = og.get('og:novel:author') or og.get('article:author')
                    if author and not out.get('author'):
                        out['author'] = author
                    tag = og.get('og:novel:novel_tag') or og.get('og:novel:tag')
                    if tag:
                        out['tags'] = [t.strip() for t in re.split(r'[,，、]', tag) if t.strip()]
                    latest = og.get('og:novel:latest_chapter_name')
                    if latest and not out.get('lastReadPosition'):
                        out['lastReadPosition'] = {'type': 'chapter_name', 'value': latest}
                    if og.get('og:image') and not out.get('coverImageUrl'):
                        out['coverImageUrl'] = urljoin(base_url, og['og:image'])
                    if og.get('og:novel:status'):
                        out.setdefault('tags', [])
                        if og['og:novel:status'] not in out['tags']:
                            out['tags'].append(og['og:novel:status'])
                    dprint(f'详情 [{i+1}/{to_fetch}] {out.get("mainTitle","")[:20]}: og:title={og.get("og:title","")[:30]}')
                else:
                    dprint(f'详情 [{i+1}/{to_fetch}] HTTP {resp.status_code}')
            except Exception as e:
                dprint(f'详情 [{i+1}/{to_fetch}] 失败: {e}')
            time.sleep(0.15)  # 避免限流
            if (i + 1) % 5 == 0:
                log(f'  详情页抓取进度: {i+1}/{to_fetch}')
        enriched.append(out)
    return enriched


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
    """下载封面图，转为 base64（嵌入到导入数据中）"""
    downloaded = 0
    for r in records:
        url = r.get('coverImageUrl')
        if not url:
            continue
        try:
            resp = session.get(url, timeout=20)
            if resp.status_code == 200 and resp.content:
                content_type = resp.headers.get('Content-Type', 'image/jpeg')
                if 'image' in content_type:
                    b64 = base64.b64encode(resp.content).decode('ascii')
                    r['_cover'] = b64
                    r['_coverType'] = content_type
                    downloaded += 1
        except Exception as e:
            dprint(f'封面下载失败 {url}: {e}')
    log(f'  下载封面: {downloaded}/{sum(1 for r in records if r.get("coverImageUrl"))}')
    return records


# ===== Git 备份推送 =====

def git_push_backup():
    """提交并推送 sync/sync-data.json 到 GitHub，让 GitHub Pages 上的网站能加载最新备份。"""
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

        # 检查 sync-data.json 是否有改动
        rel_path = SYNC_DATA_PATH.relative_to(PROJECT_DIR).as_posix()
        result = subprocess.run(
            ['git', 'status', '--porcelain', rel_path],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=10
        )
        if not result.stdout.strip():
            log('sync-data.json 无改动，无需推送', 'ok')
            return True

        # git add
        subprocess.run(['git', 'add', rel_path],
                       cwd=str(PROJECT_DIR), check=True, capture_output=True, timeout=30)

        # git commit
        commit_msg = f'chore(sync): update sync-data.json ({datetime.now().strftime("%Y-%m-%d %H:%M")})'
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
        log('请手动执行: git add sync/sync-data.json && git commit && git push', 'warn')
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
                enrich_limit = config.get('enrich_limit', 20)
                if enrich_limit > 0:
                    log('抓取详情页补充信息...')
                    records = enrich_with_og(session, records, 'https://www.esjzone.cc', limit=enrich_limit)
                if config.get('download_covers', True) and not args.no_covers:
                    log('下载封面图...')
                    records = download_covers(session, records)
            all_records.extend(records)
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
                enrich_limit = config.get('enrich_limit', 20)
                if enrich_limit > 0:
                    log('抓取详情页补充信息...')
                    records = enrich_with_og(session, records, 'https://n.novelia.cc', limit=enrich_limit)
                if config.get('download_covers', True) and not args.no_covers:
                    log('下载封面图...')
                    records = download_covers(session, records)
            all_records.extend(records)
        else:
            log('novelia 登录失败，跳过', 'warn')
    else:
        print('\n[2/2] 跳过 novelia.cc（未配置）')

    # ----- 构建并保存数据 -----
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

/**
 * DuckDuckGo Lite 搜索引擎适配器
 * 无需 API Key，通过 POST https://lite.duckduckgo.com/lite/ 抓取 HTML 结果
 *
 * POST 参数:
 *   q    - 搜索词
 *   kl   - 地区/语言 (cn-zh 等)
 *   df   - 时间范围 (空='Any Time', d='Past Day', w='Past Week', m='Past Month', y='Past Year')
 *
 * Cookie 需同步设置 kl 和 df 值
 */
export const name = 'duckduckgo';

export function isAvailable() { return true; }

// region -> DDG kl 值; 常见地区映射，未知地区使用 wt-wt (全球)
const KL_MAP = {
  'zh-CN': 'cn-zh', 'zh-TW': 'tw-tzh',
  'en-US': 'us-en', 'en-GB': 'uk-en',
  'ja-JP': 'jp-jpn', 'ko-KR': 'kr-krn',
  'de-DE': 'de-de', 'fr-FR': 'fr-fr',
  'es-ES': 'es-es', 'ru-RU': 'ru-ru',
};

function toKL(region) {
  return KL_MAP[region] || 'wt-wt';
}

// 时间范围 -> DDG df 值
const DF_MAP = { day: 'd', week: 'w', month: 'm', year: 'y' };

function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function parseHTML(html) {
  // Remove scripts and comments
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  const results = [];

  // DDG Lite HTML 模式: 每个搜索结果跨 3 个 <tr>
  //   行1: <td ...><a href="URL" class='result-link'>TITLE</a>...
  //   行2: <td class='result-extras'> (URL 显示行)
  //   行3: <td class='result-snippet'>SNIPPET</td>
  // 注意: href 和 class 属性顺序可能不同，先捕获整个属性字符串再提取 href
  const resultBlockRe = /<a\b([^>]*\bclass=['"]result-link['"][^>]*)>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*\bclass=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;

  for (const m of clean.matchAll(resultBlockRe)) {
    const attrs = m[1];
    const rawTitle = m[2].replace(/<[^>]+>/g, '').trim();
    const title = decodeHTMLEntities(rawTitle);
    const body = decodeHTMLEntities(m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

    // 从属性字符串中提取 href（兼容单双引号）
    let href = '';
    const hrefMatch = /\bhref="([^"]*)"|href='([^']*)'/i.exec(attrs);
    if (hrefMatch) href = hrefMatch[1] ?? hrefMatch[2] ?? '';

    // De-proxy DDG redirect URLs -> extract uddg= param
    const uddgMatch = /[?&]uddg=([^&]+)/.exec(href);
    if (uddgMatch) {
      try { href = decodeURIComponent(uddgMatch[1]); } catch (_) {}
    }

    // Skip DDG internal links / ads / empty titles
    if (!href || !href.startsWith('http') || href.includes('duckduckgo.com')) continue;
    if (!title || title === 'more info') continue;

    results.push({ title, url: href, source: name, body });
  }

  return results;
}

/**
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.count=5]
 * @param {string}  [opts.region='zh-CN']
 * @param {string}  [opts.time]   day|week|month|year
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<Array<{title,url,source,body}>>}
 */
export async function search({ query, count = 5, region = 'zh-CN', time, timeout = 30000 }) {
  const kl = toKL(region);
  const df = (time && DF_MAP[time]) || '';

  const body = new URLSearchParams({ q: query, kl, ...(df ? { df } : {}) });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Cookie': 'kl=' + kl + (df ? '; df=' + df : ''),
        'Origin': 'https://lite.duckduckgo.com',
        'Referer': 'https://lite.duckduckgo.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
      },
      body: body.toString(),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) throw new Error('DuckDuckGo Lite HTTP ' + resp.status);

    const html = await resp.text();
    const results = parseHTML(html).slice(0, count);
    if (!results.length) throw new Error('DuckDuckGo Lite returned no results');
    return results;
  } catch (e) { clearTimeout(t); throw e; }
}

/**
 * SearXNG 搜索引擎适配器
 * 文档: https://docs.searxng.org/dev/search_api.html
 * ENV: SEARXNG_URL (必须), 如 http://127.0.0.1:8081
 *
 * 参数说明:
 *   query      - 搜索词 (q)
 *   count      - 结果数量 (默认 5)
 *   region     - 语言代码 (language), 如 zh-CN、en-US (默认 zh-CN)
 *   time       - 时间范围 (time_range): day | month | year  ⚠️ SearXNG 不支持 week
 *   topic      - 搜索类别 (categories): general(默认) | news | images | videos | science | it
 *   engines    - 指定引擎列表, 逗号分隔, 如 "google,bing" (可选)
 *   pageno     - 页码 (默认 1)
 *   safesearch - 安全搜索: 0=关闭 1=适中 2=严格 (默认 0)
 */
export const name = 'searxng';

export function isAvailable() {
  return !!(process.env.SEARXNG_URL || '').trim();
}

// SearXNG time_range 只支持 day / month / year，无 week
const TIME_MAP = { day: 'day', month: 'month', year: 'year' };

// topic -> SearXNG categories
const CATEGORY_MAP = {
  general: 'general', news: 'news', images: 'images',
  videos: 'videos', science: 'science', it: 'it',
};

/**
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.count=5]
 * @param {string}  [opts.region='zh-CN']   language 参数
 * @param {string}  [opts.time]             day|month|year (无 week)
 * @param {string}  [opts.topic='general']  categories 参数
 * @param {string}  [opts.engines]          逗号分隔的引擎列表, 如 "google,bing"
 * @param {number}  [opts.pageno=1]         翻页页码
 * @param {number}  [opts.safesearch=0]     0=off 1=moderate 2=strict
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<Array<{title,url,source,body}>>}
 */
export async function search({
  query,
  count = 5,
  region = 'zh-CN',
  time,
  topic = 'general',
  engines,
  pageno = 1,
  safesearch = 0,
  timeout = 30000,
}) {
  const baseUrl = (process.env.SEARXNG_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('SEARXNG_URL not configured');

  const url = new URL(baseUrl + '/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', region);
  url.searchParams.set('categories', CATEGORY_MAP[topic] || 'general');
  url.searchParams.set('pageno', String(pageno));
  url.searchParams.set('safesearch', String(safesearch));
  if (time && TIME_MAP[time]) url.searchParams.set('time_range', TIME_MAP[time]);
  if (engines) url.searchParams.set('engines', engines);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url.toString(), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(t);
    if (!resp.ok) throw new Error('SearXNG HTTP ' + resp.status);
    const data = await resp.json();
    const items = (data.results || []).slice(0, count);
    if (!items.length) throw new Error('SearXNG returned no results');
    return items.map(r => ({ title: r.title || '', url: r.url || '', source: name, body: r.content || '' }));
  } catch (e) { clearTimeout(t); throw e; }
}

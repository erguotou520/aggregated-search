/**
 * Bing Web Search API v7 适配器
 * 文档: https://learn.microsoft.com/en-us/bing/search-apis/bing-web-search/reference/query-parameters
 * ENV: BING_API_KEY (必须), BING_ENDPOINT (可选, 默认 https://api.bing.microsoft.com)
 *
 * 额外参数:
 *   region  - mkt 参数, 如 zh-CN (默认)
 *   time    - freshness: day=Day | week=Week | month=Month
 *   topic   - general | news (切换端点)
 */
export const name = 'bing';

export function isAvailable() {
  return !!(process.env.BING_API_KEY || '').trim();
}

const FRESHNESS_MAP = { day: 'Day', week: 'Week', month: 'Month' };

/**
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.count=5]
 * @param {string}  [opts.region='zh-CN']
 * @param {string}  [opts.time]   day|week|month
 * @param {string}  [opts.topic='general']  general|news
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<Array<{title,url,source,body}>>}
 */
export async function search({ query, count = 5, region = 'zh-CN', time, topic = 'general', timeout = 30000 }) {
  const apiKey = (process.env.BING_API_KEY || '').trim();
  if (!apiKey) throw new Error('BING_API_KEY not configured');

  const endpoint = (process.env.BING_ENDPOINT || 'https://api.bing.microsoft.com').trim();
  const path = topic === 'news' ? '/v7.0/news/search' : '/v7.0/search';

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 50)),
    mkt: region,
    safeSearch: 'Moderate',
    textFormat: 'Raw',
  });
  if (topic === 'news') params.set('sortBy', 'Date');
  const freshness = time && FRESHNESS_MAP[time];
  if (freshness) params.set('freshness', freshness);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(endpoint + path + '?' + params.toString(), {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('Bing HTTP ' + resp.status + ': ' + text.slice(0, 200));
    }
    const data = await resp.json();
    const raw = (topic === 'news' ? (data.value || []) : (data.webPages?.value || [])).slice(0, count);
    if (!raw.length) throw new Error('Bing returned no results');
    return raw.map(r => ({
      title: r.name || '',
      url: r.url || '',
      source: name,
      body: r.snippet || r.description || '',
    }));
  } catch (e) { clearTimeout(t); throw e; }
}

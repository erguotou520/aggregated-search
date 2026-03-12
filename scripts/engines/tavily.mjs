/**
 * Tavily API 搜索引擎适配器
 * 文档: https://docs.tavily.com/docs/rest-api/api-reference
 * ENV: TAVILY_API_KEY (必须)
 *
 * 额外参数:
 *   time    - news 模式下的 days: day(1)|week(7)|month(30)|year(365)
 *   topic   - general | news (默认 general)
 *   deep    - false=basic, true=advanced (深度搜索)
 */
export const name = 'tavily';

export function isAvailable() {
  return !!(process.env.TAVILY_API_KEY || '').trim();
}

const DAYS_MAP = { day: 1, week: 7, month: 30, year: 365 };

/**
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.count=5]
 * @param {string}  [opts.time]   day|week|month|year
 * @param {string}  [opts.topic='general']  general|news
 * @param {boolean} [opts.deep=false]
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<Array<{title,url,source,body}>>}
 */
export async function search({ query, count = 5, time, topic = 'general', deep = false, timeout = 30000 }) {
  const apiKey = (process.env.TAVILY_API_KEY || '').trim();
  if (!apiKey) throw new Error('TAVILY_API_KEY not configured');

  const body = {
    api_key: apiKey,
    query,
    search_depth: deep ? 'advanced' : 'basic',
    topic: topic === 'news' ? 'news' : 'general',
    max_results: Math.min(count, 20),
    include_answer: false,
    include_raw_content: false,
  };
  if (topic === 'news' && time && DAYS_MAP[time]) body.days = DAYS_MAP[time];

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('Tavily HTTP ' + resp.status + ': ' + text.slice(0, 200));
    }
    const data = await resp.json();
    const items = (data.results || []).slice(0, count);
    if (!items.length) throw new Error('Tavily returned no results');
    return items.map(r => ({
      title: r.title || '',
      url: r.url || '',
      source: name,
      body: r.content || '',
    }));
  } catch (e) { clearTimeout(t); throw e; }
}

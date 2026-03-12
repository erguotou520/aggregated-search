/**
 * Serper.dev Google 搜索 API 适配器
 * 文档: https://serper.dev/api-reference
 * ENV: SERPER_API_KEY (必须)
 *
 * 参数:
 *   query  - 搜索词 (q)
 *   region - 国家/语言: zh-CN(默认, gl=cn hl=zh-cn) | en-US(gl=us hl=en)
 *   time   - 时间范围: hour(qdr:h)|day(qdr:d)|week(qdr:w)|month(qdr:m)|year(qdr:y)
 *   topic  - 端点: general(默认)|news|images|videos|shopping|scholar
 *   page   - 翻页页码 (默认 1)
 */
export const name = 'serper';

export function isAvailable() {
  return !!(process.env.SERPER_API_KEY || '').trim();
}

// region -> { gl, hl }; 默认中国
function toGlHl(region) {
  if (region === 'en-US') return { gl: 'us', hl: 'en' };
  return { gl: 'cn', hl: 'zh-cn' }; // zh-CN 及其他均使用中国
}

// 时间范围 -> Serper tbs
const TBS_MAP = { hour: 'qdr:h', day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };

// topic -> Serper 端点
const ENDPOINT_MAP = {
  general: '/search', news: '/news', images: '/images',
  videos: '/videos', shopping: '/shopping', scholar: '/scholar',
};

/**
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.count=5]
 * @param {string}  [opts.region='zh-CN']
 * @param {string}  [opts.time]   day|week|month|year
 * @param {string}  [opts.topic='general']
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<Array<{title,url,source,body}>>}
 */
export async function search({ query, count = 5, region = 'zh-CN', time, topic = 'general', page = 1, timeout = 30000 }) {
  const apiKey = (process.env.SERPER_API_KEY || '').trim();
  if (!apiKey) throw new Error('SERPER_API_KEY not configured');

  const { gl, hl } = toGlHl(region);
  const endpoint = ENDPOINT_MAP[topic] || '/search';
  const body = { q: query, gl, hl, num: Math.min(count, 100) };
  if (time && TBS_MAP[time]) body.tbs = TBS_MAP[time];
  if (page > 1) body.page = page;
  if (topic === 'news') body.num = Math.min(count, 10);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch('https://google.serper.dev' + endpoint, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('Serper HTTP ' + resp.status + ': ' + text.slice(0, 200));
    }
    const data = await resp.json();
    const raw = (data.organic || data.news || data.images || data.videos || []).slice(0, count);
    if (!raw.length) throw new Error('Serper returned no results');
    return raw.map(r => ({
      title: r.title || '',
      url: r.link || r.imageUrl || '',
      source: name,
      body: r.snippet || r.description || '',
    }));
  } catch (e) { clearTimeout(t); throw e; }
}

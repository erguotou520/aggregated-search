/**
 * Ollama Web Search API 适配器
 * 文档: https://docs.ollama.com/capabilities/web-search
 * API:  POST https://ollama.com/api/web_search
 * ENV:  OLLAMA_API_KEY (必须) - 从 https://ollama.com/settings/keys 获取
 *
 * 参数:
 *   count - max_results (最多 10)
 * 注: Ollama web search 暂不支持地区/时间过滤
 */
export const name = 'ollama';

export function isAvailable() {
  return !!(process.env.OLLAMA_API_KEY || '').trim();
}

/**
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.count=5]
 * @param {number}  [opts.timeout=30000]
 * @returns {Promise<Array<{title,url,source,body}>>}
 */
export async function search({ query, count = 5, timeout = 30000 }) {
  const apiKey = (process.env.OLLAMA_API_KEY || '').trim();
  if (!apiKey) throw new Error('OLLAMA_API_KEY not configured');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch('https://ollama.com/api/web_search', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, max_results: Math.min(count, 10) }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error('Ollama HTTP ' + resp.status + ': ' + text.slice(0, 200));
    }
    const data = await resp.json();
    const items = (data.results || []).slice(0, count);
    if (!items.length) throw new Error('Ollama returned no results');
    return items.map(r => ({
      title: r.title || '',
      url: r.url || '',
      source: name,
      body: r.content || '',
    }));
  } catch (e) { clearTimeout(t); throw e; }
}

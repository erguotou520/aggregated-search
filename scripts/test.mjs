#!/usr/bin/env node
/**
 * aggregated-search 引擎适配器 TDD 测试套件
 * 运行: node --test scripts/test.mjs
 *
 * 覆盖范围:
 *  - 每个引擎的 isAvailable() 逻辑
 *  - 未配置 API Key 时抛出正确错误
 *  - 请求参数构建（通过 mock fetch 捕获）
 *  - 输出格式 {title, url, source, body}
 *  - 错误处理（HTTP 失败、无结果）
 *  - DuckDuckGo HTML 解析（fixture + 实网络集成）
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 引擎模块导入 ────────────────────────────────────────────────────────
const [searxng, ddg, serper, tavily, bing, ollama] = await Promise.all([
  import(join(__dirname, 'engines/searxng.mjs')),
  import(join(__dirname, 'engines/duckduckgo-lite.mjs')),
  import(join(__dirname, 'engines/serper.mjs')),
  import(join(__dirname, 'engines/tavily.mjs')),
  import(join(__dirname, 'engines/bing.mjs')),
  import(join(__dirname, 'engines/ollama.mjs')),
]);

// ── Mock fetch 工具 ─────────────────────────────────────────────────────
const _origFetch = globalThis.fetch;
let _lastFetch = null; // { url, opts }

/**
 * 替换全局 fetch，拦截请求并返回预设响应
 * @param {object|string} body  响应体
 * @param {number} status       HTTP 状态码 (默认 200)
 */
function useMockFetch(body, status = 200) {
  globalThis.fetch = async (url, opts) => {
    _lastFetch = { url: url.toString(), opts: opts || {} };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  };
}

function restoreFetch() {
  globalThis.fetch = _origFetch;
  _lastFetch = null;
}

// ── DDG Lite HTML fixture (模拟真实页面结构) ────────────────────────────
// 结构: <a href class='result-link'> → <td class='result-extras'> → <td class='result-snippet'>
const DDG_HTML = `<html><body><table>
<tr><td><a rel="nofollow" href="https://example.com/page1" class='result-link'>Example Page &amp; Title</a></td></tr>
<tr><td class='result-extras'>example.com</td></tr>
<tr><td class='result-snippet'>First snippet with &lt;html&gt; entities.</td></tr>
<tr><td><a rel="nofollow" href="https://test.org/second" class='result-link'>Test Org Second Page</a></td></tr>
<tr><td class='result-extras'>test.org</td></tr>
<tr><td class='result-snippet'>Second result body content here.</td></tr>
<tr><td><a rel="nofollow" href="https://third.io/page" class='result-link'>Third Result Page</a></td></tr>
<tr><td class='result-extras'>third.io</td></tr>
<tr><td class='result-snippet'>Third snippet text.</td></tr>
<tr><td><a rel="nofollow" href="https://duckduckgo.com/internal?q=x" class='result-link'>DDG Internal Link</a></td></tr>
<tr><td class='result-extras'>duckduckgo.com</td></tr>
<tr><td class='result-snippet'>Should be filtered out (DDG internal).</td></tr>
</table></body></html>`;

// ══════════════════════════════════════════════════════════════════════════
// SearXNG
// ══════════════════════════════════════════════════════════════════════════
describe('SearXNG', () => {
  beforeEach(() => { delete process.env.SEARXNG_URL; });
  afterEach(restoreFetch);

  test('name === "searxng"', () => assert.equal(searxng.name, 'searxng'));

  test('isAvailable() → false when SEARXNG_URL not set', () => {
    assert.equal(searxng.isAvailable(), false);
  });

  test('isAvailable() → true when SEARXNG_URL is set', () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    assert.equal(searxng.isAvailable(), true);
  });

  test('search() throws "not configured" without SEARXNG_URL', async () => {
    await assert.rejects(
      () => searxng.search({ query: 'test' }),
      /not configured/i,
    );
  });

  test('search() builds correct query params', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await searxng.search({ query: 'hello world', region: 'zh-CN', topic: 'news', pageno: 2, safesearch: 1 });
    const u = new URL(_lastFetch.url);
    assert.equal(u.searchParams.get('q'), 'hello world');
    assert.equal(u.searchParams.get('format'), 'json');
    assert.equal(u.searchParams.get('language'), 'zh-CN');
    assert.equal(u.searchParams.get('categories'), 'news');
    assert.equal(u.searchParams.get('pageno'), '2');
    assert.equal(u.searchParams.get('safesearch'), '1');
  });

  test('search() sets time_range for supported values (day/month/year)', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    for (const [time, expected] of [['day', 'day'], ['month', 'month'], ['year', 'year']]) {
      useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
      await searxng.search({ query: 'q', time });
      const u = new URL(_lastFetch.url);
      assert.equal(u.searchParams.get('time_range'), expected, `time=${time}`);
    }
  });

  test('search() does NOT set time_range for "week" (unsupported by SearXNG)', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await searxng.search({ query: 'q', time: 'week' });
    const u = new URL(_lastFetch.url);
    assert.equal(u.searchParams.get('time_range'), null, 'week should be ignored');
  });

  test('search() passes engines param when specified', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await searxng.search({ query: 'q', engines: 'google,bing' });
    const u = new URL(_lastFetch.url);
    assert.equal(u.searchParams.get('engines'), 'google,bing');
  });

  test('search() omits engines param when not specified', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await searxng.search({ query: 'q' });
    const u = new URL(_lastFetch.url);
    assert.equal(u.searchParams.get('engines'), null);
  });

  test('search() returns correct {title, url, source, body} format', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ results: [{ title: 'Hello', url: 'https://x.com', content: 'World' }] });
    const r = await searxng.search({ query: 'q' });
    assert.deepEqual(r, [{ title: 'Hello', url: 'https://x.com', source: 'searxng', body: 'World' }]);
  });

  test('search() respects count limit', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `T${i}`, url: `https://x${i}.com`, content: `C${i}` }));
    useMockFetch({ results: many });
    const r = await searxng.search({ query: 'q', count: 3 });
    assert.equal(r.length, 3);
  });

  test('search() throws when response returns empty results', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ results: [] });
    await assert.rejects(() => searxng.search({ query: 'q' }), /no results/i);
  });

  test('search() throws on HTTP error', async () => {
    process.env.SEARXNG_URL = 'http://localhost:8080';
    useMockFetch({ error: 'not found' }, 404);
    await assert.rejects(() => searxng.search({ query: 'q' }), /SearXNG HTTP 404/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// DuckDuckGo Lite
// ══════════════════════════════════════════════════════════════════════════
describe('DuckDuckGo Lite', () => {
  afterEach(restoreFetch);

  test('name === "duckduckgo"', () => assert.equal(ddg.name, 'duckduckgo'));

  test('isAvailable() always returns true (no API key needed)', () => {
    assert.equal(ddg.isAvailable(), true);
  });

  test('search() POSTs to lite.duckduckgo.com/lite/', async () => {
    useMockFetch(DDG_HTML, 200);
    await ddg.search({ query: 'test' });
    assert.ok(_lastFetch.url.includes('lite.duckduckgo.com'), 'must POST to DDG Lite');
    assert.equal(_lastFetch.opts.method, 'POST');
  });

  test('search() sends correct q and kl params', async () => {
    useMockFetch(DDG_HTML, 200);
    await ddg.search({ query: 'hello world', region: 'en-US' });
    const body = new URLSearchParams(_lastFetch.opts.body);
    assert.equal(body.get('q'), 'hello world');
    assert.equal(body.get('kl'), 'us-en');
  });

  test('search() region zh-CN → kl=cn-zh', async () => {
    useMockFetch(DDG_HTML, 200);
    await ddg.search({ query: 'q', region: 'zh-CN' });
    const body = new URLSearchParams(_lastFetch.opts.body);
    assert.equal(body.get('kl'), 'cn-zh');
  });

  test('search() unknown region falls back to cn-zh', async () => {
    useMockFetch(DDG_HTML, 200);
    await ddg.search({ query: 'q', region: 'fr-FR' });
    const body = new URLSearchParams(_lastFetch.opts.body);
    assert.equal(body.get('kl'), 'cn-zh');
  });

  test('search() time mapping: day→d, week→w, month→m, year→y', async () => {
    for (const [time, df] of [['day', 'd'], ['week', 'w'], ['month', 'm'], ['year', 'y']]) {
      useMockFetch(DDG_HTML, 200);
      await ddg.search({ query: 'q', time });
      const body = new URLSearchParams(_lastFetch.opts.body);
      assert.equal(body.get('df'), df, `time=${time} should map to df=${df}`);
    }
  });

  test('search() omits df param when no time specified', async () => {
    useMockFetch(DDG_HTML, 200);
    await ddg.search({ query: 'q' });
    const body = new URLSearchParams(_lastFetch.opts.body);
    assert.equal(body.get('df'), null, 'df should be absent when time is not set');
  });

  test('search() parses HTML fixture and returns correct format', async () => {
    useMockFetch(DDG_HTML, 200);
    const results = await ddg.search({ query: 'test', count: 5 });
    assert.ok(results.length >= 1, 'should have at least 1 result');
    for (const r of results) {
      assert.ok(r.title, 'title must be non-empty');
      assert.ok(r.url.startsWith('https://'), `url must start with https, got: ${r.url}`);
      assert.equal(r.source, 'duckduckgo');
      assert.equal(typeof r.body, 'string');
    }
  });

  test('search() correctly parses title and body from fixture', async () => {
    useMockFetch(DDG_HTML, 200);
    const results = await ddg.search({ query: 'test', count: 5 });
    const first = results[0];
    assert.equal(first.url, 'https://example.com/page1');
    assert.equal(first.title, 'Example Page & Title');      // &amp; decoded
    assert.ok(first.body.includes('<html>'), 'body should have decoded < from &lt;');
  });

  test('search() filters out duckduckgo.com internal links', async () => {
    useMockFetch(DDG_HTML, 200);
    const results = await ddg.search({ query: 'test', count: 10 });
    for (const r of results) {
      assert.ok(
        !r.url.includes('duckduckgo.com'),
        `duckduckgo.com link should be filtered: ${r.url}`,
      );
    }
  });

  test('search() respects count limit', async () => {
    useMockFetch(DDG_HTML, 200);
    const results = await ddg.search({ query: 'test', count: 2 });
    assert.equal(results.length, 2);
  });

  test('search() throws on HTTP error', async () => {
    useMockFetch('Server Error', 500);
    await assert.rejects(() => ddg.search({ query: 'q' }), /HTTP 500/);
  });

  test('search() throws when HTML yields no parseable results', async () => {
    useMockFetch('<html><body>no results here</body></html>', 200);
    await assert.rejects(() => ddg.search({ query: 'q' }), /no results/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Serper
// ══════════════════════════════════════════════════════════════════════════
describe('Serper', () => {
  beforeEach(() => { delete process.env.SERPER_API_KEY; });
  afterEach(restoreFetch);

  test('name === "serper"', () => assert.equal(serper.name, 'serper'));

  test('isAvailable() → false without SERPER_API_KEY', () => {
    assert.equal(serper.isAvailable(), false);
  });

  test('isAvailable() → true when key set', () => {
    process.env.SERPER_API_KEY = 'key123';
    assert.equal(serper.isAvailable(), true);
  });

  test('search() throws "not configured" without API key', async () => {
    await assert.rejects(() => serper.search({ query: 'test' }), /not configured/i);
  });

  test('search() region zh-CN → gl=cn, hl=zh-cn', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q', region: 'zh-CN' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.gl, 'cn');
    assert.equal(body.hl, 'zh-cn');
  });

  test('search() region en-US → gl=us, hl=en', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q', region: 'en-US' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.gl, 'us');
    assert.equal(body.hl, 'en');
  });

  test('search() TBS time mapping', async () => {
    process.env.SERPER_API_KEY = 'k';
    const map = { hour: 'qdr:h', day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };
    for (const [time, tbs] of Object.entries(map)) {
      useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
      await serper.search({ query: 'q', time });
      const body = JSON.parse(_lastFetch.opts.body);
      assert.equal(body.tbs, tbs, `time=${time} should map to tbs=${tbs}`);
    }
  });

  test('search() POSTs to /news endpoint for news topic', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ news: [{ title: 'N', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q', topic: 'news' });
    assert.ok(_lastFetch.url.endsWith('/news'), `expected /news endpoint, got ${_lastFetch.url}`);
  });

  test('search() POSTs to /search endpoint for general topic', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q', topic: 'general' });
    assert.ok(_lastFetch.url.endsWith('/search'), `expected /search endpoint, got ${_lastFetch.url}`);
  });

  test('search() includes page param when page > 1', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q', page: 3 });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.page, 3);
  });

  test('search() omits page param when page === 1 (default)', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.page, undefined, 'page should be absent for page=1');
  });

  test('search() sends X-API-KEY header', async () => {
    process.env.SERPER_API_KEY = 'my-serper-key';
    useMockFetch({ organic: [{ title: 'T', link: 'https://x.com', snippet: 'S' }] });
    await serper.search({ query: 'q' });
    assert.equal(_lastFetch.opts.headers['X-API-KEY'], 'my-serper-key');
  });

  test('search() returns correct {title, url, source, body} format', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [{ title: 'Hello', link: 'https://x.com', snippet: 'World' }] });
    const r = await serper.search({ query: 'q' });
    assert.deepEqual(r, [{ title: 'Hello', url: 'https://x.com', source: 'serper', body: 'World' }]);
  });

  test('search() throws when no results', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ organic: [] });
    await assert.rejects(() => serper.search({ query: 'q' }), /no results/i);
  });

  test('search() throws on HTTP error', async () => {
    process.env.SERPER_API_KEY = 'k';
    useMockFetch({ message: 'Unauthorized' }, 401);
    await assert.rejects(() => serper.search({ query: 'q' }), /Serper HTTP 401/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Tavily
// ══════════════════════════════════════════════════════════════════════════
describe('Tavily', () => {
  beforeEach(() => { delete process.env.TAVILY_API_KEY; });
  afterEach(restoreFetch);

  test('name === "tavily"', () => assert.equal(tavily.name, 'tavily'));

  test('isAvailable() → false without TAVILY_API_KEY', () => {
    assert.equal(tavily.isAvailable(), false);
  });

  test('isAvailable() → true when key set', () => {
    process.env.TAVILY_API_KEY = 'tvk-123';
    assert.equal(tavily.isAvailable(), true);
  });

  test('search() throws "not configured" without API key', async () => {
    await assert.rejects(() => tavily.search({ query: 'test' }), /not configured/i);
  });

  test('search() sends query and api_key in body', async () => {
    process.env.TAVILY_API_KEY = 'tvk-abc';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await tavily.search({ query: 'hello' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.query, 'hello');
    assert.equal(body.api_key, 'tvk-abc');
  });

  test('search() uses "basic" depth by default', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await tavily.search({ query: 'q' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.search_depth, 'basic');
  });

  test('search() uses "advanced" depth when deep=true', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await tavily.search({ query: 'q', deep: true });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.search_depth, 'advanced');
  });

  test('search() adds days for news topic + time', async () => {
    process.env.TAVILY_API_KEY = 'k';
    const daysMap = { day: 1, week: 7, month: 30, year: 365 };
    for (const [time, days] of Object.entries(daysMap)) {
      useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
      await tavily.search({ query: 'q', topic: 'news', time });
      const body = JSON.parse(_lastFetch.opts.body);
      assert.equal(body.days, days, `time=${time} should set days=${days}`);
    }
  });

  test('search() does NOT add days for general topic', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await tavily.search({ query: 'q', topic: 'general', time: 'week' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.days, undefined, 'days should be absent for general topic');
  });

  test('search() sets topic=news in body when topic=news', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await tavily.search({ query: 'q', topic: 'news' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.topic, 'news');
  });

  test('search() caps max_results at 20', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await tavily.search({ query: 'q', count: 100 });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.max_results, 20);
  });

  test('search() returns correct {title, url, source, body} format', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'Hello', url: 'https://x.com', content: 'World' }] });
    const r = await tavily.search({ query: 'q' });
    assert.deepEqual(r, [{ title: 'Hello', url: 'https://x.com', source: 'tavily', body: 'World' }]);
  });

  test('search() throws when no results', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ results: [] });
    await assert.rejects(() => tavily.search({ query: 'q' }), /no results/i);
  });

  test('search() throws on HTTP error', async () => {
    process.env.TAVILY_API_KEY = 'k';
    useMockFetch({ error: 'Invalid API Key' }, 401);
    await assert.rejects(() => tavily.search({ query: 'q' }), /Tavily HTTP 401/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Bing
// ══════════════════════════════════════════════════════════════════════════
describe('Bing', () => {
  beforeEach(() => { delete process.env.BING_API_KEY; });
  afterEach(restoreFetch);

  test('name === "bing"', () => assert.equal(bing.name, 'bing'));

  test('isAvailable() → false without BING_API_KEY', () => {
    assert.equal(bing.isAvailable(), false);
  });

  test('isAvailable() → true when key set', () => {
    process.env.BING_API_KEY = 'bk-123';
    assert.equal(bing.isAvailable(), true);
  });

  test('search() throws "not configured" without API key', async () => {
    await assert.rejects(() => bing.search({ query: 'test' }), /not configured/i);
  });

  test('search() uses /v7.0/search for general topic', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ webPages: { value: [{ name: 'T', url: 'https://x.com', snippet: 'S' }] } });
    await bing.search({ query: 'q', topic: 'general' });
    assert.ok(_lastFetch.url.includes('/v7.0/search'), `expected web search path, got: ${_lastFetch.url}`);
  });

  test('search() uses /v7.0/news/search for news topic', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ value: [{ name: 'N', url: 'https://x.com', description: 'D' }] });
    await bing.search({ query: 'q', topic: 'news' });
    assert.ok(_lastFetch.url.includes('/v7.0/news/search'), `expected news path, got: ${_lastFetch.url}`);
  });

  test('search() freshness mapping: day→Day, week→Week, month→Month', async () => {
    process.env.BING_API_KEY = 'k';
    const map = { day: 'Day', week: 'Week', month: 'Month' };
    for (const [time, freshness] of Object.entries(map)) {
      useMockFetch({ webPages: { value: [{ name: 'T', url: 'https://x.com', snippet: 'S' }] } });
      await bing.search({ query: 'q', time });
      const u = new URL(_lastFetch.url);
      assert.equal(u.searchParams.get('freshness'), freshness, `time=${time}`);
    }
  });

  test('search() does NOT set freshness for "year" (unsupported by Bing)', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ webPages: { value: [{ name: 'T', url: 'https://x.com', snippet: 'S' }] } });
    await bing.search({ query: 'q', time: 'year' });
    const u = new URL(_lastFetch.url);
    assert.equal(u.searchParams.get('freshness'), null, 'year should not set freshness');
  });

  test('search() sends mkt (region) param', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ webPages: { value: [{ name: 'T', url: 'https://x.com', snippet: 'S' }] } });
    await bing.search({ query: 'q', region: 'en-US' });
    const u = new URL(_lastFetch.url);
    assert.equal(u.searchParams.get('mkt'), 'en-US');
  });

  test('search() sends Ocp-Apim-Subscription-Key header', async () => {
    process.env.BING_API_KEY = 'my-bing-key';
    useMockFetch({ webPages: { value: [{ name: 'T', url: 'https://x.com', snippet: 'S' }] } });
    await bing.search({ query: 'q' });
    assert.equal(_lastFetch.opts.headers['Ocp-Apim-Subscription-Key'], 'my-bing-key');
  });

  test('search() returns correct format from webPages.value', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ webPages: { value: [{ name: 'Hello', url: 'https://x.com', snippet: 'World' }] } });
    const r = await bing.search({ query: 'q' });
    assert.deepEqual(r, [{ title: 'Hello', url: 'https://x.com', source: 'bing', body: 'World' }]);
  });

  test('search() returns correct format from news value', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ value: [{ name: 'News', url: 'https://x.com', description: 'Desc' }] });
    const r = await bing.search({ query: 'q', topic: 'news' });
    assert.deepEqual(r, [{ title: 'News', url: 'https://x.com', source: 'bing', body: 'Desc' }]);
  });

  test('search() throws when no results', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ webPages: { value: [] } });
    await assert.rejects(() => bing.search({ query: 'q' }), /no results/i);
  });

  test('search() throws on HTTP error', async () => {
    process.env.BING_API_KEY = 'k';
    useMockFetch({ message: 'Unauthorized' }, 401);
    await assert.rejects(() => bing.search({ query: 'q' }), /Bing HTTP 401/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Ollama
// ══════════════════════════════════════════════════════════════════════════
describe('Ollama', () => {
  beforeEach(() => { delete process.env.OLLAMA_API_KEY; });
  afterEach(restoreFetch);

  test('name === "ollama"', () => assert.equal(ollama.name, 'ollama'));

  test('isAvailable() → false without OLLAMA_API_KEY', () => {
    assert.equal(ollama.isAvailable(), false);
  });

  test('isAvailable() → true when key set', () => {
    process.env.OLLAMA_API_KEY = 'ok-123';
    assert.equal(ollama.isAvailable(), true);
  });

  test('search() throws "not configured" without API key', async () => {
    await assert.rejects(() => ollama.search({ query: 'test' }), /not configured/i);
  });

  test('search() sends query in request body', async () => {
    process.env.OLLAMA_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await ollama.search({ query: 'hello ollama' });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.query, 'hello ollama');
  });

  test('search() sends Authorization: Bearer header', async () => {
    process.env.OLLAMA_API_KEY = 'my-key-xyz';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await ollama.search({ query: 'q' });
    assert.equal(_lastFetch.opts.headers['Authorization'], 'Bearer my-key-xyz');
  });

  test('search() caps max_results at 10 even when count > 10', async () => {
    process.env.OLLAMA_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await ollama.search({ query: 'q', count: 99 });
    const body = JSON.parse(_lastFetch.opts.body);
    assert.equal(body.max_results, 10, 'max_results must be capped at 10');
  });

  test('search() POSTs to ollama.com/api/web_search', async () => {
    process.env.OLLAMA_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'T', url: 'https://x.com', content: 'C' }] });
    await ollama.search({ query: 'q' });
    assert.ok(_lastFetch.url.includes('ollama.com/api/web_search'), `unexpected URL: ${_lastFetch.url}`);
    assert.equal(_lastFetch.opts.method, 'POST');
  });

  test('search() returns correct {title, url, source, body} format', async () => {
    process.env.OLLAMA_API_KEY = 'k';
    useMockFetch({ results: [{ title: 'Hello', url: 'https://x.com', content: 'World' }] });
    const r = await ollama.search({ query: 'q' });
    assert.deepEqual(r, [{ title: 'Hello', url: 'https://x.com', source: 'ollama', body: 'World' }]);
  });

  test('search() throws when no results returned', async () => {
    process.env.OLLAMA_API_KEY = 'k';
    useMockFetch({ results: [] });
    await assert.rejects(() => ollama.search({ query: 'q' }), /no results/i);
  });

  test('search() throws on HTTP error', async () => {
    process.env.OLLAMA_API_KEY = 'k';
    useMockFetch({ error: 'Bad Request' }, 400);
    await assert.rejects(() => ollama.search({ query: 'q' }), /Ollama HTTP 400/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Integration: DuckDuckGo (真实网络请求)
// ══════════════════════════════════════════════════════════════════════════
describe('Integration: DuckDuckGo (real network)', { timeout: 30000 }, () => {
  test('returns real results for "Node.js"', async (t) => {
    let results;
    try {
      results = await ddg.search({ query: 'Node.js', count: 3, region: 'en-US' });
    } catch (e) {
      // 网络不可用或 DDG 拦截自动化请求时跳过（非失败）
      if (e.message.includes('fetch failed') || e.cause?.code === 'ECONNRESET'
          || e.cause?.code === 'ENOTFOUND' || e.message.includes('network')
          || e.message.toLowerCase().includes('no results')) {
        t.skip('Network unavailable or blocked by DDG, skipping integration test');
        return;
      }
      throw e;
    }
    assert.ok(Array.isArray(results) && results.length >= 1, 'should return at least 1 result');
    for (const r of results) {
      assert.ok(r.title, 'each result must have title');
      assert.ok(r.url.startsWith('http'), `url must start with http, got: ${r.url}`);
      assert.equal(r.source, 'duckduckgo');
      assert.equal(typeof r.body, 'string');
    }
  });
});

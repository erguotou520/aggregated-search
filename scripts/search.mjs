#!/usr/bin/env node
/**
 * 聚合搜索入口
 *
 * 搜索引擎优先级 (自动降级):
 *   1. searxng    - 自托管, 可接国内引擎 (需 SEARXNG_URL)
 *   2. serper     - Google 封装, 质量最优 (需 SERPER_API_KEY)
 *   3. tavily     - AI 优化搜索 (需 TAVILY_API_KEY)
 *   4. bing       - 微软搜索, 中文友好 (需 BING_API_KEY)
 *   5. duckduckgo - 无需 API Key, 隐私保护, 兜底
 *   6. ollama     - Ollama 云搜索 (需 OLLAMA_API_KEY)
 *
 * 输出: JSON 数组到 stdout, 每项: { title, url, source, body }
 * 日志: stderr
 *
 * 用法:
 *   node search.mjs "查询词" [选项]
 *
 * 选项:
 *   -n <数量>            结果数量 (默认 5, 最多 20)
 *   --source <引擎>      强制指定引擎: searxng|serper|tavily|bing|duckduckgo|ollama
 *   --strategy <策略>    搜索策略: fallback(默认)|random|aggregate
 *                         fallback  - 按优先级顺序降级, 第一个成功即返回
 *                         random    - 随机打乱引擎顺序后降级
 *                         aggregate - 所有引擎并行搜索, 结果去重合并
 *   --region <地区>      地区/语言 (默认 zh-CN), 如 en-US、ja-JP
 *   --time <范围>        时间范围: day|week|month|year
 *   --topic <类型>       搜索类型: general(默认)|news
 *   --deep               深度搜索:
 *                         Tavily  - 使用 advanced 搜索模式 (内置)
 *                         其余引擎 - 通过 Jina Reader 抓取完整网页内容替换 body (需 JINA_API_KEY)
 *                         Ollama  - 不支持
 *   --timeout <秒>       超时秒数 (默认 30)
 *   --verbose            打印使用的引擎等调试信息到 stderr
 *   --list               列出所有引擎及配置状态
 */

import * as searxng    from './engines/searxng.mjs';
import * as serper     from './engines/serper.mjs';
import * as tavily     from './engines/tavily.mjs';
import * as bing       from './engines/bing.mjs';
import * as duckduckgo from './engines/duckduckgo-lite.mjs';
import * as ollama     from './engines/ollama.mjs';

const ENGINES = [
  { key: 'searxng',    mod: searxng    },
  { key: 'serper',     mod: serper     },
  { key: 'tavily',     mod: tavily     },
  { key: 'bing',       mod: bing       },
  { key: 'duckduckgo', mod: duckduckgo },
  { key: 'ollama',     mod: ollama     },
];

// ─────────────────────────────
// Jina Reader 深度抓取
// 引擎: https://r.jina.ai/<url>  (需要 JINA_API_KEY)
// 适用于 searxng / serper / bing / duckduckgo 的 --deep 模式
// Tavily 用自身 advanced 模式，Ollama 不支持深度
// ─────────────────────────────

const JINA_API_KEY = (process.env.JINA_API_KEY || '').trim();

// 只对有意义路径的 URL 做深度抓取（跳过主域名 URL）
function isDeepFetchable(url) {
  try {
    const { pathname } = new URL(url);
    return pathname.length > 1 && pathname !== '/';
  } catch { return false; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function jinaFetch(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const resp = await fetch('https://r.jina.ai/' + url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + JINA_API_KEY,
        'X-Retain-Images': 'none',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) throw new Error('Jina HTTP ' + resp.status);
    const json = await resp.json();
    return json?.data?.content || null;
  } catch (e) { clearTimeout(t); throw e; }
}

// 对结果列表进行 Jina 深度内容替换（并发 5，失败后等 5s 重试一次）
// 跳过 source=tavily/ollama 的条目（tavily 自带 deep，ollama 不支持）
async function jinaEnrich(results, logFn) {
  if (!JINA_API_KEY) {
    logFn?.('deep: JINA_API_KEY not set, skipping enrichment');
    return results;
  }
  const enriched = results.map(r => ({ ...r }));
  const SKIP_SOURCES = new Set(['tavily', 'ollama']);
  const candidates = enriched
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !SKIP_SOURCES.has(r.source) && isDeepFetchable(r.url));
  logFn?.('deep: enriching ' + candidates.length + '/' + enriched.length + ' URL(s) via Jina...');
  // 内部辅助：将长文本按句切分并截取至 maxChars
  function summarizeText(text, maxChars) {
    if (!text) return '';
    text = text.trim();
    if (text.length <= maxChars) return text;
    // 尝试按句子边界截取（中英文标点）
    const parts = text.split(/(?<=[。！？.!?])\s*/);
    let out = '';
    for (const p of parts) {
      if ((out + p).length > maxChars) break;
      out += p;
    }
    if (!out) out = text.slice(0, maxChars);
    if (out.length < text.length) out = out.replace(/\s+$/,'') + ' ...';
    return out;
  }

  for (let b = 0; b < candidates.length; b += 5) {
    await Promise.all(candidates.slice(b, b + 5).map(async ({ r, i }) => {
      try {
        const content = await jinaFetch(r.url);
        if (content) {
          // 根据 deepMode 决定 body 内容
          if (deepMode === 'full') {
            enriched[i].body = content;
            enriched[i].full_body = content;
          } else if (deepMode === 'trim') {
            enriched[i].body = content.slice(0, deepMaxChars) + (content.length > deepMaxChars ? ' ...' : '');
            enriched[i].full_body = content;
          } else { // summary
            enriched[i].body = summarizeText(content, deepMaxChars);
            enriched[i].full_body = content;
          }
        }
        logFn?.('  ✓ ' + r.url);
      } catch {
        logFn?.('  ✗ retry in 5s: ' + r.url);
        await sleep(5000);
        try {
          const content = await jinaFetch(r.url);
          if (content) {
            if (deepMode === 'full') {
              enriched[i].body = content;
              enriched[i].full_body = content;
            } else if (deepMode === 'trim') {
              enriched[i].body = content.slice(0, deepMaxChars) + (content.length > deepMaxChars ? ' ...' : '');
              enriched[i].full_body = content;
            } else {
              enriched[i].body = summarizeText(content, deepMaxChars);
              enriched[i].full_body = content;
            }
          }
          logFn?.('  ✓ (retry) ' + r.url);
        } catch (e2) {
          logFn?.('  ✗ failed: ' + r.url + ' – ' + e2.message);
        }
      }
    }));
  }
  return enriched;
}

// ─────────────────────────────
// 参数解析
// ─────────────────────────────

const args = process.argv.slice(2);

function printUsage() {
  process.stderr.write(
    'Usage: node search.mjs "query" [-n 5] [--source ENGINE]\n' +
    '       [--strategy fallback|random|aggregate]\n' +
    '       [--region zh-CN] [--time day|week|month|year]\n' +
    '       [--topic general|news] [--deep] [--timeout 30]\n' +
    '       [--verbose] [--list]\n'
  );
  process.exit(2);
}

if (!args.length || args[0] === '-h' || args[0] === '--help') printUsage();

// --list: 显示引擎状态
if (args[0] === '--list') {
  for (const e of ENGINES) {
    const ok = e.mod.isAvailable();
    process.stdout.write(e.key.padEnd(12) + (ok ? ' available' : ' not configured') + '\n');
  }
  process.exit(0);
}

const query = args[0];
if (!query || query.startsWith('--')) printUsage();

let count      = 5;
let source     = null;
let strategy   = 'fallback';
let region     = 'zh-CN';
let time       = null;
let topic      = 'general';
let deep       = false;
let deepMode   = 'summary';
let deepMaxChars = 800;
let timeoutSec = 30;
let verbose    = false;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if      (a === '-n')          count      = parseInt(args[++i] || '5', 10);
  else if (a === '--source')    source     = args[++i]?.toLowerCase();
  else if (a === '--strategy')  strategy   = args[++i]?.toLowerCase() || 'fallback';
  else if (a === '--region')    region     = args[++i] || 'zh-CN';
  else if (a === '--time')      time       = args[++i]?.toLowerCase() || null;
  else if (a === '--topic')     topic      = args[++i]?.toLowerCase() || 'general';
  else if (a === '--deep')      deep       = true;
  else if (a === '--deep-mode') deepMode   = args[++i]?.toLowerCase() || 'summary';
  else if (a === '--deep-max-chars') deepMaxChars = parseInt(args[++i] || '800', 10);
  else if (a === '--timeout')   timeoutSec = parseInt(args[++i] || '30', 10);
  else if (a === '--verbose')   verbose    = true;
  else { process.stderr.write('Unknown argument: ' + a + '\n'); printUsage(); }
}

if (!['fallback', 'random', 'aggregate'].includes(strategy)) {
  process.stderr.write('Unknown strategy: ' + strategy + '. Use: fallback|random|aggregate\n');
  process.exit(2);
}

if (!['summary', 'full', 'trim'].includes(deepMode)) {
  process.stderr.write('Unknown --deep-mode: ' + deepMode + '. Use: summary|full|trim\n');
  process.exit(2);
}

count = Math.max(1, Math.min(count, 20));
const timeoutMs = timeoutSec * 1000;

function log(msg) {
  if (verbose) process.stderr.write('[search] ' + msg + '\n');
}

// ─────────────────────────────
// 构建引擎链
// ─────────────────────────────

let chain;
if (source) {
  const found = ENGINES.find(e => e.key === source);
  if (!found) {
    process.stderr.write('Unknown source: ' + source + '. Available: ' + ENGINES.map(e => e.key).join(', ') + '\n');
    process.exit(2);
  }
  chain = [found];
} else {
  chain = ENGINES.filter(e => {
    const ok = e.mod.isAvailable();
    if (!ok) log('skip ' + e.key + ' (not configured)');
    return ok;
  });
  // duckduckgo 无需配置，始终保留作为兜底
  if (!chain.find(e => e.key === 'duckduckgo')) {
    chain.push(ENGINES.find(e => e.key === 'duckduckgo'));
  }
}

log('chain: ' + chain.map(e => e.key).join(' -> '));
log('options: count=' + count + ' region=' + region + ' time=' + time + ' topic=' + topic + ' deep=' + deep + ' strategy=' + strategy);

// ─────────────────────────────
// 工具：随机打乱数组
// ─────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─────────────────────────────
// 执行搜索
// ─────────────────────────────

const opts = { query, count, region, time, topic, deep, timeout: timeoutMs };

if (strategy === 'aggregate') {
  // 所有引擎并行搜索，结果去重合并
  log('aggregate: running ' + chain.length + ' engines in parallel...');
  const settled = await Promise.allSettled(
    chain.map(e => {
      log('  starting ' + e.key + '...');
      return e.mod.search(opts);
    })
  );
  const seen = new Set();
  const merged = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'rejected') {
      log(chain[i].key + ' failed: ' + r.reason?.message);
      continue;
    }
    for (const item of r.value) {
      if (!seen.has(item.url)) {
        seen.add(item.url);
        merged.push(item);
      }
    }
  }
  if (!merged.length) {
    process.stderr.write('All search engines returned no results.\n');
    if (!verbose) process.stderr.write('Run with --verbose to see details, or use --list to check engine configuration.\n');
    process.exit(1);
  }
  // aggregate 返回所有去重结果，不按 -n 截断
  const output = deep ? await jinaEnrich(merged, log) : merged;
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

// fallback 或 random 策略
if (strategy === 'random') {
  chain = shuffle(chain);
  log('random chain: ' + chain.map(e => e.key).join(' -> '));
}

let lastErr = null;
// tavily 在引擎内部处理 deep，其余可用引擎用 Jina enrichment
const JINA_SKIP = new Set(['tavily', 'ollama']);

for (const e of chain) {
  log('trying ' + e.key + '...');
  try {
    let results = await e.mod.search(opts);
    if (deep && !JINA_SKIP.has(e.key)) {
      results = await jinaEnrich(results, log);
    }
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    log(e.key + ' failed: ' + err.message);
    lastErr = err;
  }
}

process.stderr.write('All search engines failed.\n');
if (lastErr) process.stderr.write('Last error: ' + lastErr.message + '\n');
if (!verbose) process.stderr.write('Run with --verbose to see details, or use --list to check engine configuration.\n');
process.exit(1);

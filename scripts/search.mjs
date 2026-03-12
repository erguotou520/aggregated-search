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
 *   -n <数量>          结果数量 (默认 5, 最多 20)
 *   --source <引擎>    强制指定引擎: searxng|serper|tavily|bing|duckduckgo|ollama
 *   --region <地区>    地区/语言 (默认 zh-CN), 如 en-US、ja-JP
 *   --time <范围>      时间范围: day|week|month|year
 *   --topic <类型>     搜索类型: general(默认)|news
 *   --deep             深度搜索 (Tavily advanced 模式)
 *   --timeout <秒>     超时秒数 (默认 30)
 *   --verbose          打印使用的引擎等调试信息到 stderr
 *   --list             列出所有引擎及配置状态
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
// 参数解析
// ─────────────────────────────

const args = process.argv.slice(2);

function printUsage() {
  process.stderr.write(
    'Usage: node search.mjs "query" [-n 5] [--source ENGINE]\n' +
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

let count      = parseInt(process.env.SEARCH_RESULTS_LIMIT || '5', 10);
let source     = null;
let region     = process.env.SEARCH_REGION || 'zh-CN';
let time       = null;
let topic      = 'general';
let deep       = false;
let timeoutSec = parseInt(process.env.SEARCH_TIMEOUT_SECONDS || '30', 10);
let verbose    = false;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if      (a === '-n')        count      = parseInt(args[++i] || '5', 10);
  else if (a === '--source')  source     = args[++i]?.toLowerCase();
  else if (a === '--region')  region     = args[++i] || 'zh-CN';
  else if (a === '--time')    time       = args[++i]?.toLowerCase() || null;
  else if (a === '--topic')   topic      = args[++i]?.toLowerCase() || 'general';
  else if (a === '--deep')    deep       = true;
  else if (a === '--timeout') timeoutSec = parseInt(args[++i] || '30', 10);
  else if (a === '--verbose') verbose    = true;
  else { process.stderr.write('Unknown argument: ' + a + '\n'); printUsage(); }
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
log('options: count=' + count + ' region=' + region + ' time=' + time + ' topic=' + topic + ' deep=' + deep);

// ─────────────────────────────
// 执行搜索 (带自动降级)
// ─────────────────────────────

const opts = { query, count, region, time, topic, deep, timeout: timeoutMs };

let lastErr = null;
for (const e of chain) {
  log('trying ' + e.key + '...');
  try {
    const results = await e.mod.search(opts);
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

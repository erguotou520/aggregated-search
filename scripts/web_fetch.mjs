#!/usr/bin/env node
/**
 * web_fetch — 通过 Jina Reader 抓取网页并返回 Markdown 内容
 *
 * API: https://r.jina.ai/<url>
 *   无 JINA_API_KEY 时仍可使用，但会受到速率限制
 *
 * 用法 (CLI):
 *   node web_fetch.mjs <url> [选项]
 *
 * 选项:
 *   --trim               截取模式: 跳过前 5 行元数据, 最多 30 行 / 1000 字符
 *   --max-lines <n>      截取行数上限 (默认 30, 需配合 --trim)
 *   --max-chars <n>      截取字符上限 (默认 1000, 需配合 --trim)
 *   --timeout <ms>       超时毫秒数 (默认 20000)
 *   -h, --help           显示帮助
 *
 * 输出: JSON 对象到 stdout
 *   成功: { url, content }
 *   失败: { url, error }
 */

export const JINA_API_KEY = (process.env.JINA_API_KEY || '').trim();

/**
 * 截取 Jina 返回的 Markdown 内容:
 *   1. 跳过前 5 行 (Jina 返回的元数据头)
 *   2. 最多取 maxLines 行 且 总字符 <= maxChars
 * @param {string} text
 * @param {number} [maxLines=30]
 * @param {number} [maxChars=1000]
 * @returns {string}
 */
export function trimContent(text, maxLines = 30, maxChars = 1000) {
  if (!text) return '';
  const lines = text.split('\n').slice(5); // 跳过前 5 行元数据
  const kept = [];
  let chars = 0;
  for (const line of lines) {
    if (kept.length >= maxLines) break;
    if (chars + line.length > maxChars) break;
    kept.push(line);
    chars += line.length + 1; // +1 for newline
  }
  return kept.join('\n');
}

/**
 * 通过 Jina Reader 读取一个 URL 的 Markdown 内容
 * @param {string} url         目标 URL
 * @param {object} [opts]
 * @param {number} [opts.timeout=20000]   超时毫秒
 * @param {boolean} [opts.trim=false]     是否截取
 * @param {number} [opts.maxLines=30]     截取行数上限
 * @param {number} [opts.maxChars=1000]   截取字符上限
 * @returns {Promise<string>}  Markdown 内容
 */
export async function fetchPage(url, { timeout = 20000, trim = false, maxLines = 30, maxChars = 1000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const headers = {
    'X-Retain-Images': 'none',
  };
  if (JINA_API_KEY) headers['Authorization'] = 'Bearer ' + JINA_API_KEY;
  try {
    const resp = await fetch('https://r.jina.ai/' + url, { headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!resp.ok) throw new Error('Jina HTTP ' + resp.status);
    const text = await resp.text();
    return trim ? trimContent(text, maxLines, maxChars) : text;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/**
 * 判断 URL 是否有意义路径（非主域名），用于过滤不值得深度抓取的链接
 * @param {string} url
 * @returns {boolean}
 */
export function isDeepFetchable(url) {
  try {
    const { pathname } = new URL(url);
    return pathname.length > 1 && pathname !== '/';
  } catch { return false; }
}

// ─────────────────────────────
// CLI 入口
// ─────────────────────────────

if (process.argv[1].endsWith('web_fetch.mjs')) {
  const cliArgs = process.argv.slice(2);

  if (!cliArgs.length || cliArgs[0] === '-h' || cliArgs[0] === '--help') {
    process.stderr.write(
      'Usage: node web_fetch.mjs <url> [--trim] [--max-lines 30] [--max-chars 1000] [--timeout 20000]\n'
    );
    process.exit(cliArgs[0] === '-h' || cliArgs[0] === '--help' ? 0 : 2);
  }

  const targetUrl = cliArgs[0];
  let doTrim = false;
  let maxLines = 30;
  let maxChars = 1000;
  let timeoutMs = 20000;

  for (let i = 1; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if      (a === '--trim')       doTrim   = true;
    else if (a === '--max-lines')  maxLines  = parseInt(cliArgs[++i] || '30',   10);
    else if (a === '--max-chars')  maxChars  = parseInt(cliArgs[++i] || '1000', 10);
    else if (a === '--timeout')    timeoutMs = parseInt(cliArgs[++i] || '20000', 10);
    else { process.stderr.write('Unknown argument: ' + a + '\n'); process.exit(2); }
  }

  try {
    const content = await fetchPage(targetUrl, { timeout: timeoutMs, trim: doTrim, maxLines, maxChars });
    process.stdout.write(JSON.stringify({ url: targetUrl, content }, null, 2) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ url: targetUrl, error: e.message }, null, 2) + '\n');
    process.exit(1);
  }
}

---
name: aggregated-search
description: Web search tools. Use when the user requests web search, needs information from the internet, wants to research a topic, or find answers online.
metadata: {"clawdbot":{"emoji":"🔍","requires":{"bins":["node"],"env":["SEARXNG_URL","SERPER_API_KEY","TAVILY_API_KEY","BING_API_KEY","OLLAMA_API_KEY"]},"primaryEnv":"SEARXNG_URL"}}
---

# Aggregated Search

多源网页搜索，支持自动降级。引擎链：**SearXNG → Serper → Tavily → Bing → DuckDuckGo → Ollama**

- **DuckDuckGo** 无需 API Key，始终作为最终兜底
- 其他引擎按优先级依次尝试，跳过未配置的引擎
- 所有引擎输出统一格式：`Array<{title, url, source, body}>`

## 环境变量

| 变量 | 说明 | 必须 |
|------|------|------|
| `SEARXNG_URL` | SearXNG 实例地址，如 `http://127.0.0.1:8081` | 可选 |
| `SERPER_API_KEY` | Serper.dev API Key | 可选 |
| `TAVILY_API_KEY` | Tavily API Key | 可选 |
| `BING_API_KEY` | Bing Web Search API Key | 可选 |
| `OLLAMA_API_KEY` | Ollama 云端搜索 API Key (ollama.com/settings/keys) | 可选 |
| `SEARCH_REGION` | 默认搜索地区，如 `zh-CN`（默认）或 `en-US` | 可选 |
| `SEARCH_RESULTS_LIMIT` | 默认结果数量（默认 5） | 可选 |
| `SEARCH_TIMEOUT_SECONDS` | 默认超时秒数（默认 30） | 可选 |

## Usage

```bash
SKILL_DIR=~/.openclaw/skills/aggregated-search

# 基础搜索（自动降级）
node $SKILL_DIR/scripts/search.mjs "搜索词"

# 指定返回数量
node $SKILL_DIR/scripts/search.mjs "搜索词" -n 10

# 列出所有可用引擎
node $SKILL_DIR/scripts/search.mjs --list

# 指定引擎（跳过降级）
node $SKILL_DIR/scripts/search.mjs "搜索词" --source searxng
node $SKILL_DIR/scripts/search.mjs "搜索词" --source serper
node $SKILL_DIR/scripts/search.mjs "搜索词" --source tavily
node $SKILL_DIR/scripts/search.mjs "搜索词" --source bing
node $SKILL_DIR/scripts/search.mjs "搜索词" --source duckduckgo
node $SKILL_DIR/scripts/search.mjs "搜索词" --source ollama

# 地区与语言
node $SKILL_DIR/scripts/search.mjs "搜索词" --region zh-CN
node $SKILL_DIR/scripts/search.mjs "搜索词" --region en-US

# 时间范围
node $SKILL_DIR/scripts/search.mjs "搜索词" --time day
node $SKILL_DIR/scripts/search.mjs "搜索词" --time week
node $SKILL_DIR/scripts/search.mjs "搜索词" --time month
node $SKILL_DIR/scripts/search.mjs "搜索词" --time year

# 搜索主题
node $SKILL_DIR/scripts/search.mjs "搜索词" --topic news
node $SKILL_DIR/scripts/search.mjs "搜索词" --topic images
node $SKILL_DIR/scripts/search.mjs "搜索词" --topic videos

# 深度搜索（Tavily advanced 模式）
node $SKILL_DIR/scripts/search.mjs "搜索词" --deep

# 详细模式（显示使用了哪个引擎）
node $SKILL_DIR/scripts/search.mjs "搜索词" --verbose

# 超时控制
node $SKILL_DIR/scripts/search.mjs "搜索词" --timeout 15
```

## 选项说明

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-n <count>` | 结果数量 | 5 |
| `--source <name>` | 指定引擎 | 自动降级 |
| `--region <code>` | 地区代码 | zh-CN |
| `--time <range>` | 时间范围：`day`/`week`/`month`/`year` | 无限制 |
| `--topic <type>` | 主题：`general`/`news`/`images`/`videos` | general |
| `--deep` | 深度搜索（较慢但更全面） | false |
| `--verbose` | 显示引擎来源信息 | false |
| `--timeout <sec>` | 超时秒数 | 30 |
| `--list` | 列出可用引擎及状态 | — |

## 输出格式

结果以 JSON 数组形式输出到 **stdout**，日志输出到 **stderr**：

```json
[
  {
    "title": "页面标题",
    "url": "https://example.com/page",
    "source": "duckduckgo",
    "body": "页面摘要或内容片段..."
  }
]
```

## 引擎说明

| 引擎 | 时间范围支持 | 备注 |
|------|-------------|------|
| **SearXNG** | day/month/year（无 week） | 聚合多个搜索引擎，支持 pageno/safesearch/engines 参数 |
| **Serper** | hour/day/week/month/year | Google 搜索结果，支持翻页 |
| **Tavily** | day/week/month/year（仅 news） | AI 优化结果，支持 deep 模式 |
| **Bing** | day/week/month（无 year） | Microsoft Bing 官方 API |
| **DuckDuckGo** | day/week/month/year | 无需 API Key，始终可用 |
| **Ollama** | 无 | Ollama 云端 REST API，非本地推理 |

## 故障排除

无结果时：
1. 增加结果数 `-n 10`
2. 使用 `--deep` 深度搜索
3. 用 `--source` 单独测试某个引擎
4. 用 `--list` 检查哪些引擎已配置

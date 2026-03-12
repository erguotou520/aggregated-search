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
- 支持三种搜索策略：`fallback`（顺序降级）、`random`（随机顺序）、`aggregate`（并行聚合）

## 环境变量

| 变量 | 说明 | 必须 |
|------|------|------|
| `SEARXNG_URL` | SearXNG 实例地址，如 `http://127.0.0.1:8081` | 可选 |
| `SERPER_API_KEY` | Serper.dev API Key | 可选 |
| `TAVILY_API_KEY` | Tavily API Key | 可选 |
| `BING_API_KEY` | Bing Web Search API Key | 可选 |
| `OLLAMA_API_KEY` | Ollama 云端搜索 API Key (ollama.com/settings/keys) | 可选 |

## 搜索策略

| 策略 | 说明 | 适合场景 |
|------|------|--------|
| `fallback`（默认）| 按优先级顺序尝试，第一个成功即返回 | 速度优先，节省 API 配额 |
| `random` | 随机化引擎顺序后依次降级 | 负载均衡，避免单一引擎压力 |
| `aggregate` | 所有引擎并行搜索，结果去重合并 | 覆盖率优先，需要多视角结果 |

## 引擎选型建议

| 场景 | 推荐引擎 | 说明 |
|------|--------|------|
| 中文内容搜索 | SearXNG (cn-zh) / Bing | 国内源，中文结果质量高 |
| 全球英文搜索 | Serper / Tavily | Google 质量，国际覆盖好 |
| 新闻资讯 | Serper (topic=news) / Bing | 实时性好 |
| AI/技术文档 | Tavily | AI 优化，代码/文档友好 |
| 无 API 场景 | DuckDuckGo | 无需配置，始终可用 |
| 多结果覆盖 | aggregate 策略 | 多引擎并行，去重后合并 |

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

# 搜索策略
node $SKILL_DIR/scripts/search.mjs "搜索词" --strategy fallback    # 顺序降级（默认）
node $SKILL_DIR/scripts/search.mjs "搜索词" --strategy random      # 随机顺序降级
node $SKILL_DIR/scripts/search.mjs "搜索词" --strategy aggregate   # 并行聚合所有引擎

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
| `--strategy <mode>` | 搜索策略：`fallback`/`random`/`aggregate` | fallback |
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
4. 使用 `--strategy aggregate` 多引擎并行搜索
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

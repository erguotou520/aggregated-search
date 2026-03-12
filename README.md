# aggregated-search

多源聚合网页搜索工具，为 AI Agent 提供统一的搜索接口。支持 6 个搜索引擎，自动降级，**无第三方依赖**，要求 Node.js ≥ 22.9.0。

## 功能特性

- **6 个搜索引擎**：SearXNG → Serper → Tavily → Bing → DuckDuckGo → Ollama
- **自动降级**：配置哪个用哪个，DuckDuckGo 始终作为无需配置的兜底
- **统一输出格式**：`Array<{title, url, source, body}>`
- **零依赖**：仅使用 Node.js 22.9.0+ 内置 API（原生 `fetch`、ES Module）
- **灵活参数**：地区、时间范围、搜索主题、深度搜索、翻页等

## 快速开始

```bash
# 克隆项目
git clone git@github.com:erguotou520/aggregated-search.git
cd aggregated-search

# 配置环境变量（至少配置一个引擎，或直接使用 DuckDuckGo 无需配置）
cp .env.example .env
# 编辑 .env，填入你的 API Key

# 运行搜索
node scripts/search.mjs "Node.js 教程"
```

## 环境变量配置

复制 `.env.example` 为 `.env` 并按需填写，所有引擎均为可选：

| 变量 | 引擎 | 说明 |
|------|------|------|
| `SEARXNG_URL` | SearXNG | 自托管实例地址，如 `http://localhost:8081` |
| `SERPER_API_KEY` | Serper | [serper.dev](https://serper.dev) 获取 |
| `TAVILY_API_KEY` | Tavily | [tavily.com](https://tavily.com) 获取，有免费额度 |
| `BING_API_KEY` | Bing | Azure 认知服务 Bing Web Search API v7 |
| `BING_ENDPOINT` | Bing | 可选，默认 `https://api.bing.microsoft.com` |
| `OLLAMA_API_KEY` | Ollama | [ollama.com/settings/keys](https://ollama.com/settings/keys) 获取 |
| `JINA_API_KEY` | 深度抓取 | [jina.ai](https://jina.ai/api-access) 获取，`--deep` 时抓取完整网页内容 |

> **DuckDuckGo** 无需任何配置，始终可用，作为最终兜底引擎。
> 区域/数量/超时等参数均通过 CLI 传入，无需设置环境变量。

## 使用方法

### 基础搜索

```bash
# 自动按优先级降级
node scripts/search.mjs "搜索词"

# 指定结果数量
node scripts/search.mjs "搜索词" -n 10

# 查看所有引擎及配置状态
node scripts/search.mjs --list
```

### 搜索策略

```bash
# fallback（默认）：按优先级顺序尝试，第一个成功即返回
node scripts/search.mjs "搜索词" --strategy fallback

# random：随机化引擎顺序后依次降级（负载均衡）
node scripts/search.mjs "搜索词" --strategy random

# aggregate：所有引擎并行搜索，结果去重后合并返回
node scripts/search.mjs "搜索词" --strategy aggregate
```

### 常用选项

```bash
# 指定引擎（跳过降级）
node scripts/search.mjs "搜索词" --source duckduckgo
node scripts/search.mjs "搜索词" --source searxng

# 地区与语言
node scripts/search.mjs "搜索词" --region en-US

# 时间范围
node scripts/search.mjs "搜索词" --time day     # 过去一天
node scripts/search.mjs "搜索词" --time week    # 过去一周
node scripts/search.mjs "搜索词" --time month   # 过去一个月
node scripts/search.mjs "搜索词" --time year    # 过去一年

# 搜索主题
node scripts/search.mjs "搜索词" --topic news    # 新闻搜索
node scripts/search.mjs "搜索词" --topic general # 综合（默认）

# 深度搜索（Tavily advanced 模式，更慢但更全面）
node scripts/search.mjs "搜索词" --deep

# 显示详细日志（哪个引擎在工作）
node scripts/search.mjs "搜索词" --verbose

# 自定义超时
node scripts/search.mjs "搜索词" --timeout 15
```

### 完整选项

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `-n <数量>` | 5 | 结果数量（最多 20） |
| `--source <引擎>` | 自动降级 | 强制指定：`searxng`/`serper`/`tavily`/`bing`/`duckduckgo`/`ollama` |
| `--strategy <策略>` | `fallback` | `fallback`（顺序降级）/`random`（随机顺序）/`aggregate`（并行聚合） |
| `--region <代码>` | `zh-CN` | 地区代码 |
| `--time <范围>` | 无 | `day`/`week`/`month`/`year` |
| `--topic <类型>` | `general` | `general`/`news`/`images`/`videos` |
| `--deep` | false | 深度搜索：Tavily 用 advanced 模式；其余引擎用 Jina Reader 抓取全文（需 `JINA_API_KEY`） |
| `--verbose` | false | 输出调试信息到 stderr |
| `--timeout <秒>` | 30 | 请求超时 |
| `--list` | — | 列出引擎状态 |
| `-h`/`--help` | — | 显示帮助 |

### 输出格式

结果以 JSON 数组输出到 **stdout**，日志输出到 **stderr**：

```json
[
  {
    "title": "Node.js — Run JavaScript Everywhere",
    "url": "https://nodejs.org/",
    "source": "duckduckgo",
    "body": "Node.js® is a free, open-source, cross-platform JavaScript runtime environment..."
  }
]
```

### 在脚本中调用

```bash
# 将结果重定向到文件
node scripts/search.mjs "Python 爬虫" -n 5 > results.json 2>/dev/null

# 管道给 jq 处理
node scripts/search.mjs "OpenAI" --source tavily | jq '.[0].url'
```

## 测试

使用 Node.js 内置 `node:test`，无需安装任何测试框架：

```bash
node --test scripts/test.mjs
```

或：

```bash
npm test
```

测试覆盖范围：
- 全部 6 个引擎的单元测试（82 个测试用例）
- `isAvailable()` 逻辑（有/无 API Key）
- 请求参数构建（通过 mock fetch 验证）
- 输出格式验证（`{title, url, source, body}`）
- 错误处理（HTTP 失败、空结果、超时）
- DuckDuckGo HTML 解析（fixture 测试）
- 各引擎特有参数（时间映射、翻页、地区代码等）
- 集成测试（真实网络，网络不可用时自动 skip）

## 开发

### 添加新引擎

在 `scripts/engines/` 下新建 `<name>.mjs`，导出三个接口：

```js
export const name = 'my-engine';

export function isAvailable() {
  return !!(process.env.MY_ENGINE_API_KEY || '').trim();
}

export async function search({ query, count = 5, region = 'zh-CN', time, topic = 'general', timeout = 30000 }) {
  // 实现搜索逻辑
  // 返回 Array<{title, url, source: name, body}>
}
```

然后在 `scripts/search.mjs` 中的 `ENGINES` 数组里按优先级添加，并在 `scripts/test.mjs` 中添加对应测试用例。

详细规范参见 [CLAUDE.md](CLAUDE.md)。

### 引擎时间范围限制

| 引擎 | 支持的时间范围 |
|------|--------------|
| SearXNG | `day` / `month` / `year`（**不支持 week**） |
| Serper | `hour` / `day` / `week` / `month` / `year` |
| Tavily | `day` / `week` / `month` / `year`（仅 news 生效） |
| Bing | `day` / `week` / `month`（**不支持 year**） |
| DuckDuckGo | `day` / `week` / `month` / `year` |
| Ollama | 不支持 |

## 引擎说明

| 引擎 | 优先级 | 是否需要配置 | 特点 |
|------|--------|------------|------|
| SearXNG | 1 | 需要自建实例 | 聚合多引擎，可接国内源 |
| Serper | 2 | 需要 API Key | Google 搜索封装，质量最优 |
| Tavily | 3 | 需要 API Key | AI 优化结果，支持深度搜索 |
| Bing | 4 | 需要 API Key | 微软 Bing，中文友好 |
| DuckDuckGo | 5 | **无需配置** | 隐私保护，HTML 解析，兜底 |
| Ollama | 6 | 需要 API Key | Ollama 云端 REST API |

## 引擎选型建议

根据不同搜索场景的特点，以下是推荐策略：

| 场景 | 推荐引擎/策略 | 说明 |
|------|-------------|------|
| 中文内容 | SearXNG (国内) / Bing | 对中文索引深，国内源更全 |
| 全球英文内容 | Serper / Tavily | Google 质量，国际覆盖广 |
| 新闻资讯 | Serper `--topic news` / Bing | 时效性强，收录快 |
| AI/技术文档 | Tavily (`--deep`) | AI 优化，适合 RAG 场景 |
| 无密钥兜底 | DuckDuckGo | 免配置，隐私友好 |
| 最大覆盖率 | `--strategy aggregate` | 多引擎并行，适合重要查询 |
| 负载均衡 | `--strategy random` | 随机分散请求，避免单引擎限流 |

## License

MIT

# aggregated-search — 开发规范

## 项目概述

多源聚合网页搜索工具，为 AI Agent 提供统一的搜索接口。支持 SearXNG、Serper、Tavily、Bing、DuckDuckGo、Ollama 六个引擎，自动降级，无第三方依赖。

## 运行环境

- **Node.js ≥ 22.9.0**（使用原生 `fetch`、`node:test`、ES Module）
- **零外部依赖**：不允许安装任何 npm 包，所有功能必须用 Node.js 内置 API 实现

## 项目结构

```
aggregated-search/
├── scripts/
│   ├── search.mjs          # CLI 入口，聚合搜索 + 自动降级
│   ├── test.mjs            # 测试套件 (node:test，TDD)
│   └── engines/            # 各引擎适配器（每文件一个引擎）
│       ├── searxng.mjs
│       ├── serper.mjs
│       ├── tavily.mjs
│       ├── bing.mjs
│       ├── duckduckgo-lite.mjs
│       └── ollama.mjs
├── .env.example            # 环境变量模板
├── CLAUDE.md               # 本文件，开发规范
├── README.md               # 用户文档
├── SKILL.md                # OpenClaw skill 描述
└── package.json
```

## 引擎接口规范

每个引擎文件必须导出以下三个内容：

```js
// 引擎标识符（小写，用于 --source 参数和 source 字段）
export const name = 'engine-name';

// 是否可用（检查必要环境变量是否设置）
export function isAvailable() { return !!process.env.REQUIRED_KEY; }

// 搜索函数
export async function search({ query, count, region, time, topic, deep, timeout }) {
  // 返回: Array<{ title: string, url: string, source: string, body: string }>
}
```

### 输出格式（不可变更）

```js
Array<{
  title:  string,  // 页面标题
  url:    string,  // 完整 URL，以 http(s):// 开头
  source: string,  // 等于该引擎的 name 常量
  body:   string,  // 摘要/正文片段
}>
```

### 通用搜索参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | 必须 | 搜索词 |
| `count` | number | 5 | 结果数量 |
| `region` | string | `zh-CN` | 地区/语言代码 |
| `time` | string | — | `day`/`week`/`month`/`year` |
| `topic` | string | `general` | `general`/`news`/`images`/`videos` |
| `deep` | boolean | false | 深度搜索（仅 Tavily 生效） |
| `timeout` | number | 30000 | 超时毫秒数 |

## 测试规范（TDD）

**先写测试，再写实现。** 使用 Node.js 内置 `node:test` + `node:assert/strict`。

```bash
node --test scripts/test.mjs
```

### 每个引擎必须包含以下测试

1. `name` 常量值正确
2. `isAvailable()` 在未设置环境变量时返回 false
3. `isAvailable()` 在设置环境变量后返回 true
4. `search()` 在未配置时抛出含 "not configured" 的错误
5. 请求参数构建正确（通过 mock `globalThis.fetch` 验证）
6. 返回 `{title, url, source, body}` 格式
7. 遵守 `count` 限制
8. 空结果时抛出含 "no results" 的错误
9. HTTP 错误时抛出含状态码的错误
10. 各引擎特有参数（时间范围、翻页、地区映射等）

### Mock fetch 模式

```js
// 替换
globalThis.fetch = async (url, opts) => {
  // 捕获 url 和 opts 供断言使用
  return { ok: true, status: 200, json: async () => mockData, text: async () => '' };
};
// 测试后恢复原始 fetch
```

## 编码规范

- **ES Module**：所有文件使用 `import`/`export`，文件扩展名 `.mjs`
- **无依赖**：只使用 `node:` 内置模块和全局 `fetch`
- **错误处理**：使用 `AbortController` + `setTimeout` 实现超时，catch 后 `clearTimeout` 再 rethrow
- **日志**：调试信息写 `stderr`，结果写 `stdout`
- **环境变量**：通过 `process.env` 读取，默认值写在代码里而不是 `.env`

## 引擎特殊约束

| 引擎 | 时间范围限制 | 备注 |
|------|-------------|------|
| SearXNG | `day`/`month`/`year`（**无 week**） | 官方 API 不支持 week |
| Bing | `day`/`week`/`month`（**无 year**） | freshness 参数限制 |
| Ollama | 不支持时间/地区过滤 | 云端 REST API，非本地推理 |
| DuckDuckGo | 支持全部时间范围 | 无需 API Key，HTML 解析 |

## Git 提交规范

使用简洁的中文或英文提交信息，格式：`type: message`

类型：`feat`、`fix`、`test`、`docs`、`refactor`、`chore`

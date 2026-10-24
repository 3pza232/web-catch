# web-catch

把网页变成干净的 Markdown，或者直接搜索网页——一个可脚本化、给 agent 用的单文件 CLI。

- **抓取**：Readability 抽取正文 + GFM 表格 + 代码块，附页面链接清单（带上下文）
- **搜索**：接 DeepSeek Search API，可 `--fetch-top` 直接抓取前 N 条正文，搜索与阅读闭环
- **纯文本/JSON/XML/PDF**：按 `Content-Type` 与文件头自动分派
- **面向 agent**：`--json`、`--outline`、`--max-chars`、稳定的退出码

## 安装

```sh
# 直接跑源码（Node ≥ 20）
node bin/cli.mjs https://example.com

# 或注册为全局命令
npm link            # 或 bun link
web-catch https://example.com

# 编译成单文件可执行程序（需要 Bun）
npm run build       # 产出 web-catch.exe
```

## 快速开始

```sh
web-catch https://example.com                    # 正文 + 链接清单
web-catch https://example.com --no-links         # 只要正文
web-catch https://example.com --outline          # 只看标题大纲，判断值不值得读
web-catch https://example.com --links-only       # 只看出口链接（页面侦察）
web-catch https://example.com --json | jq .      # 结构化输出
web-catch https://arxiv.org/abs/2401.00001 --via api   # 走 DeepSeek Fetch API（反爬兜底）
curl -s https://example.com | web-catch --url https://example.com   # 管道模式
web-catch search "deepseek v3.2 release" --count 5 --fetch-top 2
```

## 命令

### `web-catch <url>` / `web-catch fetch <url>`

| 选项 | 说明 |
|---|---|
| `--max-chars <n>` | 正文输出上限，默认 `60000`，超出截断并标记 |
| `--no-links` | 不输出链接清单 |
| `--links-only` | 只输出链接清单 |
| `--outline` | 只输出标题大纲（层级 + 每节字符数） |
| `--raw` | 跳过正文抽取，直接输出解码后的文本 |
| `--json` | 输出结构化结果（见下） |
| `-o, --output <file>` | 写入文件 |
| `--via http\|api` | 传输方式：直连 HTTP（默认）或 DeepSeek Fetch API |
| `--timeout <sec>` | 请求超时，默认 15（API 传输同样生效） |
| `--retries <n>` | 网络错误与 408/429/5xx 的重试次数，默认 2 |
| `--user-agent <str>` | 覆盖 UA |
| `--header "K: V"` | 附加请求头，可重复 |
| `--cookie-file <file>` | Netscape 格式 cookie 文件（登录态页面） |
| `--charset <label>` | 强制源编码（如 `gbk`、`shift_jis`） |
| `--cache` | 开启条件请求缓存（ETag / Last-Modified） |
| `--no-cache` | 跳过缓存读取，但仍刷新缓存 |

### `web-catch search <query...>`

| 选项 | 说明 |
|---|---|
| `--count <n>` | 结果条数 1–50，默认 10 |
| `--need-content` | 让 API 直接返回正文（`content` 字段） |
| `--fetch-top <n>` | 额外抓取前 n 条正文并附在结果后 |
| `--json` | 输出原始 API 载荷 |
| `--api-key <key>` | 覆盖 `DEEPSEEK_API_KEY` |
| `--api-base <url>` | 覆盖 API 基址 |

查询语法原样传给搜索服务：`site:github.com`、`-site:x.com`、`-word`、`"精确短语"`、`lang:zh,en`、`after:2025-01-01`、`before:2026`。

## 输出格式

人类可读模式是一个带元数据头的 Markdown 文档：

```text
url: https://example.com/post
title: 页面标题
fetched: 2026-10-24 07:00:00
transport: http
chars: 5321 (words 812)
status: 200
truncated: true (limit 60000 chars)

# 正文 Markdown ...

---
## Page links (35)
1. [链接文字](https://…)
   - context: 链接周围的文字片段
```

`--json` 的字段：

```json
{
  "url": "https://example.com/post",
  "title": "…",
  "status": 200,
  "transport": "http",
  "fetchedAt": "2026-10-24 07:00:00",
  "cached": false,
  "extracted": true,
  "chars": 5321,
  "words": 812,
  "truncated": false,
  "limit": 60000,
  "pages": 12,
  "markdown": "…",
  "links": [{ "href": "…", "text": "…", "context": "…" }],
  "outline": [{ "level": 1, "title": "…", "chars": 120 }]
}
```

`extracted: false` 表示 Readability 没能识别正文，`markdown` 是整页可见文本（SPA 常见）。

## 凭据解析（受管终端里也能用）

DSH 等 harness 在 spawn 子进程前会剥离名字含 `KEY|PASSWORD|SECRET|TOKEN` 的环境变量，因此在它们的终端里直接跑本 CLI 时，`DEEPSEEK_API_KEY` 通常不可见。凭据按以下顺序解析：

1. `--api-key` / `--api-base`
2. 环境变量 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL`
3. 配置文件 `~/.web-catch/config.json`（`$WEB_CATCH_CONFIG` 可改路径）：

   ```json
   { "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com" }
   ```

   也可写 `"apiKeyEnv": "MY_VAR"` 改为从任意环境变量读取。
4. Windows：直接查询当前用户环境（注册表 `HKCU\Environment`），绕过环境剥离，只读。

只有第 4 步会访问注册表，且仅限 Windows；key 不会写入日志或输出。库使用者可用 `apiKeySource()` 做诊断。

## 搜索后端

搜索走 DeepSeek 官方 Search / Fetch API：

- 鉴权：`DEEPSEEK_API_KEY`（或 `--api-key`），Bearer Token
- 端点：`POST /v1/tools/search`、`POST /v1/tools/fetch`
- 计费：每 1000 次**成功**请求 5 元；失败、无结果不计费
- 限速：Search 100 QPS、Fetch 25 QPS（账号级）

未设置 key 时 `search` 与 `--via api` 会以退出码 4 明确失败，并提示设置方式。

## 编码处理

依次尝试：`--charset` → BOM → 响应头 `charset` → HTML `<meta charset>` → UTF-8。GBK/GB2312 会映射到 `gb18030`，中文站点不再乱码。

## 缓存

`--cache` 会保存响应体与 `ETag` / `Last-Modified`，下次请求发条件头；`304` 时直接复用本地副本并在输出标记 `cached: true`。缓存位置 `$WEB_CATCH_CACHE` 或 `~/.cache/web-catch`。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 网络 / HTTP 错误 |
| 2 | 提取失败（无可用正文、不支持的内容类型） |
| 3 | 参数错误 |
| 4 | 上游 API 错误（鉴权、余额、限流等） |

## 作为库使用

```js
import { fetchPage } from 'web-catch';

const page = await fetchPage('https://example.com', { maxChars: 20_000, cache: true });
console.log(page.title, page.chars, page.markdown.slice(0, 200));
```

`fetchPage` 返回与 `--json` 同构的对象，不打印任何内容。

## MCP 模式

```sh
web-catch --mcp
```

以 stdio 暴露两个工具，任何支持 MCP 的宿主（DSH / Claude Code / Cursor 等）都能直接调用：

| 工具 | 参数 | 说明 |
|---|---|---|
| `fetch` | `url`、`maxChars`、`links`、`outlineOnly`、`via`、`cache` | 抓取一页，返回带元数据头的 Markdown |
| `search` | `query`、`count`、`needContent`、`fetchTop`、`maxChars` | 搜索，可顺带抓取前 N 条正文 |

stdout 只走 JSON-RPC，诊断信息走 stderr。凭据解析与 CLI 完全一致（含受管环境下的注册表回退）。

DSH 侧接入示例（profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: mcp-webcatch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: webcatch
        transport: stdio
        command: 'D:\web-catch\web-catch.exe'
        args: ['--mcp']
        toolCallTimeoutMs: 120000
```

工具名会呈现为 `mcp__webcatch__fetch` 与 `mcp__webcatch__search`。

更新 MCP 服务的注意事项：宿主拉起的是 `web-catch.exe`，源码改动后必须 `npm run build` 重建，再让宿主重载该行（禁用→启用，或改动一个配置值）。运行中的 exe 会锁住文件，直接构建会报 `EPERM`，所以要先停用该行再构建。

## 架构

```text
bin/cli.mjs         进程入口：异常 → 退出码
lib/cli/            参数解析、帮助、命令分发
lib/commands/       fetch 与 search 的命令级编排（解析入参 → 调 page → 渲染）
lib/page.mjs        URL/HTML → 页面结果对象（网络 + 分派 + 抽取，无渲染）
lib/mcp.mjs         MCP stdio 服务（复用 page / deepseek / render）
lib/net/            http（重试/超时/头/条件请求）、decode（编码探测）、deepseek（API 客户端）
lib/extract/        dom / article（Readability + Turndown GFM）/ links / pdf
lib/cache.mjs       条件请求缓存
lib/render.mjs      Markdown / outline / links / search 渲染与截断
lib/text.mjs        规范化、统计、大纲
lib/constants.mjs   版本、默认值、退出码、内容类型
```

分层原则：`net` 与 `extract` 不感知 CLI，`page` 不感知渲染，`commands` 只做编排。新增能力（站点适配器、批量抓取、MCP 服务）在对应层追加即可。

## 已知边界

- 不执行 JavaScript，SPA 需要应用自身渲染（或 `--via api` 由服务端处理）
- 不自动绕过登录、验证码、付费墙；可用 `--cookie-file` / `--header` 携带凭据
- 搜索能力依赖外部 API（本工具不自建搜索引擎）

## 路线图

- 站点适配器（GitHub / 微信 / 知乎 / Reddit / Hacker News / arXiv）
- 批量抓取 `--batch urls.txt --concurrency N`
- 同一 URL 两次抓取的 `--diff`
- 搜索后端插件化（SearXNG / Brave）

## 许可

MIT

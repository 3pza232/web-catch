# web-catch

把网页变成干净的 Markdown，或者直接搜索网页——一个可脚本化、给 agent 用的 CLI（可编译成单文件可执行程序）。

- **抓取**：Readability 抽取正文 + GFM 表格 + 代码块，附页面链接清单（带上下文）
- **搜索**：接 DeepSeek Search API，可 `--fetch-top` 直接抓取前 N 条正文，搜索与阅读闭环
- **纯文本/JSON/XML/PDF**：按 `Content-Type` 与文件头自动分派
- **面向 agent**：`--json`、`--outline`、`--max-chars`、`--link-limit`、稳定的退出码
- **API 兜底可净化**：`--via api` 支持语言过滤（`--api-lang`）并自动处理上游 Markdown 转义

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
| `--link-limit <n>` | 链接清单条数上限，默认 `50`（1–1000） |
| `--no-links` | 不输出链接清单 |
| `--links-only` | 只输出链接清单 |
| `--outline` | 只输出标题大纲（层级 + 每节字符数） |
| `--raw` | 跳过正文抽取，直接输出解码后的文本 |
| `--json` | 输出结构化结果（见下） |
| `-o, --output <file>` | 写入文件 |
| `--via http\|api` | 传输方式：直连 HTTP（默认）或 DeepSeek Fetch API |
| `--api-lang <lang>` | 仅 `--via api`：只保留该语言的内容（`en`、`zh`、`auto` 等；`auto` 按标题语言） |
| `--no-unescape` | 仅 `--via api`：保留上游 Markdown 标点转义（默认会去掉无害转义） |
| `--timeout <sec>` | 请求超时，默认 15（API 传输同样生效） |
| `--retries <n>` | 网络错误与 408/429/5xx 的重试次数，默认 2，`0` 关闭重试 |
| `--user-agent <str>` | 覆盖 UA |
| `--header "K: V"` | 附加请求头，可重复 |
| `--cookie-file <file>` | Netscape 格式 cookie 文件（登录态页面） |
| `--charset <label>` | 强制源编码（如 `gbk`、`shift_jis`） |
| `--cache` | 开启条件请求缓存（ETag / Last-Modified） |
| `--no-cache` | 跳过缓存读取，但仍刷新缓存 |
| `--url <url>` | 从 stdin 读 HTML，并用 `<url>` 作为页面 URL / 相对链接基准 |

`--links-only`、`--outline`、`--raw` 互斥，组合使用会报用法错误（退出码 3）；`--json` 可与其中任意一个组合。与 `--outline` 同用时，`json.markdown` 是大纲文本（与 Markdown 模式一致），全文仍会在 `outline` 之外被丢弃——需要全文就不要加 `--outline`。

### `web-catch search <query...>`

| 选项 | 说明 |
|---|---|
| `--count <n>` | 结果条数 1–50，默认 10 |
| `--need-content` | 让 API 直接返回正文（`content` 字段） |
| `--ori-question <text>` | 触发搜索的原始问题，帮助理解意图（1–128 字符） |
| `--localization <ip>` | 用该 IPv4/IPv6 偏好本地化搜索结果（上游地理库为准，查询语言也会影响；代理会影响未传 IP 时的默认定位） |
| `--fetch-top <n>` | 额外抓取前 n 条正文并附在结果后 |
| `--json` | 输出结构化搜索结果（`query` / `count` / `results` / `fetched`） |
| `--api-key <key>` | 覆盖 `DEEPSEEK_API_KEY` |
| `--api-base <url>` | 覆盖 API 基址 |

查询语法原样传给搜索服务：`site:github.com`、`-site:x.com`、`-word`、`"精确短语"`、`lang:zh,en`、`after:2025-01-01`、`before:2026`。

## 输出格式

人类可读模式是一个带元数据头的 Markdown 文档：

```text
url: https://example.com/post
title: 页面标题
fetched: 2026-10-24T07:00:00Z
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

`--json` 的字段（`pages` 仅 PDF 出现，`status` 在 api/stdin 下缺省，`outline` 仅在 `--outline` 时出现，`extractedReason` 仅在提取降级时出现，`cachedAt` 仅在缓存命中时出现，`cacheNote` 仅在缓存不可用时出现）：

```json
{
  "url": "https://example.com/post",
  "title": "…",
  "status": 200,
  "transport": "http",
  "fetchedAt": "2026-10-24T07:00:00Z",
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

`extracted: false` 表示 Readability 没能识别正文，`markdown` 是整页可见文本（SPA 常见）。`--json --outline` 时 `markdown` 是大纲正文（纯 Markdown 标题，不含元数据头；元数据在顶层字段）。

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

Fetch API 的 `content` 由上游截断在约 2500 字符（与 `--max-chars` 无关），因此 `--via api` 拿到的是节选而非全文；需要长文时优先直连 HTTP。

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

`--cache` 会保存响应体与 `ETag` / `Last-Modified`，下次请求发条件头；`304` 时直接复用本地副本并在输出标记 `cached: true`。缓存按 URL + 凭据上下文（cookie / 自定义头 / UA / charset）分键，避免把登录态内容复用给另一个凭据；缓存文件是明文，敏感页面请自行控制目录权限。

目录解析：显式设置 `$WEB_CATCH_CACHE` 时只使用该目录（不可写就禁用缓存并通过输出提示，不会写到别处）；未设置时按 `$XDG_CACHE_HOME/web-catch` → `~/.cache/web-catch` → `%LOCALAPPDATA%\web-catch\cache` → 系统临时目录 → 可执行文件所在目录的 `.web-catch-cache` 取第一个可写目录（受限沙箱只允许写工作区/自身目录时会自动降级）。全部不可写时输出 `cache: <原因>`（JSON 为 `cacheNote`）。写入是原子替换（body 先落盘、元数据最后 rename，并记录 size 校验），命中时 JSON 额外给出 `cachedAt`；`fetchedAt` 始终是本次抓取/校验时间。

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 成功 |
| 1 | 网络 / HTTP 错误 |
| 2 | 提取失败（无可用正文、不支持的内容类型） |
| 3 | 参数或输出路径错误 |
| 4 | 上游 API 错误（鉴权、余额、限流等） |

## 作为库使用

```js
import { fetchPage } from 'web-catch';

const page = await fetchPage('https://example.com', { maxChars: 20_000, cache: true });
console.log(page.title, page.chars, page.markdown.slice(0, 200));
```

`fetchPage` 返回底层页面结果对象（含 `finalUrl`、`reason`、`stats` 等内部字段），`--json` 是它的稳定序列化投影（字段见上），两者不完全相同。

## MCP 模式

```sh
web-catch --mcp
```

以 stdio 暴露两个工具，任何支持 MCP 的宿主（DSH / Claude Code / Cursor 等）都能直接调用。抓取/输出相关参数与 CLI 对齐，agent 不必退回 shell：

`fetch`：

| 参数 | 说明 |
|---|---|
| `url` | 绝对 http(s) URL |
| `maxChars` | 正文输出上限，默认 `60000` |
| `linkLimit` | 链接清单条数上限，默认 `50`（1–1000） |
| `links` | 是否附带链接清单，默认 `true` |
| `linksOnly` | 只返回链接清单（跳过正文抽取，用于页面侦察；`json` 模式下带页面标题） |
| `outlineOnly` | 只返回标题大纲（`json` 模式下 `markdown` 同为大纲文本，另附 `outline[]`） |
| `json` | 返回与 CLI `--json` 同构的结构化对象 |
| `raw` | 跳过正文抽取，返回解码后的文本（仅 http） |
| `via` | `http`（默认）或 `api` |
| `apiLang` | 仅 `via: "api"`：只保留指定语言（`en`、`zh`、`auto` 等） |
| `unescape` | 仅 `via: "api"`：去掉渲染等价的上游标点转义（默认 `true`） |
| `cache` | 条件请求缓存（仅 http） |
| `noCache` | 跳过缓存读取，但仍刷新缓存（配合 `cache` 使用） |
| `timeout` | 请求超时秒数，默认 `15` |
| `retries` | 重试次数，默认 `2`，`0` 表示不重试 |
| `userAgent` | 覆盖 UA |
| `headers` | 额外请求头数组，元素形如 `"Name: value"` |
| `cookieFile` | Netscape cookie 文件路径（登录态页面） |
| `charset` | 强制源编码（如 `gbk`） |

`search`：`query`、`count`、`needContent`、`oriQuestion`、`localization`、`fetchTop`、`maxChars`、`json`、`timeout`、`retries`。`maxChars` 只作用于 `fetchTop` 抓取的每页，单页最多 20000 字符。

`linksOnly` / `outlineOnly` / `raw` 是三种互斥的输出模式，不能组合；`json` 可与它们中的任意一种组合（`json` 决定输出格式，模式决定取哪些字段）。MCP 参数是严格 schema（`additionalProperties: false`）：服务器会拒绝未知参数；但部分 MCP 客户端会在发送前丢弃未知字段，此时服务器收不到、调用仍会成功，这是客户端行为，不是服务端放宽。`apiLang: "auto"` 优先用标题语言；标题太短无法判断时改用正文中占多数的语言，仍无法判断则不过滤（避免误删）。

`headers` / `cookieFile` / `userAgent` / `charset` / `raw` / `cache` 只在 `via: "http"` 时生效（`api` 由 DeepSeek 服务端抓取）；`timeout` / `retries` 对两种传输都生效。`linksOnly` 走 `api` 会明确报错，因为链接必须从 HTML 里取；`raw` 与 `api` 传输不返回链接（`links: []`）。网络不稳时调 `timeout` / `retries`，登录态或反爬页面用 `cookieFile` / `headers`。

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

更新 MCP 服务的注意事项：宿主拉起的是 `web-catch.exe`，源码改动后必须重建，再让宿主重载该行（禁用→启用，或改动一个配置值）。运行中的 exe 会锁住文件，直接 `npm run build` 会报 `EPERM`，所以要先停用该行再构建。

## 架构

```text
bin/cli.mjs         进程入口：异常 → 退出码
lib/cli/            参数解析、帮助、命令分发
lib/commands/       fetch 与 search 的命令级编排（解析入参 → 调 page → 渲染）
lib/page.mjs        URL/HTML → 页面结果对象（网络 + 分派 + 抽取，无渲染）
lib/api-content.mjs Fetch API 内容归一化（语言过滤、安全去转义）
lib/mcp.mjs         MCP stdio 服务（复用 page / deepseek / serialize / render）
lib/net/            http（重试/超时/头/条件请求）、decode（编码探测）、deepseek（API 客户端）
lib/extract/        dom / article（Readability + Turndown GFM）/ links / pdf
lib/cache.mjs       条件请求缓存（可用目录自动降级）
lib/serialize.mjs   页面/搜索结果 → 稳定的 JSON 契约（CLI --json 与 MCP json 共用）
lib/render.mjs      Markdown / outline / links / search 渲染
lib/text.mjs        规范化、统计、大纲、截断
lib/constants.mjs   版本、默认值、退出码、内容类型
```

分层原则：`net` 与 `extract` 不感知 CLI，`page` 不感知渲染，`commands` 只做编排。新增能力（站点适配器、批量抓取、MCP 服务）在对应层追加即可。

## 已知边界

- 不执行 JavaScript，SPA 需要应用自身渲染（或 `--via api` 由服务端处理）
- 不自动绕过登录、验证码、付费墙；可用 `--cookie-file` / `--header` 携带凭据
- `--via api` 返回的是 DeepSeek Fetch API 的原始 `content`：上游可能返回多语言版本和 Markdown 转义。工具默认做两件事：去转义（只处理 `. , ; : ! ?`，跳过代码块/行内代码），以及可选的语言过滤（`--api-lang` / MCP `apiLang`，含 `auto`）；语言过滤只保留命中目标语言的段落，代码块和无语言段落会保留，过滤后为空则回退原文
- 搜索能力依赖外部 API（本工具不自建搜索引擎）

## 路线图

- 站点适配器（GitHub / 微信 / 知乎 / Reddit / Hacker News / arXiv）
- 批量抓取 `--batch urls.txt --concurrency N`
- 同一 URL 两次抓取的 `--diff`
- 搜索后端插件化（SearXNG / Brave）

## 许可

MIT

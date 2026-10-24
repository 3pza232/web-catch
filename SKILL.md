---
name: web-catch
description: web-catch 是命令行网页抓取/搜索工具（不是内置工具）。用户贴出 URL、需要网页正文、需要页面链接清单、需要抓 PDF，或需要"搜索并阅读前几条结果"时使用：先 `web-catch <url>` 取正文，或 `web-catch search "<query>" --fetch-top N` 一步完成搜索+阅读。
---

# web-catch

网页 → 干净 Markdown 的抓取/搜索工具，走 DeepSeek Search API。有 `mcp__webcatch__*` 工具时直接用（不需要 shell）；否则在 Bash/PowerShell 里执行 `web-catch`。

## 两种接入方式

**优先用 MCP 工具**（工具表里出现时）：

| MCP 工具 | 等价 CLI |
|---|---|
| `mcp__webcatch__fetch` `{url, outlineOnly?, linksOnly?, links?, maxChars?, linkLimit?, json?, raw?, via?, apiLang?, unescape?, cache?, noCache?, timeout?, retries?, userAgent?, headers?, cookieFile?, charset?}` | `web-catch <url> [--outline] [--links-only] [--no-links] [--max-chars N] [--link-limit N] [--json] [--raw] [--via api] [--api-lang L] [--no-unescape] [--cache] [--no-cache] [--timeout S] [--retries N] [--user-agent U] [--header "K: V"] [--cookie-file F] [--charset C]` |
| `mcp__webcatch__search` `{query, count?, needContent?, oriQuestion?, localization?, fetchTop?, maxChars?, json?, timeout?, retries?}` | `web-catch search "<query>" --count N [--need-content] [--ori-question Q] [--localization IP] [--fetch-top N] [--json]` |

`linksOnly` / `outlineOnly` / `raw` 是互斥的输出模式；`json` 可与任一模式组合（`json` 只是序列化方式，内容仍由模式决定：`outlineOnly + json` 的 `markdown` 是纯大纲标题，元数据看顶层字段）。MCP schema 是严格的（`additionalProperties: false`）：服务器会拒绝未知参数，但部分客户端会在发送前丢弃未知字段，此时调用仍会成功。`search.maxChars` 只作用于 `fetchTop`，单页最多 20000 字符。

没有 MCP 工具时，在 Bash/PowerShell 里执行下面的命令（要求 `web-catch` 在 PATH，或 `node D:\web-catch\bin\cli.mjs`）。

## 何时用

- 用户给出 URL，需要正文/细节
- 需要判断一个页面值不值得读（`--outline` / `outlineOnly`）
- 需要页面的出口链接、想继续深挖（`--links-only` / `linksOnly`，跳过正文抽取直接拿链接）
- 需要抓 PDF 或 JSON/XML（自动分派，`--raw` 兜底）
- 需要"先搜后读"，且已配置 `DEEPSEEK_API_KEY`
- 需要指定搜索地区：`localization` 传**合法 IP**（如 `202.106.0.20`），上游按 IP 粗略本地化；查询语言同样影响结果，代理出口只在未传 IP 时生效。可先用 ipinfo 校验 IP 归属，避免"北京 IP"其实是韩国段
- 网络抖动：用 `timeout` / `retries`；登录态或反爬页面：用 `cookieFile` / `headers`（`cookieFile`、`headers`、`cache`、`raw` 仅 http 传输）
- 走 `via:"api"` 且上游返回多语言/多余转义时：用 `apiLang`（如 `en`、`zh`、`auto`）只保留一种语言，工具会自动去掉无害的标点转义（代码块不动）
- 要给程序/AI 消费而不是人读：用 `json`（MCP）或 `--json`（CLI），字段一致

## 命令速查

```sh
web-catch <url>                       # 正文 + 链接清单
web-catch <url> --no-links            # 只要正文
web-catch <url> --outline             # 标题大纲（省 token 的侦察步骤）
web-catch <url> --links-only          # 只要链接
web-catch <url> --json                # 结构化结果
web-catch <url> --max-chars 20000     # 收紧输出上限（默认 60000）
web-catch <url> --via api             # 直连被拦时改走 DeepSeek Fetch API
web-catch <url> --via api --api-lang en  # api 通道只保留英文
web-catch <url> --cookie-file c.txt   # 需要登录态的页面
web-catch search "<query>" --count 5 --fetch-top 2
web-catch search '"exact phrase" site:news.ycombinator.com' --json
curl -s <url> | web-catch --url <url> # 已有 HTML 时走管道
```

## 输出怎么读

头部是元数据，正文从第一个空行之后开始：

```
url / title / fetched / transport / chars (words N) / status
truncated: true (limit 60000)   → 正文被截断，可加大 --max-chars 或分段抓
extracted: false（JSON 里的字段）→ Readability 没识别出正文，markdown 是整页文本
cached: true                    → 命中条件缓存
pages: N                        → PDF 页数
```

正文之后是 `## Page links (N)`，每条链接带 40 字上下文——用来决定下一步抓哪个子页面。
链接已去掉 `utm_*` 等跟踪参数并去重。

## 退出码

| 码 | 含义 | 处置 |
|---|---|---|
| 0 | 成功 | — |
| 1 | 网络 / HTTP 错误 | 换 `--timeout` / `--retries`，或核对 URL |
| 2 | 无可用正文 / 不支持的类型 | 试 `--raw`、`--via api`，或如实告诉用户 |
| 3 | 参数/输出路径错误 | 检查命令拼写或 `-o` 目标目录 |
| 4 | 上游 API 错误 | 401 缺 key、402 余额、429 限流；不要盲目重试 |

## 注意事项

- **不执行 JavaScript**：SPA 页面正文可能为空，`extracted: false` 时不要假装读到了内容；提示用户或改 `--via api`。
- **凭据**：在 DSH 等受管 shell 里不需要手动 `export`；CLI 会依次读环境变量 → `~/.web-catch/config.json` → Windows 用户环境变量（注册表）。仍报 401 时检查 key 是否有效、账户是否有余额。
- **搜索要花钱**：Search/Fetch 按成功请求计费（约 5 元 / 1000 次），别用它做无目的试探；`--json` 一次拿全，避免重复调用。
- **中文编码**已处理（GBK/GB2312 自动转 gb18030），不需要手工转码。
- **不要**用它抓需要人机验证、付费墙的页面来绕过限制；有正当凭据时用 `--cookie-file` / `--header`（MCP：`cookieFile` / `headers`）。
- 需要长期复用同一页面时加 `--cache`，避免重复计费与重复抓取。

---
name: web-catch
description: web-catch 是命令行网页抓取/搜索工具（不是内置工具）。用户贴出 URL、需要网页正文、需要页面链接清单、需要抓 PDF，或需要"搜索并阅读前几条结果"时使用：先 `web-catch <url>` 取正文，或 `web-catch search "<query>" --fetch-top N` 一步完成搜索+阅读。
---

# web-catch

网页 → 干净 Markdown 的 CLI，也能调 DeepSeek Search API 做搜索。**在 Bash/PowerShell 工具里执行，不要用内置 web_fetch 代替**它，除非只是想粗略看一眼页面。

## 何时用

- 用户给出 URL，需要正文/细节
- 需要判断一个页面值不值得读（`--outline`）
- 需要页面的出口链接、想继续深挖（`--links-only`）
- 需要抓 PDF 或 JSON/XML（自动分派，`--raw` 兜底）
- 需要"先搜后读"，且已配置 `DEEPSEEK_API_KEY`

## 命令速查

```sh
web-catch <url>                       # 正文 + 链接清单
web-catch <url> --no-links            # 只要正文
web-catch <url> --outline             # 标题大纲（省 token 的侦察步骤）
web-catch <url> --links-only          # 只要链接
web-catch <url> --json                # 结构化结果
web-catch <url> --max-chars 20000     # 收紧输出上限（默认 60000）
web-catch <url> --via api             # 直连被拦时改走 DeepSeek Fetch API
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
| 3 | 参数错误 | 检查命令拼写 |
| 4 | 上游 API 错误 | 401 缺 key、402 余额、429 限流；不要盲目重试 |

## 注意事项

- **不执行 JavaScript**：SPA 页面正文可能为空，`extracted: false` 时不要假装读到了内容；提示用户或改 `--via api`。
- **搜索要花钱**：Search/Fetch 按成功请求计费（约 5 元 / 1000 次），别用它做无目的试探；`--json` 一次拿全，避免重复调用。
- **中文编码**已处理（GBK/GB2312 自动转 gb18030），不需要手工转码。
- **不要**用它抓需要人机验证、付费墙的页面来绕过限制；有正当凭据时用 `--cookie-file` / `--header`。
- 需要长期复用同一页面时加 `--cache`，避免重复计费与重复抓取。

---
name: web-catch
description: 用户贴出URL，或问"XXX是什么/怎么做"等需要从网页获取信息的问题时触发。web-catch 将网页提取为干净 Markdown，自动去广告/导航，只留正文+链接。常与 WebSearch 配合使用：先搜后抓。
---

# web-catch — 网页内容提取

`web-catch <url>` 抓取网页，输出干净 Markdown 正文 + 链接清单。

## 基础用法

```
web-catch <url>                          # 抓取正文 + 链接
web-catch <url> --no-links               # 只要正文，不要链接
web-catch <url> --links-only             # 只要链接，不要正文（侦查用）
web-catch <url> --timeout 15             # 自定义超时（默认10s）
web-catch <url> --user-agent "xxx"       # 自定义 UA（默认 web-catch/0.1.0）
web-catch <url> --output file.md         # 写入文件
curl <url> | web-catch --url <url>       # 管道模式
```

## 输出格式

```
url: https://example.com
title: 页面标题
fetch_time: 2026-06-16 12:00:00 UTC
word_count: 2340

# 正文 Markdown...
---
## 页面链接 (14)
1. [链接标题](https://...)
   - 上下文: 周围的文字片段
```

## 触发场景

### A. 用户贴了 URL
直接 `web-catch <url>` 抓取。

### B. 用户问了一个需要查资料的问题（核心工作流）
**先用 WebSearch 搜到 URL，再用 web-catch 抓详情：**

```
用户: "Noita种太阳的流程是什么?"
  → WebSearch("Noita 种太阳 流程") 获取相关 URL
    → web-catch "https://noita.wiki.gg/zh/wiki/太阳" 抓取详细攻略
```

这样搜+读闭环，比只用其中任何一个都完整。

### C. 需要侦查页面结构（大页面/不确定价值时）
先用 `--links-only` 看看页面有哪些出口，再决定抓哪个子页面。

## 行为细节（源码发现）

- **JS 不执行** — 基于 `linkedom` 解析 DOM，SPA 页面正文为空时自动降级输出原始 body 文本
- **自动跟随重定向** — `redirect: follow`，finalUrl 是重定向后的地址
- **链接限 50 条** — 页面链接最多输出 50 条，超出截断
- **链接只从正文区域提取** — `<main>/<article>/[role=main]/.content/#content` 等
- **编码自动检测** — 支持 UTF-8/16/32 及 BOM 检测

## 常见失败处理

| 症状 | 原因 | 对策 |
|------|------|------|
| word_count=1，正文为空 | SPA / JS 渲染页 | 提示用户页面是 SPA，建议手动复制内容 |
| 正文有但明显残缺 | 需要登录/反爬 | 尝试 `--user-agent` 换 UA，或提示需要认证 |
| timeout | 网络慢或资源大 | `--timeout 15` 或更多 |
| HTTP 4xx/5xx | 链接失效或服务器拒绝 | 如实告诉用户状态码 |

## 注意事项

- SPA 页面（Vue/React 单页应用）无法正常提取 — 无法绕过
- word_count 对中文按空格分词，仅供参考
- 遇到明确说"不要抓取"的用户指示，尊重要求

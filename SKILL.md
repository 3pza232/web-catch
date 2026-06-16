---
name: web-catch
description: 用户贴出 URL、问"这个页面讲了什么"、"帮我看看这个链接"、"打开这个网址"、"提取这个页面"时触发。web-catch 是一个将网页提取为干净 Markdown 的 CLI 工具，专为 AI 阅读优化——自动去除广告/导航/脚本，只留正文 + 链接清单，最大程度降低 token 开销。
---

# web-catch — 网页内容提取工具

`web-catch <url>` 一键抓取网页，输出干净的 Markdown 正文 + 链接清单。

## 原理

```
<url> → HTTP 请求 → Readability (Firefox Reader View 同款算法) → Markdown → stdout
```

- 底层使用 `@mozilla/readability` 做正文提纯（Firefox 阅读模式同款）
- `turndown` 做 HTML→Markdown 转换
- 自动去除广告、导航栏、侧栏、页脚、脚本、样式
- 链接提取只从正文区域（`<main>/<article>/#content` 等）抓取

## 基础用法

```
web-catch <url>               输出干净的 Markdown 正文 + 链接清单
```

输出格式：
```
url: https://example.com
title: 页面标题
fetch_time: 2026-06-14 12:00:00 UTC
word_count: 2340
                              ← 空行分隔元信息与正文
# 正文 Markdown 内容...
---
## 页面链接 (14)
1. [链接标题](https://...)
   - 上下文: 周围的文字片段
2. ...
```

## 选项

| 选项 | 功能 |
|------|------|
| `--no-links` | 去掉末尾的链接清单 |
| `--links-only` | 只要链接清单，不要正文 |
| `--output <file>` | 写入文件（默认 stdout） |
| `--timeout <sec>` | 超时秒数（默认 10） |
| `--user-agent <str>` | 自定义 UA |
| `--help` | 查看帮助 |
| `--version` | 显示版本号 |

## 管道模式

```
curl <url> | web-catch --url <url>
```

从 stdin 读 HTML，`--url` 提供真实 URL（用于链接补全和元信息）。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 网络错误 / HTTP 错误 |
| 2 | 提取失败（无法解析正文） |
| 3 | 参数错误 |

## 使用原则

### 什么时候用 web-catch

- **用户贴了一个 URL**，问"这个页面讲了什么"、"帮我看看"、"提取这个" —— 直接 `web-catch <url>`
- **需要获取文档/API 参考 / 教程**等在线内容
- **需要抓取页面中的所有链接**进行后续分析

### 什么时候不用

- **网页需要登录** — `web-catch` 不处理认证
- **纯 JS 渲染 SPA** — 部分 SPA HTML 中无正文，提取可能为空
- **用户明确说不需要抓取** — 别擅自去抓

### 工作流建议

1. 先用 `web-catch <url>` 获取正文 Markdown
2. 根据需要，结合输出中的链接清单，对有价值的子页面继续调用 `web-catch`
3. 遇到 SPA 页面正文为空时，尝试 `web-catch <url> --links-only` 先获取链接，再逐个击破

### --links-only 适用场景

快速侦查页面结构，看看这个页面有哪些出口，再决定哪些链接值得深入。比全部抓取省大量 token。

## 举例

```
用户: 你帮我看看这个页面讲了什么
      https://docs.cocos.com/creator/3.8/manual/zh/advanced-topics/native-plugins/brief.html

→ 你: 运行 web-catch "https://docs.cocos.com/..." --timeout 15
     根据返回的 Markdown 内容向用户总结要点
```

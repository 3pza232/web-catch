#!/usr/bin/env node

import { fetchPage } from '../lib/fetch.mjs';
import { extractContent } from '../lib/extract.mjs';
import { extractLinks, formatLinks } from '../lib/links.mjs';
import { createReadabilityEnv } from '../lib/dom.mjs';

const HELP_TEXT = `web-catch <url>                             抓取网页并输出干净 Markdown

选项:
  --no-links            不在输出中包含链接清单
  --links-only          只输出链接清单，跳过正文
  --output <file>       写入文件（默认 stdout）
  --timeout <sec>       请求超时秒数（默认 10）
  --user-agent <str>    自定义 User-Agent
  --version             输出版本号
  --help                显示此帮助

管道模式:
  curl <url> | web-catch               从 stdin 读取 HTML（需指定 --url）
  web-catch --url <url>                从 stdin 读取 HTML，手动指定 URL 用于链接补全

退出码:
  0  成功
  1  网络错误 / HTTP 错误
  2  提取失败（无法解析正文）
  3  参数错误

示例:
  web-catch https://example.com
  web-catch https://example.com --no-links --output page.md
  web-catch https://example.com --links-only
  curl https://example.com | web-catch --url https://example.com
`;

function parseArgs(argv) {
  const args = { url: null, links: true, linksOnly: false, output: null, timeout: 10, userAgent: null, stdin: false };
  let i = 2;

  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
        console.log(HELP_TEXT);
        process.exit(0);
      case '--version':
        console.log('0.1.0');
        process.exit(0);
      case '--no-links':
        args.links = false;
        i++;
        break;
      case '--links-only':
        args.linksOnly = true;
        i++;
        break;
      case '--output':
        args.output = argv[i + 1];
        if (!args.output) {
          console.error('错误: --output 需要指定文件路径');
          process.exit(3);
        }
        i += 2;
        break;
      case '--timeout':
        args.timeout = parseInt(argv[i + 1], 10);
        if (isNaN(args.timeout) || args.timeout <= 0) {
          console.error('错误: --timeout 需要正数');
          process.exit(3);
        }
        i += 2;
        break;
      case '--user-agent':
        args.userAgent = argv[i + 1];
        if (!args.userAgent) {
          console.error('错误: --user-agent 需要指定值');
          process.exit(3);
        }
        i += 2;
        break;
      case '--url':
        args.url = argv[i + 1];
        args.stdin = true;
        if (!args.url) {
          console.error('错误: --url 需要指定 URL');
          process.exit(3);
        }
        i += 2;
        break;
      default:
        if (!arg.startsWith('--') && !args.url) {
          args.url = arg;
          i++;
        } else {
          console.error(`错误: 未知参数 "${arg}"`);
          process.exit(3);
        }
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.url && !args.stdin) {
    console.error('错误: 请指定 URL\n\n使用 --help 查看帮助');
    process.exit(3);
  }

  let html, finalUrl;

  if (args.stdin || !args.url) {
    const stdin = process.stdin;
    if (stdin.isTTY) {
      console.error('错误: 请指定 URL 或通过管道传入 HTML\n\n使用 --help 查看帮助');
      process.exit(3);
    }
    const chunks = [];
    for await (const chunk of stdin) {
      chunks.push(chunk);
    }
    html = Buffer.concat(chunks).toString('utf-8');
    finalUrl = args.url || 'https://unknown';
  } else {
    try {
      const result = await fetchPage(args.url, {
        timeout: args.timeout * 1000,
        userAgent: args.userAgent,
      });
      html = result.html;
      finalUrl = result.url;
    } catch (err) {
      if (err.name === 'FetchError') {
        console.error(`错误: ${err.message}`);
        if (err.body) console.error(`响应体: ${err.body.slice(0, 200)}`);
      } else {
        console.error(`错误: ${err.message}`);
      }
      process.exit(1);
    }
  }

  const extracted = extractContent(html, finalUrl);
  const { document } = createReadabilityEnv(html, finalUrl);

  const outputLines = [];

  outputLines.push(`url: ${finalUrl}`);
  outputLines.push(`title: ${extracted.title}`);
  outputLines.push(`fetch_time: ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`);
  outputLines.push(`word_count: ${extracted.wordCount}`);
  if (!extracted.success) {
    outputLines.push(`warning: 正文提取异常，使用降级输出`);
  }
  outputLines.push('');

  outputLines.push(extracted.markdown);

  if (args.links && !args.linksOnly) {
    const links = extractLinks(document, finalUrl);
    const formatted = formatLinks(links.slice(0, 50));
    if (formatted) outputLines.push(formatted);
  }

  if (args.linksOnly) {
    const links = extractLinks(document, finalUrl);
    console.log(formatLinks(links.slice(0, 50)));
    return;
  }

  const output = outputLines.join('\n');

  if (args.output) {
    const fs = await import('fs');
    fs.writeFileSync(args.output, output, 'utf-8');
  } else {
    console.log(output);
  }
}

main().catch(err => {
  console.error(`错误: ${err.message}`);
  process.exit(1);
});

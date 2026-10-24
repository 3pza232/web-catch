import { VERSION, DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, DEFAULT_SEARCH_COUNT } from '../constants.mjs';

export const HELP = `web-catch ${VERSION} — fetch web pages as clean Markdown, or search the web.

USAGE
  web-catch <url> [options]                 fetch one page
  web-catch fetch <url> [options]           same, explicit form
  web-catch search <query...> [options]     search, optional auto-fetch
  web-catch --help | --version

FETCH OPTIONS
  --max-chars <n>       cap on output characters (default ${DEFAULT_MAX_CHARS})
  --no-links            omit the link list
  --links-only          print only the link list
  --outline             print the heading outline only
  --raw                 skip article extraction, emit decoded text
  --json                machine-readable result object
  -o, --output <file>   write to a file instead of stdout
  --via http|api        transport: direct HTTP (default) or DeepSeek Fetch API
  --timeout <sec>       request timeout in seconds (default ${DEFAULT_TIMEOUT_MS / 1000})
  --retries <n>         retries for network and 408/429/5xx failures (default 2, 0 disables)
  --user-agent <str>    override the User-Agent
  --header "K: V"       extra request header, repeatable
  --cookie-file <file>  read cookies from a Netscape cookie file
  --charset <label>     force source charset (e.g. gbk, shift_jis)
  --cache               reuse a stored copy when the server reports it unchanged
  --no-cache            bypass the cache read (still refreshes it)

SEARCH OPTIONS
  --count <n>           results to request, 1-50 (default ${DEFAULT_SEARCH_COUNT})
  --need-content        include full page content in results
  --fetch-top <n>       also fetch and extract the top n results
  --json                emit the raw API payload
  --api-key <key>       DeepSeek API key (default: $DEEPSEEK_API_KEY)
  --api-base <url>      API base URL (default: https://api.deepseek.com)
  --timeout, --retries, -o, --output also apply here

QUERY SYNTAX (search)
  site:github.com   -site:example.com   -word   "exact phrase"
  lang:zh,en        after:2025-01-01     before:2026

MCP MODE
  --mcp                 serve fetch/search as an MCP stdio server
                        (point any harness at: web-catch --mcp)
  fetch                 url, maxChars, links, linksOnly, outlineOnly, json,
                        raw, via, cache, timeout, retries, userAgent,
                        headers, cookieFile, charset
  search                query, count, needContent, fetchTop, maxChars, json,
                        timeout, retries

EXIT CODES
  0 success   1 network/HTTP   2 extraction failed   3 usage   4 upstream API

EXAMPLES
  web-catch https://example.com
  web-catch https://example.com --outline
  web-catch https://example.com --links-only --json
  web-catch https://arxiv.org/abs/2401.00001 --via api
  web-catch search "deepseek v3.2 release" --count 5 --fetch-top 2
  web-catch search '"exact phrase" site:news.ycombinator.com'
  curl -s https://example.com | web-catch --url https://example.com
`;

# browsecli

> A browser-powered CLI for rendering and extracting web content.  
> Real Chromium under the hood. JavaScript executes. RSS auto-detected. Pipes beautifully.

```
node browse.js "https://news.ycombinator.com" -m links -t
```

---

## Why

Every other terminal web tool either skips JavaScript (`lynx`, `w3m`) or requires heavy setup. `browsecli` uses Playwright + Chromium to fully render pages — SPAs, lazy-loaded content, paywalled RSS feeds — then extracts what you actually need in a format you can use.

It also auto-detects RSS/Atom feeds and parses them properly, so sites like Google News that serve XML to non-browser clients just work.

---

## Install

```bash
# 1. Clone or copy browse.js + package.json into a folder
# 2. Install dependencies
npm install

# 3. Download Chromium (one-time, ~120MB)
npx playwright install chromium

# 4. npm install xml2js

# 5. Make executable
chmod +x browse.js

# 6. (Optional) link globally
npm link
```

---

## Usage

```
node browse.js <url> [options]
```

---

## Output Modes

| Flag | Mode | Description |
|------|------|-------------|
| *(default)* | `text` | Clean readable article text via Mozilla Readability — same engine Firefox uses |
| `-m markdown` | `markdown` | Article converted to Markdown |
| `-m links` | `links` | All links on the page with anchor text |
| `-m json` | `json` | Structured JSON: title, byline, excerpt, text, links[] |
| `-m html` | `html` | Full rendered HTML after JS execution |
| `-m feed` | `feed` | Force RSS/Atom parsing (auto-detected by default) |

---

## All Options

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--mode` | `-m` | `text` | Output mode (see above) |
| `--wait` | `-w` | `1500` | Extra ms to wait after page load (useful for SPAs) |
| `--width` | | `1280` | Viewport width in pixels |
| `--full` | | `false` | Skip Readability, extract full body |
| `--shot` | `-s` | | Save screenshot to file path |
| `--selector` | | | Extract a specific CSS selector |
| `--no-js` | | `false` | Disable JavaScript (faster, less accurate) |
| `--ua` | | | Override User-Agent string |
| `--headlines` | `-H` | `false` | Show titles only (feed mode) |
| `--text-only` | `-t` | `false` | Hide URLs, show anchor text only |
| `--verbose` | `-v` | `false` | Show browser console and page errors |

---

## Examples

```bash
# Read an article as clean text
node browse.js "https://news.ycombinator.com/" 

# Get headlines from Google News (auto-detects RSS)
node browse.js "https://news.google.com/rss/search?q=indian+stocks&hl=en-IN"

# Headlines only, no URLs
node browse.js "https://news.google.com/rss/search?q=indian+stocks" --headlines

# All links on a page, text only (no URLs)
node browse.js "https://manoramaonline.com" -m links -t

# Convert Wikipedia article to Markdown
node browse.js "https://en.wikipedia.org/wiki/Rust_(programming_language)" -m markdown

# Dump page as structured JSON, pipe to jq
node browse.js "https://news.ycombinator.com" -m json | jq '.links[].text'

# Extract a specific element by CSS selector
node browse.js "https://example.com" --selector "article.post"

# Screenshot + text in one shot
node browse.js "https://github.com" --shot github.png

# Wait longer for heavy React/Vue SPAs
node browse.js "https://some-spa-app.com" --wait 5000

# Disable JS for fast static pages
node browse.js "https://example.com" --no-js

# Pipe to less
node browse.js "https://news.ycombinator.com/"  | less

# Pipe Markdown to glow
node browse.js "https://en.wikipedia.org/wiki/Rust" -m markdown | glow -
```

---

## RSS / Atom Auto-detection

If a page serves XML (RSS or Atom), `browsecli` automatically switches to feed parsing mode — no flag needed. This is useful because sites like Google News serve clean RSS to non-browser clients.

```bash
# These all auto-detect as RSS:
node browse.js "https://news.google.com/rss/search?q=kerala"
node browse.js "https://hnrss.org/frontpage"
node browse.js "https://feeds.bbci.co.uk/news/rss.xml"
```

Feed output includes title, source, date, description, and link per item.


---

## License

MIT

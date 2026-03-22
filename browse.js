#!/usr/bin/env node

/**
 * browsecli — A browser-powered CLI for rendering & extracting web content
 * Uses Playwright (Chromium) for full JS rendering
 *
 * Options:
 *   --mode      text | markdown | json | html | links | feed  (default: text)
 *   --wait      ms to wait after page load              (default: 1500)
 *   --width     viewport width                          (default: 1280)
 *   --full      extract full page (not just article)
 *   --shot      save a screenshot to file
 *   --selector  CSS selector to extract specific element
 *   --no-js     disable JavaScript (fast mode)
 *   --ua        custom user agent string
 *   --verbose   show browser logs
 */

import { chromium } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import TurndownService from 'turndown';
import { XMLParser } from 'fast-xml-parser';
import chalk from 'chalk';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resolve } from 'path';

// Suppress JSDOM CSS/JS parse errors
const silentConsole = new VirtualConsole();
silentConsole.on('jsdomError', () => {});

// ── CLI ───────────────────────────────────────────────────────────────────────

const argv = yargs(hideBin(process.argv))
  .usage('$0 <url> [options]')
  .option('mode', {
    alias: 'm',
    default: 'text',
    describe: 'Output mode: text | markdown | json | html | links | feed',
    choices: ['text', 'markdown', 'json', 'html', 'links', 'feed'],
  })
  .option('wait', { alias: 'w', default: 1500, type: 'number' })
  .option('width', { default: 1280, type: 'number' })
  .option('full', { default: false, type: 'boolean' })
  .option('shot', { alias: 's', type: 'string' })
  .option('selector', { type: 'string' })
  .option('no-js', { type: 'boolean' })
  .option('ua', { type: 'string' })
  .option('verbose', { alias: 'v', default: false, type: 'boolean' })
  .option('headlines', { alias: 'H', default: false, type: 'boolean', describe: 'Only show titles (no descriptions/links)' })
  .option('text-only', { alias: 't', default: false, type: 'boolean', describe: 'Hide URLs, show anchor text only' })
  .demandCommand(1, chalk.red('✖  Please provide a URL'))
  .help()
  .argv;

const url = argv._[0];
const log = (...args) => process.stderr.write(args.join(' ') + '\n');

// ── RSS/Atom detector & parser ────────────────────────────────────────────────

function isRSS(html) {
  const t = html.trimStart();
  return t.startsWith('<?xml') || t.includes('<rss') || t.includes('<feed') || t.includes('<atom');
}

function parseRSS(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xml);

  // RSS 2.0
  if (doc.rss?.channel) {
    const ch = doc.rss.channel;
    const items = [].concat(ch.item || []);
    return {
      type: 'rss',
      title: ch.title || '',
      description: ch.description || '',
      link: ch.link || '',
      items: items.map(i => ({
        title:       stripCDATA(i.title || ''),
        link:        stripCDATA(i.link || i.guid?.['#text'] || i.guid || ''),
        source:      stripCDATA(i.source?.['#text'] || i.source || ''),
        pubDate:     i.pubDate || '',
        description: stripCDATA(i.description || '').replace(/<[^>]+>/g, '').trim(),
      })),
    };
  }

  // Atom / Google News feed
  if (doc.feed) {
    const feed = doc.feed;
    const entries = [].concat(feed.entry || []);
    return {
      type: 'atom',
      title: feed.title?.['#text'] || feed.title || '',
      items: entries.map(e => {
        const links = [].concat(e.link || []);
        const altLink = links.find(l => l['@_rel'] === 'alternate') || links[0] || {};
        return {
          title:       e.title?.['#text'] || e.title || '',
          link:        altLink['@_href'] || '',
          source:      e.source?.title?.['#text'] || e.source?.title || '',
          pubDate:     e.updated || e.published || '',
          description: stripCDATA(e.summary?.['#text'] || e.summary || '').replace(/<[^>]+>/g, '').trim(),
        };
      }),
    };
  }

  return null;
}

function stripCDATA(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function formatDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return d; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function printHeader(title, url, byline) {
  const width = process.stdout.columns || 100;
  const divider = chalk.dim('─'.repeat(width));
  log('');
  log(divider);
  log(chalk.bold.cyan('  ' + title));
  if (byline) log(chalk.dim('  by ' + byline));
  log(chalk.dim('  ' + url));
  log(divider);
  log('');
}

function extractLinks(html, baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl, virtualConsole: silentConsole });
  const anchors = [...dom.window.document.querySelectorAll('a[href]')];
  return anchors
    .map(a => ({ text: a.textContent.trim().replace(/\s+/g, ' '), href: a.href }))
    .filter(l => l.text && l.href && l.href.startsWith('http'))
    .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);
}

function parseArticle(html, url) {
  const dom = new JSDOM(html, { url, virtualConsole: silentConsole });
  const reader = new Readability(dom.window.document);
  return reader.parse();
}

function htmlToMarkdown(html) {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
  td.addRule('removeNav', {
    filter: ['nav', 'header', 'footer', 'aside', 'script', 'style'],
    replacement: () => '',
  });
  return td.turndown(html);
}

// ── RSS output renderers ──────────────────────────────────────────────────────

function renderFeedText(feed) {
  log('');
  log(chalk.bold.cyan(`  📰  ${feed.title}`));
  log(chalk.dim('─'.repeat(process.stdout.columns || 100)));
  log('');

  if (argv.headlines) {
    for (const [i, item] of feed.items.entries()) {
      process.stdout.write(`${chalk.dim(`${i + 1}.`)} ${item.title}${item.source ? chalk.dim(` — ${item.source}`) : ''}\n`);
    }
    log('');
    log(chalk.dim(`  ${feed.items.length} headlines`));
    return;
  }

  for (const [i, item] of feed.items.entries()) {
    process.stdout.write(chalk.bold(`${i + 1}. ${item.title}\n`));
    if (item.source) process.stdout.write(chalk.dim(`   ${item.source}`));
    if (item.pubDate) process.stdout.write(chalk.dim(`  ·  ${formatDate(item.pubDate)}\n`));
    else process.stdout.write('\n');
    if (item.description) process.stdout.write(chalk.gray(`   ${item.description}\n`));
    process.stdout.write(chalk.blue(`   ${item.link}\n`));
    process.stdout.write('\n');
  }
  log(chalk.dim(`  ${feed.items.length} items`));
}

function renderFeedMarkdown(feed) {
  process.stdout.write(`# ${feed.title}\n\n`);
  for (const item of feed.items) {
    process.stdout.write(`## ${item.title}\n`);
    if (item.source) process.stdout.write(`**${item.source}**`);
    if (item.pubDate) process.stdout.write(`  ·  *${formatDate(item.pubDate)}*`);
    process.stdout.write('\n\n');
    if (item.description) process.stdout.write(`${item.description}\n\n`);
    process.stdout.write(`[Read more](${item.link})\n\n---\n\n`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log(chalk.dim(`  ▸ Launching browser...`));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: argv.width, height: 900 },
    userAgent: argv.ua || undefined,
    javaScriptEnabled: argv['no-js'] !== true,
  });

  const page = await context.newPage();
  if (argv.verbose) {
    page.on('console', msg => log(chalk.dim(`  [console.${msg.type()}] ${msg.text()}`)));
  }

  log(chalk.dim(`  ▸ Loading: ${url}`));

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (argv.wait > 0) {
      log(chalk.dim(`  ▸ Waiting ${argv.wait}ms for JS to settle...`));
      await page.waitForTimeout(argv.wait);
    }

    if (argv.shot) {
      const shotPath = resolve(argv.shot);
      await page.screenshot({ path: shotPath, fullPage: true });
      log(chalk.green(`  ✔ Screenshot saved → ${shotPath}`));
    }

    const rawHtml = await page.content();
    const pageTitle = await page.title();
    const finalUrl = page.url();

    // ── AUTO-DETECT RSS / ATOM ────────────────────────────────────────────
    if (isRSS(rawHtml) || argv.mode === 'feed') {
      log(chalk.dim(`  ▸ RSS/Atom feed detected — parsing as feed...`));
      const feed = parseRSS(rawHtml);

      if (!feed) {
        log(chalk.red('  ✖  Could not parse feed structure'));
        await browser.close();
        process.exit(1);
      }

      log(chalk.green(`  ✔ ${feed.items.length} items found in "${feed.title}"`));

      if (argv.mode === 'json') {
        process.stdout.write(JSON.stringify(feed, null, 2) + '\n');
      } else if (argv.mode === 'markdown') {
        renderFeedMarkdown(feed);
      } else {
        // text (default) or feed
        renderFeedText(feed);
      }

      await browser.close();
      return;
    }

    log(chalk.dim(`  ▸ Processing "${pageTitle}"...`));

    // ── Selector mode ─────────────────────────────────────────────────────
    if (argv.selector) {
      const el = page.locator(argv.selector).first();
      const html = await el.innerHTML();
      const text = await el.innerText();
      if (argv.mode === 'html') process.stdout.write(html + '\n');
      else if (argv.mode === 'markdown') process.stdout.write(htmlToMarkdown(html) + '\n');
      else if (argv.mode === 'json') process.stdout.write(JSON.stringify({ selector: argv.selector, html, text }, null, 2) + '\n');
      else process.stdout.write(text + '\n');
      await browser.close();
      return;
    }

    // ── html mode ─────────────────────────────────────────────────────────
    if (argv.mode === 'html') {
      process.stdout.write(rawHtml + '\n');
      await browser.close();
      return;
    }

    // ── links mode ────────────────────────────────────────────────────────
    if (argv.mode === 'links') {
      const links = extractLinks(rawHtml, finalUrl);
      log('');
      for (const { text, href } of links) {
        process.stdout.write(`${chalk.cyan(text)}${argv['text-only'] ? '' : '  ' + href}\n`);
      }
      log('');
      log(chalk.dim(`  ${links.length} links found`));
      await browser.close();
      return;
    }

    // ── json mode ─────────────────────────────────────────────────────────
    if (argv.mode === 'json') {
      const article = argv.full ? null : parseArticle(rawHtml, finalUrl);
      const links = extractLinks(rawHtml, finalUrl);
      process.stdout.write(JSON.stringify({
        url: finalUrl,
        title: article?.title || pageTitle,
        byline: article?.byline || null,
        excerpt: article?.excerpt || null,
        text: article?.textContent?.trim() || null,
        html: article?.content || rawHtml,
        links: links.slice(0, 100),
        wordCount: article?.length || null,
      }, null, 2) + '\n');
      await browser.close();
      return;
    }

    // ── text / markdown modes ─────────────────────────────────────────────
    let contentHtml, title, byline;

    if (argv.full) {
      contentHtml = await page.$eval('body', el => el.innerHTML);
      title = pageTitle;
      byline = null;
    } else {
      const article = parseArticle(rawHtml, finalUrl);
      if (article) {
        contentHtml = article.content;
        title = article.title;
        byline = article.byline;
      } else {
        log(chalk.yellow('  ⚠  Readability fallback — using full body'));
        contentHtml = await page.$eval('body', el => el.innerHTML);
        title = pageTitle;
        byline = null;
      }
    }

    if (argv.mode === 'markdown') {
      printHeader(title, finalUrl, byline);
      process.stdout.write(htmlToMarkdown(contentHtml) + '\n');
    } else {
      const dom = new JSDOM(contentHtml, { virtualConsole: silentConsole });
      const text = dom.window.document.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
      printHeader(title, finalUrl, byline);
      process.stdout.write(text + '\n');
    }

    log('');
    log(chalk.dim('  Done.'));

  } catch (err) {
    log('');
    log(chalk.red(`  ✖  Error: ${err.message}`));
    if (argv.verbose) log(err.stack);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();

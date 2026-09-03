#!/usr/bin/env node
// Build a static reading site (docs/) from manuscript.md for GitHub Pages.
// Zero dependencies; shares the parser with build.mjs (EPUB).
//
// Usage: node build-site.mjs

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOK, esc, inline, mdToXhtml, splitChapters } from "./lib/book.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANUSCRIPT = join(HERE, "manuscript.md");
const OUT_DIR = join(HERE, "docs");
const CHAPTER_DIR = join(OUT_DIR, "chapters");

const CSS = `:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: -apple-system, "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", "Helvetica Neue", serif; line-height: 1.8; color: #222; background: #fff; margin: 0; }
.wrap { max-width: 780px; margin: 0 auto; padding: 0 20px 60px; }
header.site { background: #1a1a2e; color: #eee; padding: 14px 0; margin-bottom: 28px; }
header.site .inner { max-width: 780px; margin: 0 auto; padding: 0 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
header.site a { color: #9ad0ff; text-decoration: none; }
header.site .book-title { font-weight: 600; }
article h1 { font-size: 1.7em; border-bottom: 2px solid #ddd; padding-bottom: 0.35em; margin-top: 0.2em; }
h2 { font-size: 1.3em; margin-top: 1.5em; border-bottom: 1px solid #eee; padding-bottom: 0.2em; }
h3 { font-size: 1.08em; margin-top: 1.3em; }
p { margin: 0.7em 0; }
a { color: #0a5fd0; }
pre { background: #f6f8fa; border: 1px solid #e3e6ea; border-radius: 6px; padding: 12px 14px; font-size: 13px; line-height: 1.55; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
code { background: #f1f2f4; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.88em; }
pre code { background: none; padding: 0; font-size: inherit; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.93em; }
th, td { border: 1px solid #c9cdd3; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f2f4f7; }
ul, ol { margin: 0.6em 0; padding-left: 1.7em; }
li { margin: 0.3em 0; }
blockquote { border-left: 4px solid #cbd5e1; margin: 1em 0; padding: 0.15em 1.1em; color: #475569; background: #f8fafc; border-radius: 0 6px 6px 0; }
hr { border: none; border-top: 1px solid #e2e5ea; margin: 2.4em 0; }
nav.pager { display: flex; justify-content: space-between; margin-top: 3em; padding-top: 1.2em; border-top: 1px solid #e2e5ea; font-size: 0.95em; }
nav.pager a { text-decoration: none; color: #0a5fd0; }
nav.pager .empty { color: #aaa; }
/* cover / index */
.cover { text-align: center; padding: 9vh 0 4vh; }
.cover h1 { border: none; font-size: 2.1em; margin: 0 0 0.35em; }
.cover .subtitle { font-size: 1.15em; color: #475569; }
.cover .blurb { color: #64748b; max-width: 34em; margin: 1.6em auto; font-size: 0.95em; }
.cover .meta { color: #94a3b8; font-size: 0.9em; }
.toc { margin-top: 1.5em; }
.toc ol { list-style: none; padding: 0; }
.toc li { margin: 0.4em 0; }
.toc a { text-decoration: none; display: flex; gap: 12px; align-items: baseline; padding: 8px 12px; border-radius: 8px; }
.toc a:hover { background: #f1f5f9; }
.toc .no { color: #94a3b8; font-variant-numeric: tabular-nums; min-width: 2.2em; text-align: right; }
.downloads { margin-top: 3em; padding: 1.2em 1.4em; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.92em; color: #475569; }
footer.site { margin-top: 3em; padding-top: 1.2em; border-top: 1px solid #e2e5ea; color: #94a3b8; font-size: 0.85em; text-align: center; }
@media (prefers-color-scheme: dark) {
  :root { color-scheme: dark; }
  body { background: #0f1117; color: #d5d9e2; }
  header.site { background: #161a24; }
  pre { background: #161b26; border-color: #262c3a; }
  code { background: #1d2332; }
  table { border-color: #2c3344; } th, td { border-color: #2c3344; } th { background: #1d2332; }
  blockquote { background: #141927; border-color: #2c3a5e; color: #aab3c5; }
  a { color: #7ab7ff; } .toc a:hover { background: #1a2030; }
  footer.site, .cover .meta { color: #5b6472; } .cover .subtitle, .downloads { color: #aab3c5; }
  .downloads { background: #141927; border-color: #2a3346; } hr, nav.pager { border-color: #262c3a; }
  article h1 { border-color: #2c3344; } h2 { border-color: #262c3a; }
}
`;

const page = (title, contentHtml, cssHref) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}${title === BOOK.title ? "" : ` · ${esc(BOOK.title)}`}</title>
<meta name="description" content="${esc(BOOK.subtitle)}"/>
<link rel="stylesheet" href="${cssHref}"/>
</head>
<body>
<header class="site"><div class="inner">
  <span class="book-title"><a href="../index.html">${esc(BOOK.title)}</a></span>
  <span><a href="../index.html">目录</a></span>
</div></header>
<div class="wrap">
${contentHtml}
</div>
<footer class="site">${esc(BOOK.title)} · ${esc(BOOK.author)} · ${BOOK.date} · <a href="${BOOK.repo}">GitHub</a></footer>
</body>
</html>
`;

function indexPage(chapters) {
  const tocItems = chapters
    .map((ch, i) => {
      const n = String(i + 1).padStart(2, "0");
      const num = i === 0 ? "前言" : /^(第|附录|后记)/.test(ch.title) ? ch.title.match(/^[^\s：]+/)?.[0] ?? i + 1 : i + 1;
      return `<li><a href="chapters/ch-${n}.html"><span class="no">${esc(String(num))}</span><span>${esc(ch.title)}</span></a></li>`;
    })
    .join("\n");
  const body = `
<article class="cover">
  <h1>${esc(BOOK.title)}</h1>
  <p class="subtitle">${esc(BOOK.subtitle)}</p>
  <p class="blurb">——不依赖 LangChain、不依赖 Vercel AI SDK，只用 TypeScript、Node.js
  和原生 fetch，从第一行代码开始，理解并掌控 agent 的核心循环。<br/>
  从最小 agent loop，到可控自修改，再到能对话、会提问、不挂死的交互会话。</p>
  <p class="meta">${esc(BOOK.author)} · ${BOOK.date}</p>
  <nav class="toc"><ol>${tocItems}</ol></nav>
  <div class="downloads">
    📥 下载电子书：<a href="${BOOK.release}">GitHub Releases（mo-book.epub，可导入 Apple Books / Kindle）</a>
    ｜ 源码：<a href="${BOOK.repo}">abupeiyong/mo-book</a>
  </div>
</article>`;
  return page(BOOK.title, body, "style.css");
}

function chapterPages(chapters) {
  return chapters.map((ch, i) => {
    const n = String(i + 1).padStart(2, "0");
    const prev = i > 0 ? `<a href="ch-${String(i).padStart(2, "0")}.html">← ${esc(chapters[i - 1].title)}</a>` : `<span class="empty">← 目录</span>`;
    const next = i < chapters.length - 1 ? `<a href="ch-${String(i + 2).padStart(2, "0")}.html">${esc(chapters[i + 1].title)} →</a>` : `<a href="../index.html">回到目录</a>`;
    const body = `
<article>
<h1>${inline(ch.title)}</h1>
${mdToXhtml(ch.body)}
</article>
<nav class="pager">${prev}<span></span>${next}</nav>`;
    return { file: `ch-${n}.html`, html: page(ch.title, body, "../style.css") };
  });
}

function build() {
  const md = readFileSync(MANUSCRIPT, "utf8");
  const chapters = splitChapters(md);

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(CHAPTER_DIR, { recursive: true });

  writeFileSync(join(OUT_DIR, "style.css"), CSS, "utf8");
  writeFileSync(join(OUT_DIR, "index.html"), indexPage(chapters), "utf8");

  for (const { file, html } of chapterPages(chapters)) {
    writeFileSync(join(CHAPTER_DIR, file), html, "utf8");
  }

  console.log(`Built site in ${OUT_DIR}`);
  console.log(`  index + ${chapters.length} chapter pages`);
}

build();

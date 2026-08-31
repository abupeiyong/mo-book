#!/usr/bin/env node
// Build mo-book.epub from manuscript.md. Zero dependencies:
// - Markdown -> XHTML: this script (line-based, supports the subset used in the book)
// - EPUB container: the macOS /usr/bin/zip CLI (mimetype stored first, uncompressed)
//
// Usage: node build.mjs

import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANUSCRIPT = join(HERE, "manuscript.md");
const STAGE = join(HERE, "build", "epub");
const OUT = join(HERE, "build", "mo-book.epub");

const BOOK = {
  title: "从零搭建你自己的 Code Agent",
  subtitle: "Mo 开发实录：一个最小 AI 编程助手的两步诞生记",
  author: "peiyong",
  language: "zh-CN",
  date: "2026-08-31",
  id: `urn:uuid:${crypto.randomUUID()}`,
};

// ---------------------------------------------------------------- markdown

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Escape HTML, then apply bold and inline code (in that order).
function inline(text) {
  let out = esc(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

const cell = (c) => `<td>${inline(c.trim())}</td>`;
const headCell = (c) => `<th>${inline(c.trim())}</th>`;

const isSep = (r) => /^\s*\|?[\s:|-]+\|?\s*$/.test(r) && r.includes("-");

function tableBlock(rows) {
  const head = rows[0];
  const body = rows.slice(2); // row[1] is the --- separator
  const thead = `<tr>${head.split("|").filter((c) => c.trim() !== "").map(headCell).join("")}</tr>`;
  const tbody = body
    .map((r) => `<tr>${r.split("|").filter((c) => c.trim() !== "").map(cell).join("")}</tr>`)
    .join("");
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

// Convert one chapter's markdown body (without the h1) to XHTML.
function mdToXhtml(body) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (line.startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }

    // headings
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // table: header row, then a separator row
    if (line.includes("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      const rows = [line];
      i++;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i]);
        i++;
      }
      out.push(tableBlock(rows));
      continue;
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${mdToXhtml(buf.join("\n"))}</blockquote>`);
      continue;
    }

    // blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // paragraph: consume until blank line or another block start
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*---+\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isSep(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  return out.join("\n");
}

// ---------------------------------------------------------------- epub files

const chapterDoc = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${BOOK.language}">
<head>
<meta charset="UTF-8"/>
<title>${esc(BOOK.title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;

const coverDoc = () => chapterDoc(`
<div class="cover">
  <h1 class="cover-title">${esc(BOOK.title)}</h1>
  <p class="cover-subtitle">${esc(BOOK.subtitle)}</p>
  <p class="cover-rule">——不依赖 LangChain、不依赖 Vercel AI SDK，只用 TypeScript、Node.js
  和原生 fetch，从第一行代码开始，理解并掌控 agent 的核心循环。</p>
  <p class="cover-author">${esc(BOOK.author)} · ${BOOK.date}</p>
</div>
`);

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const CSS = `body { font-family: -apple-system, "PingFang SC", "Noto Sans CJK SC", "Hiragino Sans GB", serif; line-height: 1.75; margin: 1em; color: #222; }
h1 { font-size: 1.6em; border-bottom: 2px solid #ddd; padding-bottom: 0.3em; }
h2 { font-size: 1.3em; margin-top: 1.4em; }
h3 { font-size: 1.1em; margin-top: 1.2em; }
p { margin: 0.6em 0; }
pre { background: #f5f5f5; border: 1px solid #e0e0e0; padding: 0.6em; font-size: 0.82em; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
code { background: #f0f0f0; padding: 0.05em 0.3em; font-size: 0.9em; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
th, td { border: 1px solid #999; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
th { background: #f0f0f0; }
ul, ol { margin: 0.5em 0; padding-left: 1.6em; }
li { margin: 0.25em 0; }
blockquote { border-left: 3px solid #ccc; margin: 0.8em 0; padding: 0.2em 1em; color: #555; }
hr { border: none; border-top: 1px solid #ccc; margin: 2em 0; }
.cover { text-align: center; margin-top: 20%; }
.cover-title { border: none; font-size: 2em; }
.cover-subtitle { font-size: 1.2em; color: #444; margin-top: 1.5em; }
.cover-rule { color: #666; font-size: 0.95em; margin: 2em auto; max-width: 30em; }
.cover-author { color: #888; margin-top: 3em; }
`;

// ---------------------------------------------------------------- build

function build() {
  const md = readFileSync(MANUSCRIPT, "utf8");

  // Split into chapters by top-level "# " headings.
  const parts = md.split(/^#\s+(.+)$/m);
  // parts[0] = front matter, then alternating [title, body, title, body, ...]
  const chapters = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    chapters.push({ title: parts[i].trim(), body: parts[i + 1] });
  }
  // The very first "# " is the book title (front matter) — drop it.
  const realChapters = chapters.slice(1);

  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(join(STAGE, "META-INF"), { recursive: true });
  mkdirSync(join(STAGE, "OEBPS"), { recursive: true });

  writeFileSync(join(STAGE, "mimetype"), "application/epub+zip", "utf8");
  writeFileSync(join(STAGE, "META-INF", "container.xml"), CONTAINER, "utf8");
  writeFileSync(join(STAGE, "OEBPS", "style.css"), CSS, "utf8");
  writeFileSync(join(STAGE, "OEBPS", "cover.xhtml"), coverDoc(), "utf8");

  const xhtmls = [];
  const spine = ["cover"];
  const tocEntries = [];

  realChapters.forEach((ch, idx) => {
    const n = String(idx + 1).padStart(2, "0");
    const file = `chapter-${n}.xhtml`;
    writeFileSync(join(STAGE, "OEBPS", file), chapterDoc(`<h1>${inline(ch.title)}</h1>\n${mdToXhtml(ch.body)}`), "utf8");
    xhtmls.push({ file, title: ch.title });
    spine.push(file);
    tocEntries.push({ id: `ch-${n}`, file, title: ch.title });
  });

  // EPUB3 nav (optional, helps newer readers)
  const navItems = tocEntries
    .map((t) => `<li><a href="${t.file}">${esc(t.title)}</a></li>`)
    .join("\n");
  writeFileSync(
    join(STAGE, "OEBPS", "nav.xhtml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${BOOK.language}">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navItems}</ol></nav>
</body>
</html>
`,
    "utf8",
  );

  // EPUB2 OPF + NCX
  const manifest = [
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`,
    ...xhtmls.map((x, i) => `<item id="x${String(i + 1).padStart(2, "0")}" href="${x.file}" media-type="application/xhtml+xml"/>`),
  ].join("\n  ");
  const spineRefs = spine.map((f) => `<itemref idref="${f === "cover" ? "cover" : "x" + String(tocEntries.findIndex((t) => t.file === f) + 1).padStart(2, "0")}"/>`).join("\n  ");

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${esc(BOOK.title)}</dc:title>
    <dc:creator opf:role="aut">${esc(BOOK.author)}</dc:creator>
    <dc:language>${BOOK.language}</dc:language>
    <dc:identifier id="bookid">${BOOK.id}</dc:identifier>
    <dc:date>${BOOK.date}</dc:date>
    <dc:description>${esc(BOOK.subtitle)}</dc:description>
    <meta name="generator" content="mo-book build script"/>
  </metadata>
  <manifest>
  ${manifest}
  </manifest>
  <spine toc="ncx">
  ${spineRefs}
  </spine>
</package>
`;
  writeFileSync(join(STAGE, "OEBPS", "content.opf"), opf, "utf8");

  const navPoints = tocEntries
    .map((t, i) => `<navPoint id="${t.id}" playOrder="${i + 1}"><navLabel><text>${esc(t.title)}</text></navLabel><content src="${t.file}"/></navPoint>`)
    .join("\n  ");
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${BOOK.id}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${esc(BOOK.title)}</text></docTitle>
  <navMap>
  ${navPoints}
  </navMap>
</ncx>
`;
  writeFileSync(join(STAGE, "OEBPS", "toc.ncx"), ncx, "utf8");

  // Zip it. mimetype must be first and stored (no compression).
  execFileSync("zip", ["-X0", OUT, "mimetype"], { cwd: STAGE });
  execFileSync("zip", ["-Xr9D", OUT, "META-INF", "OEBPS"], { cwd: STAGE });

  console.log(`Built ${OUT}`);
  console.log(`  chapters: ${tocEntries.map((t) => t.title).join(" | ")}`);
}

build();

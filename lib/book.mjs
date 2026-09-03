// Shared book data + Markdown-to-XHTML conversion for the supported subset.
// Used by build.mjs (EPUB) and build-site.mjs (GitHub Pages site).
// Zero dependencies.

export const BOOK = {
  title: "从零搭建你自己的 Code Agent",
  subtitle: "Mo 开发实录：一个最小 AI 编程助手的三步诞生记",
  author: "peiyong",
  language: "zh-CN",
  date: "2026-09-03",
  repo: "https://github.com/abupeiyong/mo-book",
  release: "https://github.com/abupeiyong/mo-book/releases",
};

export const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Escape HTML, then apply bold and inline code (in that order).
export function inline(text) {
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
export function mdToXhtml(body) {
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

/**
 * Split a manuscript into book chapters.
 * Top-level "# " headings delimit chapters; the first one is the book title
 * (front matter) and is dropped. Returns [{ title, body }] for the real chapters.
 */
export function splitChapters(md) {
  const parts = md.split(/^#\s+(.+)$/m);
  const chapters = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    chapters.push({ title: parts[i].trim(), body: parts[i + 1] });
  }
  return chapters.slice(1); // drop the book-title front matter
}

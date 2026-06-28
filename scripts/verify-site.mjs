#!/usr/bin/env node
// 靜態站基本驗證：檔案存在性、JS 語法、GA4 標記、sitemap 一致性。
// 無外部相依，可直接於 CI 以 `node scripts/verify-site.mjs` 執行。

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GA4_ID = "G-KX606NGNKW";

const failures = [];
const notes = [];

function fail(msg) {
  failures.push(msg);
}
function ok(msg) {
  notes.push(msg);
}

function read(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

// 1) 核心檔案存在性
const CORE_FILES = [
  "index.html",
  "sitemap.xml",
  "robots.txt",
  "manifest.json",
  "js/app.js",
  "js/storage.js",
  "js/questions.js",
];
for (const f of CORE_FILES) {
  if (existsSync(path.join(ROOT, f))) {
    ok(`core file present: ${f}`);
  } else {
    fail(`missing core file: ${f}`);
  }
}

// 2) JS 語法檢查（js/ 與 scripts/ 下所有 .js）
function collectJs(dir) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
    .map((f) => path.join(dir, f));
}
const jsFiles = [...collectJs("js"), ...collectJs("scripts")];
for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ["--check", path.join(ROOT, f)], {
      stdio: "pipe",
    });
    ok(`js syntax ok: ${f}`);
  } catch (e) {
    fail(`js syntax error in ${f}: ${String(e.stderr || e.message).trim()}`);
  }
}

// 3) sitemap 一致性：每個 URL 都要對應到實際 HTML 檔（cleanUrls）
const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
  m[1].trim(),
);
if (locs.length === 0) {
  fail("sitemap.xml contains no <loc> entries");
} else {
  ok(`sitemap has ${locs.length} URLs`);
}
for (const loc of locs) {
  let pathname;
  try {
    pathname = new URL(loc).pathname;
  } catch {
    fail(`sitemap has malformed URL: ${loc}`);
    continue;
  }
  const slug = pathname.replace(/^\/+|\/+$/g, "");
  const file = slug === "" ? "index.html" : `${slug}.html`;
  if (!existsSync(path.join(ROOT, file))) {
    fail(`sitemap URL ${loc} -> missing file ${file}`);
  }
}

// 4) 反向檢查：所有頂層 HTML 檔（除排除清單）都應出現在 sitemap
const EXCLUDE_FROM_SITEMAP = new Set();
const topHtml = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const sitemapSlugs = new Set(
  locs
    .map((loc) => {
      try {
        return new URL(loc).pathname.replace(/^\/+|\/+$/g, "");
      } catch {
        return null;
      }
    })
    .filter((s) => s !== null),
);
for (const f of topHtml) {
  if (EXCLUDE_FROM_SITEMAP.has(f)) continue;
  const slug = f === "index.html" ? "" : f.replace(/\.html$/, "");
  if (!sitemapSlugs.has(slug)) {
    fail(`HTML file ${f} is not listed in sitemap.xml`);
  }
}

// 5) GA4 標記：每個頂層 HTML 頁都應載入 gtag 與正確的 measurement id
for (const f of topHtml) {
  const html = read(f);
  if (!html.includes("googletagmanager.com/gtag/js")) {
    fail(`${f} is missing the gtag.js loader`);
  } else if (!html.includes(GA4_ID)) {
    fail(`${f} is missing GA4 id ${GA4_ID}`);
  }
}
ok(`checked GA4 tagging on ${topHtml.length} HTML pages`);

// ---- 結果輸出 ----
console.log(`\n[verify-site] ${notes.length} checks passed`);
if (failures.length > 0) {
  console.error(`\n[verify-site] ${failures.length} FAILURES:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("[verify-site] all checks passed");

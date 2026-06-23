#!/usr/bin/env node
/*
 * generate-chapters.js — 由題庫歸納的章節重點頁生成器（可重跑）
 *
 * 用途：題庫（js/questions.js）更新後重跑本腳本，即可重新產出所有章節重點頁、
 * 更新 sitemap.xml，並在首頁與既有指南頁加入互連。
 *
 * 鐵律：
 *   - 內容定義集中於 scripts/chapter-content.js，所有事實歸納自真實題庫與法規。
 *   - 每頁 examples 引用的題目 ID 在建置時會比對 questions.js，若不存在則中止，
 *     確保引用的是真實題目而非編造。
 *
 * 用法：node scripts/generate-chapters.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { PAGES } = require('./chapter-content');

const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://iaqexam.org';
const TODAY = new Date().toISOString().slice(0, 10);

// ---- 載入並驗證題庫 ----
function loadQuestionsById() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'questions.js'), 'utf8');
  const obj = src.slice(src.indexOf('{'));
  // eslint-disable-next-line no-new-func
  const QUESTIONS = new Function('return ' + obj)();
  const byId = {};
  for (const cat of Object.keys(QUESTIONS)) {
    for (const q of QUESTIONS[cat]) byId[q.id] = q;
  }
  return byId;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 互連分組標籤
const NAV_LABEL = {
  pollutant: '污染物分項',
  core: '標準與分類',
  practice: '檢測與改善',
  law: '法規與管理'
};

// 站內既有指南頁（雙向互連目標）
const EXISTING_GUIDES = [
  { href: '/exam-guide', label: '備考指南' },
  { href: '/pollutants-guide', label: '污染物重點' },
  { href: '/regulations-guide', label: '法規查核' },
  { href: '/study-plan', label: '讀書計畫' }
];

function buildJsonLd(page) {
  const url = `${SITE}/${page.slug}`;
  const graph = [
    {
      '@type': 'Article',
      '@id': `${url}#article`,
      headline: page.h1,
      description: page.description,
      inLanguage: 'zh-TW',
      datePublished: page.datePublished || TODAY,
      dateModified: page.dateModified || TODAY,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      isPartOf: { '@id': `${SITE}/#website` },
      publisher: { '@id': `${SITE}/#organization` }
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url }
      ]
    }
  ];
  if (page.faq && page.faq.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: page.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    });
  }
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 4);
}

// 互連區塊：連到同類其他章節頁 + 既有指南頁（雙向）
function buildRelatedLinks(page, allPages) {
  const sameNav = allPages.filter((p) => p.nav === page.nav && p.slug !== page.slug);
  const otherNav = allPages.filter((p) => p.nav !== page.nav).slice(0, 4);
  const related = [...sameNav, ...otherNav].slice(0, 6);
  const chapterLinks = related
    .map((p) => `<a href="/${p.slug}">${escapeHtml(stripTitle(p.h1))}</a>`)
    .join('');
  const guideLinks = EXISTING_GUIDES.map(
    (g) => `<a href="${g.href}">${g.label}</a>`
  ).join('');
  return { chapterLinks, guideLinks };
}

function stripTitle(h1) {
  return h1.replace(/重點整理|重點$/g, '重點').replace(/（[^）]*）/g, (m) => m);
}

function renderPage(page, allPages) {
  const url = `${SITE}/${page.slug}`;
  const jsonLd = buildJsonLd(page);
  const sectionsHtml = page.sections
    .map(
      (s) =>
        `    <section class="info-card">\n        <h2>${escapeHtml(s.h2)}</h2>\n        ${s.html.trim()}\n    </section>`
    )
    .join('\n');

  // FAQ 區塊（呈現於頁面，與 JSON-LD 對應）
  let faqHtml = '';
  if (page.faq && page.faq.length) {
    const items = page.faq
      .map((f) => `        <li><strong>Q：${escapeHtml(f.q)}</strong><br>A：${escapeHtml(f.a)}</li>`)
      .join('\n');
    faqHtml = `    <section class="info-card">\n        <h2>常見問題</h2>\n        <ul>\n${items}\n        </ul>\n    </section>`;
  }

  const { chapterLinks, guideLinks } = buildRelatedLinks(page, allPages);
  const navLabel = NAV_LABEL[page.nav] || '相關章節';
  const relatedHtml = `    <section class="info-card">\n        <h2>延伸閱讀</h2>\n        <p>${navLabel}與其他章節重點：</p>\n        <p class="trust-links">${chapterLinks}</p>\n        <p>站內指南：</p>\n        <p class="trust-links">${guideLinks}</p>\n    </section>`;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(page.description)}">
    <meta name="robots" content="index, follow">
    <meta name="theme-color" content="#0071e3">
    <meta name="google-adsense-account" content="ca-pub-2306490072598524">
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-KX606NGNKW"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', 'G-KX606NGNKW');
    </script>
    <link rel="canonical" href="${url}">
    <link rel="stylesheet" href="/css/style.css">
    <title>${escapeHtml(page.title)}｜室內空品題庫備考系統</title>
    <script type="application/ld+json">
${jsonLd}
    </script>
</head>
<body>
<header class="header">
    <h1>${escapeHtml(page.h1)}</h1>
    <p><a href="/" style="color:rgba(255,255,255,.72);text-decoration:none;">返回首頁</a></p>
</header>
<main class="container info-page">
${sectionsHtml}
${faqHtml ? faqHtml + '\n' : ''}${relatedHtml}
</main>
</body>
</html>
`;
}

// ---- sitemap 更新：保留非章節 URL，重寫章節 URL ----
function updateSitemap(pages) {
  const sitemapPath = path.join(ROOT, 'sitemap.xml');
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  const slugs = new Set(pages.map((p) => p.slug));

  // 解析既有 <url> 區塊
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  const kept = blocks.filter((b) => {
    const loc = (b.match(/<loc>(.*?)<\/loc>/) || [])[1] || '';
    const slug = loc.replace(`${SITE}/`, '').replace(/\/$/, '');
    return !slugs.has(slug); // 移除既有章節頁區塊，稍後以最新 lastmod 重寫
  });

  const chapterBlocks = pages.map(
    (p) =>
      `  <url>\n    <loc>${SITE}/${p.slug}</loc>\n    <lastmod>${TODAY}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`
  );

  const all = [...kept.map((b) => '  ' + b.trim()), ...chapterBlocks].join('\n');
  const out = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${all}\n</urlset>\n`;
  fs.writeFileSync(sitemapPath, out);
  return kept.length + chapterBlocks.length;
}

// ---- 在指定 HTML 檔內注入/更新章節重點導覽區塊 ----
const NAV_START = '<!-- chapter-nav:start -->';
const NAV_END = '<!-- chapter-nav:end -->';

function buildChapterNavBlock(pages) {
  const groups = {};
  for (const p of pages) {
    (groups[p.nav] = groups[p.nav] || []).push(p);
  }
  const order = ['core', 'pollutant', 'practice', 'law'];
  let inner = '';
  for (const nav of order) {
    if (!groups[nav]) continue;
    const links = groups[nav]
      .map((p) => `<a href="/${p.slug}">${escapeHtml(stripTitle(p.h1))}</a>`)
      .join('');
    inner += `\n            <p class="trust-links">${links}</p>`;
  }
  return `${NAV_START}\n        <section class="info-card" aria-label="章節重點整理">\n            <h2>章節重點整理</h2>\n            <p>依主題歸納自題庫的重點頁，適合考前快速複習：</p>${inner}\n        </section>\n        ${NAV_END}`;
}

function injectIntoIndex(pages) {
  const indexPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  const block = buildChapterNavBlock(pages);

  if (html.includes(NAV_START)) {
    html = html.replace(new RegExp(`${NAV_START}[\\s\\S]*?${NAV_END}`), block);
  } else {
    // 插入於 footer 之前
    const anchor = '        <footer class="footer">';
    html = html.replace(anchor, `        ${block}\n\n${anchor}`);
  }
  fs.writeFileSync(indexPath, html);
}

// 在既有指南頁的 trust-links 末端補上「章節重點」總覽連結（雙向互連）
function injectIntoGuides(pages) {
  const hubLink = '<a href="/standards-table-guide">標準值速查</a>';
  const guideFiles = ['exam-guide.html', 'pollutants-guide.html', 'regulations-guide.html', 'study-plan.html'];
  for (const f of guideFiles) {
    const fp = path.join(ROOT, f);
    if (!fs.existsSync(fp)) continue;
    let html = fs.readFileSync(fp, 'utf8');
    if (html.includes('/standards-table-guide')) continue; // 已注入
    // 在第一個 trust-links 的結尾 </p> 前插入連結
    html = html.replace(
      /(<p class="trust-links">[\s\S]*?)(<\/p>)/,
      (m, a, b) => `${a}${hubLink}${b}`
    );
    fs.writeFileSync(fp, html);
  }
}

// ---- 主流程 ----
function main() {
  const byId = loadQuestionsById();

  // 驗證 examples 題目 ID 真實存在
  const missing = [];
  for (const page of PAGES) {
    for (const id of page.examples || []) {
      if (!byId[id]) missing.push(`${page.slug}: ${id}`);
    }
  }
  if (missing.length) {
    console.error('ERROR: 以下引用題目 ID 不存在於題庫，已中止生成：');
    console.error(missing.join('\n'));
    process.exit(1);
  }

  // 產生頁面
  for (const page of PAGES) {
    const html = renderPage(page, PAGES);
    fs.writeFileSync(path.join(ROOT, `${page.slug}.html`), html);
  }
  console.log(`已產生 ${PAGES.length} 個章節重點頁`);

  // sitemap
  const total = updateSitemap(PAGES);
  console.log(`已更新 sitemap.xml，共 ${total} 筆 URL`);

  // 互連
  injectIntoIndex(PAGES);
  injectIntoGuides(PAGES);
  console.log('已更新首頁與既有指南頁互連');
}

main();

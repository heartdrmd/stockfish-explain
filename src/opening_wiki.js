// opening_wiki.js — Wikibooks "Chess Opening Theory" pane.
//
// Queries en.wikibooks.org for the Chess_Opening_Theory/<move-path>
// page that matches the current mainline and surfaces the textual
// description. Same approach as lichess-org/lila's ui/analyse/src/
// wiki.ts + ui/lib/src/wikiBooks.ts — AGPL-compatible reuse.

const BASE = 'https://en.wikibooks.org';
const API_ARGS = 'redirects&origin=*&action=query&prop=extracts&formatversion=2&format=json&stable=1';
const CACHE = new Map();

// Move-path prefix: "1._e4/1...e5/2._Nf3/..."
function plyPrefix(plyIdx, san) {
  // plyIdx is 0-based in our array but 1-based in lila's TreeNode.ply.
  // Equivalent formula: Math.floor((ply+1)/2) + ply%2===1 ? "._" : "..."
  const ply = plyIdx + 1;
  return `${Math.floor((ply + 1) / 2)}${ply % 2 === 1 ? '._' : '...'}${san}`;
}

function moveHistoryToPath(sanArr) {
  return sanArr
    .map((s, i) => plyPrefix(i, s))
    .join('/')
    .replace(/[+!#?]/g, '');
}

// Text-stripping pipeline ported from lila's transformWikiHtml.
function transform(html, title) {
  let h = html;
  h = h.replace('When contributing to this Wikibook, please follow the Conventions for organization.', '');
  h = h.replace(/<h2 data-mw-anchor="External_links">External links<\/h2>.*?(?=<h[1-6]|$)/gs, '');
  h = h.replace(/<h3 data-mw-anchor="All_possible_replies">All possible replies<\/h3>.*?(?=<h[1-6]|$)/gs, '');
  h = h.replace(/<h2 data-mw-anchor="All_possible_Black's_moves".*?<\/h2>.*?(?=<h[1-6]|$)/gs, '');
  h = h.replace(/<h2 data-mw-anchor="Theory_table">Theory table<\/h2>.*?(?=<h[1-6]|$)/gs, '');
  h = h.replace(/<p>(<br \/>|\s)*<\/p>/g, '');
  h = h.replace(/<h1.+<\/h1>/g, '');
  h += `<p><a target="_blank" rel="noopener" href="${BASE}/wiki/${title}">Read more on WikiBooks →</a></p>`;
  return h;
}

export async function fetchWiki(sanArr) {
  if (!sanArr || !sanArr.length) return '';
  if (sanArr.length > 30) return '';
  const path = moveHistoryToPath(sanArr);
  if (!path || path.length > 234) return '';
  if (CACHE.has(path)) return CACHE.get(path);

  // Quick miss-cache: if a PREFIX of the path already returned empty,
  // everything beyond it is also empty (lila trick).
  for (let i = sanArr.length - 1; i >= 1; i--) {
    const sub = moveHistoryToPath(sanArr.slice(0, i));
    if (CACHE.has(sub) && CACHE.get(sub) === '') {
      CACHE.set(path, '');
      return '';
    }
  }

  const title = `Chess_Opening_Theory/${path}`;
  try {
    const url = `${BASE}/w/api.php?titles=${encodeURIComponent(title)}&${API_ARGS}`;
    const res = await fetch(url);
    if (!res.ok) { CACHE.set(path, ''); return ''; }
    const json = await res.json();
    const page = json.query?.pages?.[0];
    if (!page || page.missing || !page.extract || page.extract.length === 0) {
      CACHE.set(path, '');
      return '';
    }
    const html = transform(page.extract, title);
    CACHE.set(path, html);
    return html;
  } catch (err) {
    console.warn('[wiki] fetch failed', err);
    return '';
  }
}

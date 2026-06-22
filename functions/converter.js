const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');

const MAX_SIZE = 5 * 1024 * 1024;
const TIMEOUT_MS = 30000;
const MIN_CONTENT_LENGTH = 500;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="132"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

function createTurndown() {
  return new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    bulletListMarker: '-',
    linkStyle: 'inlined'
  });
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      maxRedirections: 5
    });

    if (res.status === 403 || res.status === 401) {
      throw new Error('Site access denied. The site may block automated access or require login.');
    }
    if (res.status === 404) {
      throw new Error('Page not found. The URL may be incorrect or the page has been removed.');
    }
    if (!res.ok) {
      throw new Error(`Site returned HTTP ${res.status}. The page may be restricted or unavailable.`);
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.includes('html') && !ct.includes('xhtml') && !ct.includes('text/plain')) {
      throw new Error(`Not an HTML page (Content-Type: ${ct}). Only web pages are supported, not files or downloads.`);
    }

    const html = await res.text();
    if (Buffer.byteLength(html) > MAX_SIZE) {
      throw new Error(`Content too large (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_SIZE / 1024 / 1024}MB.`);
    }

    return { html, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

function convertFullPage(html, baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  ['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer'].forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => el.remove());
  });

  const title = doc.title || 'Untitled';
  const turndown = createTurndown();

  const bodyMD = turndown.turndown(doc.body);

  return { markdown: `# ${title}\n\n${bodyMD}`, title };
}

function convertArticle(html, baseUrl) {
  const dom = new JSDOM(html, { url: baseUrl });
  const doc = dom.window.document;

  const reader = new Readability(doc);
  const article = reader.parse();

  if (!article) {
    const bodyText = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    if (bodyText.length < MIN_CONTENT_LENGTH) {
      throw new Error('Page has almost no readable text. The site likely requires JavaScript to load content (SPA). Try a different page that loads its content in plain HTML.');
    }
    throw new Error('Could not extract article from this page. Try "Full Page" mode instead, or the site may require JavaScript.');
  }

  const turndown = createTurndown();
  const bodyMD = turndown.turndown(article.content);
  const title = article.title || doc.title || 'Untitled';

  let markdown = `# ${title}\n\n`;
  if (article.byline) markdown += `*By ${article.byline}*\n\n`;
  markdown += bodyMD;

  return { markdown, title };
}

async function convert(url, mode = 'article') {
  let normalised = url.trim();
  if (!/^https?:\/\//i.test(normalised)) {
    normalised = 'https://' + normalised;
  }

  let html, finalUrl;
  try {
    ({ html, finalUrl } = await fetchPage(normalised));
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out after 30 seconds. The target site is too slow or blocking the request.');
    }
    if (err.cause?.code === 'ENOTFOUND' || err.cause?.code === 'EAI_AGAIN') {
      throw new Error('Could not reach this website. Check the URL or the site may be down.');
    }
    throw err;
  }

  const rawText = new JSDOM(html).window.document.body?.textContent || '';
  const wordCount = rawText.replace(/\s+/g, ' ').trim().split(/\s+/).filter(w => w.length > 0).length;
  const isSpa = wordCount < 50;

  if (mode === 'article') {
    try {
      const result = convertArticle(html, finalUrl);
      if (result.markdown.length < MIN_CONTENT_LENGTH) {
        throw new Error('Extracted content is too short. The page may be mostly JavaScript.');
      }
      return { ...result, url: finalUrl, mode: 'article' };
    } catch (err) {
      if (err.message.includes('Try "Full Page" mode') || err.message.includes('too short') || isSpa) {
        mode = 'full';
      } else {
        throw err;
      }
    }
  }

  const result = convertFullPage(html, finalUrl);
  const note = isSpa ? '\n\n> **Note:** This page appears to be a JavaScript app (SPA). The content may be incomplete because web2md cannot run JavaScript. For best results, use pages that load their content as plain HTML.\n' : '';
  return { ...result, markdown: result.markdown + note, url: finalUrl, mode: 'full' };
}

module.exports = { convert };

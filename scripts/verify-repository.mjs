import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesOrigin = 'https://noctilumedev.github.io/InkNarratives';
const pagesBasePath = '/InkNarratives/';
const works = [
  {
    slug: 'darkroom',
    htmlPath: 'works/darkroom/index.html',
    previewPath: 'assets/previews/darkroom.jpg',
    legacyPath: '暗室.html',
  },
  {
    slug: 'liuyong',
    htmlPath: 'works/liuyong/index.html',
    previewPath: 'assets/previews/liuyong.jpg',
    legacyPath: '柳永.html',
  },
  {
    slug: 'sushi',
    htmlPath: 'works/sushi/index.html',
    previewPath: 'assets/previews/sushi.jpg',
    legacyPath: '苏轼.html',
  },
  {
    slug: 'wangwei',
    htmlPath: 'works/wangwei/index.html',
    previewPath: 'assets/previews/wangwei.jpg',
    legacyPath: '王维.html',
  },
  {
    slug: 'night-voyage',
    htmlPath: 'works/night-voyage/index.html',
    previewPath: 'assets/previews/night-voyage.jpg',
    legacyPath: '长卷.html',
  },
].map((work) => ({
  ...work,
  stableHref: `./works/${work.slug}/`,
  canonical: `${pagesOrigin}/works/${work.slug}/`,
}));

const requiredFiles = [
  'index.html',
  '404.html',
  '.nojekyll',
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  'LICENSE',
  'assets/gallery.css',
  'assets/favicon.svg',
  'docs/quality-baseline.md',
  'docs/editorial-structure.md',
  'docs/content-revision-policy.md',
  'docs/content-revisions.json',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/bounded_proposal.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  '.github/workflows/repository-gates.yml',
  '.github/workflows/pages.yml',
  ...works.flatMap((work) => [work.htmlPath, work.previewPath, work.legacyPath]),
];

const failures = [];
const fail = (message) => failures.push(message);
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'],
    ['apos', "'"],
    ['gt', '>'],
    ['lt', '<'],
    ['nbsp', ' '],
    ['quot', '"'],
  ]);

  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key[0] === '#') {
      const hexadecimal = key[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isNaN(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return entity;
        }
      }
    }
    return named.get(key.toLowerCase()) ?? entity;
  });
}

function markupForVerification(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

function scanTags(html) {
  const tags = [];

  for (let start = 0; start < html.length; start += 1) {
    if (html[start] !== '<') continue;
    const closing = html[start + 1] === '/';
    const nameStart = start + (closing ? 2 : 1);
    if (!/[a-z]/i.test(html[nameStart] ?? '')) continue;

    let cursor = nameStart + 1;
    while (/[a-z0-9:-]/i.test(html[cursor] ?? '')) cursor += 1;
    if (!/[\s/>]/.test(html[cursor] ?? '')) continue;
    const name = html.slice(nameStart, cursor).toLowerCase();

    let quote = null;
    let end = -1;
    for (let index = cursor; index < html.length; index += 1) {
      const character = html[index];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        end = index;
        break;
      }
    }

    if (end < 0) break;
    const tag = html.slice(start, end + 1);
    tags.push({
      start,
      end,
      name,
      closing,
      selfClosing: !closing && /\/\s*>$/.test(tag),
      openingTag: closing ? null : tag,
    });
    start = end;
  }

  return tags;
}

function openingTags(html, name) {
  const normalizedName = name.toLowerCase();
  return scanTags(html).filter((tag) => !tag.closing && tag.name === normalizedName);
}

function elements(html, name) {
  const normalizedName = name.toLowerCase();
  const stack = [];
  const results = [];

  for (const tag of scanTags(html)) {
    if (tag.name !== normalizedName) continue;
    if (!tag.closing) {
      if (!tag.selfClosing) stack.push(tag);
      continue;
    }

    const opening = stack.pop();
    if (!opening) continue;
    results.push({
      ...opening,
      innerHtml: html.slice(opening.end + 1, tag.start),
      fullHtml: html.slice(opening.start, tag.end + 1),
      end: tag.end,
    });
  }

  return results.sort((left, right) => left.start - right.start);
}

function stripTagsToSpaces(markup) {
  let text = '';
  let cursor = 0;
  for (const tag of scanTags(markup)) {
    text += markup.slice(cursor, tag.start);
    text += ' ';
    cursor = tag.end + 1;
  }
  return text + markup.slice(cursor);
}

function readableText(fragment) {
  return decodeEntities(
    stripTagsToSpaces(markupForVerification(fragment)),
  ).replace(/\s+/g, ' ').trim();
}

function readableRevisionText(html, relativePath) {
  const markup = markupForVerification(html);
  const main = elements(markup, 'main')[0];
  if (!main) {
    fail(`${relativePath}: missing main landmark`);
    return '';
  }

  const additionalScopes = elements(markup, 'article')
    .filter((element) => hasAttribute(element.openingTag, 'data-content-revision-scope'));
  return readableText([main.innerHtml, ...additionalScopes.map((element) => element.innerHtml)].join('\n'));
}

function revisionTextFingerprint(html, relativePath) {
  return crypto.createHash('sha256').update(readableRevisionText(html, relativePath), 'utf8').digest('hex');
}

function parseAttributes(openingTag) {
  const values = new Map();
  const duplicates = new Set();
  let malformed = false;
  let index = 1;

  while (index < openingTag.length && !/[\s/>]/.test(openingTag[index])) index += 1;

  while (index < openingTag.length) {
    while (/\s/.test(openingTag[index] ?? '')) index += 1;
    if (openingTag[index] === '>' || (openingTag[index] === '/' && openingTag[index + 1] === '>')) break;

    const nameStart = index;
    while (index < openingTag.length && !/[\s=/>]/.test(openingTag[index])) index += 1;
    if (nameStart === index) {
      malformed = true;
      break;
    }
    const attributeName = openingTag.slice(nameStart, index).toLowerCase();
    while (/\s/.test(openingTag[index] ?? '')) index += 1;

    let value = null;
    if (openingTag[index] === '=') {
      index += 1;
      while (/\s/.test(openingTag[index] ?? '')) index += 1;
      const quote = openingTag[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < openingTag.length && openingTag[index] !== quote) index += 1;
        if (index >= openingTag.length) {
          malformed = true;
          break;
        }
        value = openingTag.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < openingTag.length && !/[\s>]/.test(openingTag[index])) index += 1;
        value = openingTag.slice(valueStart, index);
      }
    }

    if (values.has(attributeName)) duplicates.add(attributeName);
    else values.set(attributeName, value);
  }

  return { values, duplicates, malformed };
}

function attribute(tag, name) {
  const parsed = parseAttributes(tag);
  const normalizedName = name.toLowerCase();
  if (parsed.malformed || parsed.duplicates.has(normalizedName)) return null;
  return parsed.values.get(normalizedName) ?? null;
}

function hasAttribute(tag, name) {
  const parsed = parseAttributes(tag);
  const normalizedName = name.toLowerCase();
  return !parsed.malformed && !parsed.duplicates.has(normalizedName) && parsed.values.has(normalizedName);
}

function validateRemoteRuntimeReferences(html, relativePath) {
  const remoteRuntimeReferences = [];

  for (const match of html.matchAll(/<(script|img|audio|video|source|iframe)\b[^>]*>/gi)) {
    const source = attribute(match[0], 'src');
    if (source && /^https?:\/\//i.test(source)) remoteRuntimeReferences.push(source);
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = attribute(match[0], 'href');
    const rel = attribute(match[0], 'rel')?.toLowerCase() ?? '';
    if (href && /^https?:\/\//i.test(href) && !rel.split(/\s+/).includes('canonical')) {
      remoteRuntimeReferences.push(href);
    }
  }

  if (remoteRuntimeReferences.length > 0) {
    fail(`${relativePath}: remote runtime dependencies are not allowed: ${remoteRuntimeReferences.join(', ')}`);
  }

  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    if (/url\(\s*["']?https?:\/\//i.test(match[1]) || /@import\s+(?:url\()?\s*["']https?:\/\//i.test(match[1])) {
      fail(`${relativePath}: inline style must not load remote runtime resources`);
    }
  }

  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1];
    const dynamicRemoteLoad = /(?:fetch|import)\s*\(\s*["']https?:\/\//i.test(script)
      || /new\s+(?:SharedWorker|WebSocket|Worker)\s*\(\s*["']https?:\/\//i.test(script)
      || /sendBeacon\s*\(\s*["']https?:\/\//i.test(script)
      || /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["']https?:\/\//i.test(script);
    if (dynamicRemoteLoad) fail(`${relativePath}: inline script must not load remote runtime resources`);
  }
}

function validateLocalReferences(html, relativePath) {
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = decodeEntities(match[1]).trim();
    if (/^(?:#|data:|mailto:|tel:|https?:\/\/)/i.test(reference)) continue;
    if (/^javascript:/i.test(reference)) {
      fail(`${relativePath}: javascript URLs are not allowed: ${reference}`);
      continue;
    }

    let decodedReference;
    try {
      decodedReference = decodeURIComponent(reference.split(/[?#]/, 1)[0]);
    } catch {
      fail(`${relativePath}: malformed local reference: ${reference}`);
      continue;
    }
    if (!decodedReference) continue;

    const resolved = decodedReference.startsWith(pagesBasePath)
      ? path.resolve(root, decodedReference.slice(pagesBasePath.length))
      : path.resolve(path.dirname(path.join(root, relativePath)), decodedReference);
    const relativeToRoot = path.relative(root, resolved);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      fail(`${relativePath}: local reference escapes repository: ${reference}`);
      continue;
    }

    const targetExists = fs.existsSync(resolved)
      && (fs.statSync(resolved).isFile() || fs.existsSync(path.join(resolved, 'index.html')));
    if (!targetExists) fail(`${relativePath}: broken local reference: ${reference}`);
  }
}

function validateHtmlDocument(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) return;
  const html = read(relativePath);

  if (!/^\s*<!doctype html>/i.test(html)) fail(`${relativePath}: missing HTML doctype`);
  if (!/<html\b[^>]*\blang=["']zh-CN["']/i.test(html)) fail(`${relativePath}: html lang must be zh-CN`);
  if (!/<meta\b[^>]*\bcharset=["']?utf-8/i.test(html)) fail(`${relativePath}: missing UTF-8 charset`);
  if (!/<meta\b[^>]*\bname=["']viewport["']/i.test(html)) fail(`${relativePath}: missing viewport metadata`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${relativePath}: missing non-empty title`);
  if (!/<main\b/i.test(html)) fail(`${relativePath}: missing main landmark`);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    fail(`${relativePath}: duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  if (/\son[a-z]+\s*=/i.test(html)) fail(`${relativePath}: inline event handlers are not allowed`);
  if (/<p\b[^>]*\baria-label=/i.test(html)) fail(`${relativePath}: aria-label is not valid on an untyped paragraph`);

  const headingLevels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  for (let index = 1; index < headingLevels.length; index += 1) {
    if (headingLevels[index] > headingLevels[index - 1] + 1) {
      fail(`${relativePath}: heading level jumps from h${headingLevels[index - 1]} to h${headingLevels[index]}`);
      break;
    }
  }

  validateRemoteRuntimeReferences(html, relativePath);
  validateLocalReferences(html, relativePath);
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required file: ${relativePath}`);
}

for (const relativePath of [
  'index.html',
  '404.html',
  ...works.map((work) => work.htmlPath),
  ...works.map((work) => work.legacyPath),
]) {
  validateHtmlDocument(relativePath);
}

for (const stylesheet of ['assets/gallery.css']) {
  if (!fs.existsSync(path.join(root, stylesheet))) continue;
  const css = read(stylesheet);
  if (/url\(\s*["']?https?:\/\//i.test(css) || /@import\s+(?:url\()?\s*["']https?:\/\//i.test(css)) {
    fail(`${stylesheet}: remote runtime dependencies are not allowed`);
  }
}

let revisionManifest = null;
const revisionManifestPath = 'docs/content-revisions.json';
if (fs.existsSync(path.join(root, revisionManifestPath))) {
  try {
    revisionManifest = JSON.parse(read(revisionManifestPath));
  } catch (error) {
    fail(`${revisionManifestPath}: invalid JSON (${error.message})`);
  }
}

if (revisionManifest) {
  if (revisionManifest.version !== 1) fail(`${revisionManifestPath}: version must be 1`);
  if (revisionManifest.normalization !== 'revision-readable-text-v2') {
    fail(`${revisionManifestPath}: unsupported normalization contract`);
  }
  if (!Array.isArray(revisionManifest.works) || revisionManifest.works.length !== works.length) {
    fail(`${revisionManifestPath}: must contain exactly ${works.length} works`);
  } else {
    const manifestSlugs = revisionManifest.works.map((entry) => entry.slug);
    if (new Set(manifestSlugs).size !== manifestSlugs.length) {
      fail(`${revisionManifestPath}: duplicate work slugs`);
    }

    const gallery = fs.existsSync(path.join(root, 'index.html')) ? read('index.html') : '';
    const galleryMarkup = markupForVerification(gallery);
    const galleryArticles = elements(galleryMarkup, 'article')
      .filter((element) => attribute(element.openingTag, 'data-work'));
    for (const work of works) {
      const entry = revisionManifest.works.find((candidate) => candidate.slug === work.slug);
      if (!entry) {
        fail(`${revisionManifestPath}: missing work ${work.slug}`);
        continue;
      }
      if (entry.path !== work.htmlPath) fail(`${revisionManifestPath}: ${work.slug} path must be ${work.htmlPath}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.contentRevised ?? '')) {
        fail(`${revisionManifestPath}: ${work.slug} contentRevised must use YYYY-MM-DD`);
      }
      if (!Number.isInteger(entry.declaredRevisionMarkers) || entry.declaredRevisionMarkers < 0) {
        fail(`${revisionManifestPath}: ${work.slug} declaredRevisionMarkers must be a non-negative integer`);
      }

      if (!fs.existsSync(path.join(root, work.htmlPath))) continue;
      const html = read(work.htmlPath);
      const markup = markupForVerification(html);
      const revisedMetaTags = openingTags(markup, 'meta')
        .map((element) => element.openingTag)
        .filter((tag) => attribute(tag, 'name')?.toLowerCase() === 'content-revised');
      const revisedMeta = revisedMetaTags[0] ? attribute(revisedMetaTags[0], 'content') : null;
      if (revisedMetaTags.length !== 1 || revisedMeta !== entry.contentRevised) {
        fail(`${work.htmlPath}: content-revised metadata must match manifest (${entry.contentRevised})`);
      }
      const canonicalLinks = openingTags(markup, 'link')
        .map((element) => element.openingTag)
        .filter((tag) => attribute(tag, 'rel')?.toLowerCase().split(/\s+/).includes('canonical'));
      if (canonicalLinks.length !== 1 || attribute(canonicalLinks[0] ?? '', 'href') !== work.canonical) {
        fail(`${work.htmlPath}: canonical URL must be ${work.canonical}`);
      }

      const declaredRevisions = elements(markup, 'time')
        .filter((element) => hasAttribute(element.openingTag, 'data-content-revised'));
      if (declaredRevisions.length !== entry.declaredRevisionMarkers) {
        fail(`${work.htmlPath}: expected ${entry.declaredRevisionMarkers} declared content revision marker(s), found ${declaredRevisions.length}`);
      }
      for (const declaredRevision of declaredRevisions) {
        const declaredDateText = readableText(declaredRevision.innerHtml);
        const machineDate = attribute(declaredRevision.openingTag, 'datetime');
        if (machineDate !== entry.contentRevised || declaredDateText !== entry.contentRevised) {
          fail(`${work.htmlPath}: declared content revision date must match manifest (${entry.contentRevised})`);
        }
      }

      const actualHash = revisionTextFingerprint(html, work.htmlPath);
      if (entry.textSha256 !== actualHash) {
        fail(`${work.htmlPath}: readable revision scope changed; review whether literary content changed, update its manifest fingerprint to ${actualHash}, and advance contentRevised only when it did`);
      }

      const article = galleryArticles.find((candidate) => attribute(candidate.openingTag, 'data-work') === work.slug)?.fullHtml;
      if (!article) {
        fail(`index.html: missing gallery article for ${work.slug}`);
      } else {
        const workLinks = openingTags(article, 'a')
          .map((element) => element.openingTag)
          .filter((tag) => attribute(tag, 'data-work-link') === work.slug);
        if (workLinks.length !== 1 || attribute(workLinks[0] ?? '', 'href') !== work.stableHref) {
          fail(`index.html: ${work.slug} must link to ${work.stableHref}`);
        }
        const galleryRevisions = elements(article, 'time');
        const galleryRevision = galleryRevisions[0];
        const expectedVisibleDate = entry.contentRevised.replace(/-/g, '.');
        if (
          galleryRevisions.length !== 1
          || attribute(galleryRevision?.openingTag ?? '', 'datetime') !== entry.contentRevised
          || readableText(galleryRevision?.innerHtml ?? '') !== expectedVisibleDate
        ) {
          fail(`index.html: ${work.slug} revision date must display ${expectedVisibleDate} with datetime ${entry.contentRevised}`);
        }
      }

      if (fs.existsSync(path.join(root, work.legacyPath))) {
        const legacy = read(work.legacyPath);
        const escapedHref = work.stableHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`<meta\\b[^>]*http-equiv=["']refresh["'][^>]*content=["']0;\\s*url=${escapedHref}["']`, 'i').test(legacy)) {
          fail(`${work.legacyPath}: legacy entry must immediately redirect to ${work.stableHref}`);
        }
        if (!legacy.includes(`<link rel="canonical" href="${work.canonical}"`)) {
          fail(`${work.legacyPath}: canonical URL must be ${work.canonical}`);
        }
        if (!legacy.includes(`href="${work.stableHref}"`)) {
          fail(`${work.legacyPath}: missing fallback link to ${work.stableHref}`);
        }
        if (!legacy.includes(`window.location.replace('${work.stableHref}')`)) {
          fail(`${work.legacyPath}: missing history-safe redirect fallback to ${work.stableHref}`);
        }
      }
    }

    const galleryWorkCount = galleryArticles.length;
    if (galleryWorkCount !== works.length) fail(`index.html: expected ${works.length} gallery works, found ${galleryWorkCount}`);
  }
}

if (failures.length > 0) {
  console.error('Repository verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Repository verification passed: gallery + ${works.length} standalone HTML demos.`);

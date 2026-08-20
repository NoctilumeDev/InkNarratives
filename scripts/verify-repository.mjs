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
  'SECURITY.md',
  'LICENSE',
  'assets/gallery.css',
  'assets/favicon.svg',
  'docs/quality-baseline.md',
  'docs/editorial-structure.md',
  'docs/content-revision-policy.md',
  'docs/content-revisions.json',
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

function readableMainText(html, relativePath) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (!main) {
    fail(`${relativePath}: missing main landmark`);
    return '';
  }

  return decodeEntities(
    main[1]
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/\s*(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\s*>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function mainTextFingerprint(html, relativePath) {
  return crypto.createHash('sha256').update(readableMainText(html, relativePath), 'utf8').digest('hex');
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
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
  if (revisionManifest.normalization !== 'main-readable-text-v1') {
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

      if (!fs.existsSync(path.join(root, work.htmlPath))) continue;
      const html = read(work.htmlPath);
      const revisedMeta = html.match(/<meta\b[^>]*\bname=["']content-revised["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i)?.[1];
      if (revisedMeta !== entry.contentRevised) {
        fail(`${work.htmlPath}: content-revised metadata must match manifest (${entry.contentRevised})`);
      }
      if (!html.includes(`<link rel="canonical" href="${work.canonical}"`)) {
        fail(`${work.htmlPath}: canonical URL must be ${work.canonical}`);
      }

      const actualHash = mainTextFingerprint(html, work.htmlPath);
      if (entry.textSha256 !== actualHash) {
        fail(`${work.htmlPath}: readable <main> text changed; update its revision date and manifest fingerprint to ${actualHash}`);
      }

      const article = gallery.match(new RegExp(`<article\\b[^>]*data-work=["']${work.slug}["'][^>]*>[\\s\\S]*?<\\/article>`, 'i'))?.[0];
      if (!article) {
        fail(`index.html: missing gallery article for ${work.slug}`);
      } else {
        if (!article.includes(`data-work-link="${work.slug}"`) || !article.includes(`href="${work.stableHref}"`)) {
          fail(`index.html: ${work.slug} must link to ${work.stableHref}`);
        }
        if (!article.includes(`<time datetime="${entry.contentRevised}">`)) {
          fail(`index.html: ${work.slug} revision date must match manifest (${entry.contentRevised})`);
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

    const galleryWorkCount = [...gallery.matchAll(/<article\b[^>]*\bdata-work=["'][^"']+["']/gi)].length;
    if (galleryWorkCount !== works.length) fail(`index.html: expected ${works.length} gallery works, found ${galleryWorkCount}`);
  }
}

if (failures.length > 0) {
  console.error('Repository verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Repository verification passed: gallery + ${works.length} standalone HTML demos.`);

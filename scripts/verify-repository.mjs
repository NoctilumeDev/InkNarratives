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

const rawTextElementNames = new Set(['script', 'style', 'title', 'textarea']);
const revisionExcludedElementNames = new Set(['script', 'style', 'template', 'svg']);

function findTagEnd(html, start) {
  let quote = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

// This is a scanner for the repository's controlled static-HTML subset, not a
// general HTML5 parser. It deliberately understands the boundaries that matter
// to the gate: comments, quoted attributes, tags, and raw-text elements.
function scanMarkup(html) {
  const tags = [];
  const comments = [];
  const errors = [];
  const lowerHtml = html.toLowerCase();
  let index = 0;

  while (index < html.length) {
    if (html.startsWith('<!--', index)) {
      const commentEnd = html.indexOf('-->', index + 4);
      if (commentEnd < 0) {
        comments.push({ start: index, end: html.length - 1 });
        errors.push(`unterminated comment at offset ${index}`);
        break;
      }
      comments.push({ start: index, end: commentEnd + 2 });
      index = commentEnd + 3;
      continue;
    }

    if (html[index] !== '<') {
      index += 1;
      continue;
    }

    if (html[index + 1] === '!' || html[index + 1] === '?') {
      const declarationEnd = findTagEnd(html, index + 2);
      if (declarationEnd < 0) {
        errors.push(`unterminated declaration at offset ${index}`);
        break;
      }
      index = declarationEnd + 1;
      continue;
    }

    const closing = html[index + 1] === '/';
    const nameStart = index + (closing ? 2 : 1);
    if (!/[a-z]/i.test(html[nameStart] ?? '')) {
      index += 1;
      continue;
    }

    let cursor = nameStart + 1;
    while (/[a-z0-9:-]/i.test(html[cursor] ?? '')) cursor += 1;
    if (!/[\s/>]/.test(html[cursor] ?? '')) {
      index += 1;
      continue;
    }
    const name = html.slice(nameStart, cursor).toLowerCase();
    const end = findTagEnd(html, cursor);
    if (end < 0) {
      errors.push(`unterminated <${closing ? '/' : ''}${name}> tag at offset ${index}`);
      break;
    }

    const source = html.slice(index, end + 1);
    const tag = {
      start: index,
      end,
      name,
      closing,
      selfClosing: !closing && /\/\s*>$/.test(source),
      openingTag: closing ? null : source,
    };
    tags.push(tag);
    index = end + 1;

    if (!closing && !tag.selfClosing && rawTextElementNames.has(name)) {
      const closingPrefix = `</${name}`;
      let closingStart = -1;
      let closingEnd = -1;
      let searchFrom = index;
      while (searchFrom < html.length) {
        const candidate = lowerHtml.indexOf(closingPrefix, searchFrom);
        if (candidate < 0) break;
        const delimiter = html[candidate + closingPrefix.length] ?? '';
        if (!/[\s>]/.test(delimiter)) {
          searchFrom = candidate + closingPrefix.length;
          continue;
        }
        const candidateEnd = findTagEnd(html, candidate + closingPrefix.length);
        if (candidateEnd < 0) {
          errors.push(`unterminated </${name}> tag at offset ${candidate}`);
          searchFrom = html.length;
          break;
        }
        closingStart = candidate;
        closingEnd = candidateEnd;
        break;
      }

      if (closingStart < 0) {
        errors.push(`missing </${name}> tag for element at offset ${tag.start}`);
        break;
      }
      tags.push({
        start: closingStart,
        end: closingEnd,
        name,
        closing: true,
        selfClosing: false,
        openingTag: null,
      });
      index = closingEnd + 1;
    }
  }

  return { tags, comments, errors };
}

function scanTags(html) {
  return scanMarkup(html).tags;
}

function elementRanges(tags, names) {
  const stacks = new Map([...names].map((name) => [name, []]));
  const ranges = [];
  for (const tag of tags) {
    if (!names.has(tag.name)) continue;
    const stack = stacks.get(tag.name);
    if (!tag.closing) {
      if (!tag.selfClosing) stack.push(tag);
      continue;
    }
    const opening = stack.pop();
    if (opening) ranges.push({ start: opening.start, end: tag.end });
  }
  return ranges;
}

function maskRanges(html, ranges) {
  if (ranges.length === 0) return html;
  const merged = [];
  for (const range of [...ranges].sort((left, right) => left.start - right.start || right.end - left.end)) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }

  let result = '';
  let cursor = 0;
  for (const range of merged) {
    result += html.slice(cursor, range.start);
    result += ' '.repeat(range.end - range.start + 1);
    cursor = range.end + 1;
  }
  return result + html.slice(cursor);
}

function markupForVerification(html) {
  const scan = scanMarkup(html);
  return maskRanges(html, [
    ...scan.comments,
    ...elementRanges(scan.tags, revisionExcludedElementNames),
  ]);
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
        if (value.length === 0) malformed = true;
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

function remoteRuntimeFindings(html) {
  const remoteRuntimeReferences = [];
  const findings = [];
  const remoteUrl = (value) => /^(?:https?:)?\/\//i.test(decodeEntities(value ?? '').trim());
  const remoteCss = (value) => /url\(\s*["']?(?:https?:)?\/\//i.test(decodeEntities(value ?? ''))
    || /@import\s+(?:url\()?\s*["'](?:https?:)?\/\//i.test(decodeEntities(value ?? ''));
  const runtimeSourceAttributes = new Map([
    ['audio', ['src']],
    ['embed', ['src']],
    ['iframe', ['src']],
    ['img', ['src', 'srcset']],
    ['input', ['src']],
    ['object', ['data']],
    ['script', ['src']],
    ['source', ['src', 'srcset']],
    ['video', ['src', 'poster']],
  ]);

  for (const tag of scanTags(html).filter((candidate) => !candidate.closing)) {
    for (const name of runtimeSourceAttributes.get(tag.name) ?? []) {
      const value = attribute(tag.openingTag, name);
      if (value && (remoteUrl(value) || (name === 'srcset' && /(?:https?:)?\/\//i.test(decodeEntities(value))))) {
        remoteRuntimeReferences.push(`${tag.name}[${name}]=${value}`);
      }
    }

    if (tag.name === 'link') {
      const href = attribute(tag.openingTag, 'href');
      const relTokens = (attribute(tag.openingTag, 'rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const canonicalOnly = relTokens.length === 1 && relTokens[0] === 'canonical';
      if (href && remoteUrl(href) && !canonicalOnly) remoteRuntimeReferences.push(`link[href]=${href}`);
    }

    const inlineStyle = attribute(tag.openingTag, 'style');
    if (inlineStyle && remoteCss(inlineStyle)) {
      remoteRuntimeReferences.push(`${tag.name}[style]`);
    }
  }

  if (remoteRuntimeReferences.length > 0) {
    findings.push(`remote runtime dependencies are not allowed: ${remoteRuntimeReferences.join(', ')}`);
  }

  for (const style of elements(html, 'style')) {
    if (remoteCss(style.innerHtml)) {
      findings.push('inline style must not load remote runtime resources');
    }
  }

  for (const scriptElement of elements(html, 'script')) {
    const script = scriptElement.innerHtml;
    const dynamicRemoteLoad = /(?:fetch|import)\s*\(\s*["'](?:https?:)?\/\//i.test(script)
      || /new\s+(?:EventSource|SharedWorker|WebSocket|Worker)\s*\(\s*["'](?:https?:)?\/\//i.test(script)
      || /sendBeacon\s*\(\s*["'](?:https?:)?\/\//i.test(script)
      || /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["'](?:https?:)?\/\//i.test(script);
    if (dynamicRemoteLoad) findings.push('inline script must not load remote runtime resources');
  }

  return findings;
}

function validateRemoteRuntimeReferences(html, relativePath) {
  for (const finding of remoteRuntimeFindings(html)) fail(`${relativePath}: ${finding}`);
}

function validateLocalReferences(html, relativePath) {
  for (const tag of scanTags(html).filter((candidate) => !candidate.closing)) {
    for (const name of ['src', 'href']) {
      const rawReference = attribute(tag.openingTag, name);
      if (!rawReference) continue;
      const reference = decodeEntities(rawReference).trim();
      if (/^(?:#|data:|mailto:|tel:|(?:https?:)?\/\/)/i.test(reference)) continue;
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
}

function validateHtmlDocument(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) return;
  const html = read(relativePath);
  const scan = scanMarkup(html);
  const opening = scan.tags.filter((tag) => !tag.closing);
  const semanticMarkup = markupForVerification(html);
  const semanticTags = scanTags(semanticMarkup);

  for (const error of scan.errors) fail(`${relativePath}: ${error}`);
  for (const tag of opening) {
    const parsed = parseAttributes(tag.openingTag);
    if (parsed.malformed) fail(`${relativePath}: malformed attributes in <${tag.name}> at offset ${tag.start}`);
    if (parsed.duplicates.size > 0) {
      fail(`${relativePath}: duplicate attribute(s) in <${tag.name}>: ${[...parsed.duplicates].join(', ')}`);
    }
  }

  if (!/^\s*<!doctype html>/i.test(html)) fail(`${relativePath}: missing HTML doctype`);
  const htmlTags = semanticTags.filter((tag) => !tag.closing && tag.name === 'html');
  if (htmlTags.length !== 1 || attribute(htmlTags[0].openingTag, 'lang') !== 'zh-CN') {
    fail(`${relativePath}: html lang must be zh-CN`);
  }
  const metaTags = semanticTags.filter((tag) => !tag.closing && tag.name === 'meta');
  if (!metaTags.some((tag) => attribute(tag.openingTag, 'charset')?.toLowerCase() === 'utf-8')) {
    fail(`${relativePath}: missing UTF-8 charset`);
  }
  if (!metaTags.some((tag) => attribute(tag.openingTag, 'name')?.toLowerCase() === 'viewport')) {
    fail(`${relativePath}: missing viewport metadata`);
  }
  const titleElements = elements(semanticMarkup, 'title');
  if (titleElements.length !== 1 || readableText(titleElements[0].innerHtml).length === 0) {
    fail(`${relativePath}: missing non-empty title`);
  }
  if (!semanticTags.some((tag) => !tag.closing && tag.name === 'main')) {
    fail(`${relativePath}: missing main landmark`);
  }

  const ids = opening.map((tag) => attribute(tag.openingTag, 'id')).filter(Boolean);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    fail(`${relativePath}: duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  if (opening.some((tag) => [...parseAttributes(tag.openingTag).values.keys()].some((name) => /^on[a-z]+$/.test(name)))) {
    fail(`${relativePath}: inline event handlers are not allowed`);
  }
  if (opening.some((tag) => tag.name === 'p' && hasAttribute(tag.openingTag, 'aria-label'))) {
    fail(`${relativePath}: aria-label is not valid on an untyped paragraph`);
  }

  const headingLevels = semanticTags
    .filter((tag) => !tag.closing && /^h[1-6]$/.test(tag.name))
    .map((tag) => Number(tag.name[1]));
  for (let index = 1; index < headingLevels.length; index += 1) {
    if (headingLevels[index] > headingLevels[index - 1] + 1) {
      fail(`${relativePath}: heading level jumps from h${headingLevels[index - 1]} to h${headingLevels[index]}`);
      break;
    }
  }

  validateRemoteRuntimeReferences(html, relativePath);
  validateLocalReferences(html, relativePath);
}

function validateScannerContract() {
  for (const name of revisionExcludedElementNames) {
    const quotedMarkers = `<main><div data-open="<${name}>">VISIBLE QUOTED MARKER<span data-close="</${name}>"></span></div></main>`;
    const quotedMain = elements(markupForVerification(quotedMarkers), 'main')[0];
    if (!quotedMain || readableText(quotedMain.innerHtml) !== 'VISIBLE QUOTED MARKER') {
      fail(`verifier internal contract: quoted ${name}-like attribute values must not hide visible text`);
    }

    const actualExcluded = `<main>BEFORE<${name}>HIDDEN</${name}>AFTER</main>`;
    const excludedMain = elements(markupForVerification(actualExcluded), 'main')[0];
    if (!excludedMain || readableText(excludedMain.innerHtml) !== 'BEFORE AFTER') {
      fail(`verifier internal contract: actual ${name} content must remain outside revision text`);
    }
  }

  const commentMarkers = '<!-- <main id=decoy></main> --><main id=real>REAL</main>';
  const actualMains = elements(markupForVerification(commentMarkers), 'main');
  if (actualMains.length !== 1 || attribute(actualMains[0].openingTag, 'id') !== 'real') {
    fail('verifier internal contract: commented tags must not satisfy document structure');
  }

  const quotedDelimiter = '<img alt="quoted > delimiter" src="https://example.invalid/runtime.png">';
  const parsedImage = openingTags(quotedDelimiter, 'img')[0];
  if (!parsedImage || attribute(parsedImage.openingTag, 'src') !== 'https://example.invalid/runtime.png') {
    fail('verifier internal contract: quoted > characters must not truncate a tag');
  }

  const remoteCases = [
    quotedDelimiter,
    '<img srcset="local.png 1x, https://example.invalid/runtime.png 2x">',
    '<div style="background:url(https://example.invalid/runtime.png)"></div>',
    '<link rel="canonical stylesheet" href="https://example.invalid/runtime.css">',
  ];
  for (const remoteCase of remoteCases) {
    if (remoteRuntimeFindings(remoteCase).length === 0) {
      fail(`verifier internal contract: direct remote runtime case escaped: ${remoteCase}`);
    }
  }
  if (remoteRuntimeFindings('<!-- <img src="https://example.invalid/comment-only.png"> -->').length !== 0) {
    fail('verifier internal contract: commented remote references must not create findings');
  }

  const duplicateId = parseAttributes('<div id=first id=second>');
  if (!duplicateId.duplicates.has('id')) {
    fail('verifier internal contract: quoted and unquoted duplicate attributes must be detected');
  }
}

validateScannerContract();

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

      if (work.slug === 'night-voyage') {
        const readerButtons = openingTags(markup, 'button')
          .map((tag) => attribute(tag.openingTag, 'data-book'))
          .filter(Boolean);
        const readerSources = elements(markup, 'article')
          .filter((element) => attribute(element.openingTag, 'data-reader-book'));
        const sourceKeys = readerSources.map((source) => attribute(source.openingTag, 'data-reader-book'));
        const uniqueButtons = new Set(readerButtons);
        const uniqueSources = new Set(sourceKeys);
        if (
          readerButtons.length !== 3
          || sourceKeys.length !== 3
          || uniqueButtons.size !== 3
          || uniqueSources.size !== 3
          || [...uniqueButtons].some((key) => !uniqueSources.has(key))
        ) {
          fail(`${work.htmlPath}: three reader buttons must map one-to-one to three static reader sources`);
        }
        for (const source of readerSources) {
          const key = attribute(source.openingTag, 'data-reader-book');
          const title = elements(source.fullHtml, 'h3')
            .find((element) => hasAttribute(element.openingTag, 'data-reader-title'));
          const sourceDivs = elements(source.fullHtml, 'div');
          const meta = sourceDivs.find((element) => hasAttribute(element.openingTag, 'data-reader-meta'));
          const body = sourceDivs.find((element) => hasAttribute(element.openingTag, 'data-reader-html'));
          if (
            !hasAttribute(source.openingTag, 'data-content-revision-scope')
            || !attribute(source.openingTag, 'data-reader-cover')
            || !title
            || !meta
            || !body
            || !readableText(title.innerHtml)
            || !readableText(meta.innerHtml)
            || !readableText(body.innerHtml)
          ) {
            fail(`${work.htmlPath}: reader source ${key ?? '(missing key)'} must provide fingerprinted title, meta, cover, and body`);
          }
        }
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
        const refreshMeta = openingTags(legacy, 'meta')
          .map((tag) => tag.openingTag)
          .find((tag) => attribute(tag, 'http-equiv')?.toLowerCase() === 'refresh');
        const refreshContent = attribute(refreshMeta ?? '', 'content') ?? '';
        if (!new RegExp(`^0;\\s*url=${escapedHref}$`, 'i').test(refreshContent)) {
          fail(`${work.legacyPath}: legacy entry must immediately redirect to ${work.stableHref}`);
        }
        const legacyCanonical = openingTags(legacy, 'link')
          .map((tag) => tag.openingTag)
          .find((tag) => (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('canonical'));
        if (attribute(legacyCanonical ?? '', 'href') !== work.canonical) {
          fail(`${work.legacyPath}: canonical URL must be ${work.canonical}`);
        }
        const legacyFallback = openingTags(legacy, 'a')
          .map((tag) => tag.openingTag)
          .some((tag) => attribute(tag, 'href') === work.stableHref);
        if (!legacyFallback) {
          fail(`${work.legacyPath}: missing fallback link to ${work.stableHref}`);
        }
        const legacyScripts = elements(legacy, 'script').map((script) => script.innerHtml);
        if (!legacyScripts.some((script) => script.includes(`window.location.replace('${work.stableHref}')`))) {
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

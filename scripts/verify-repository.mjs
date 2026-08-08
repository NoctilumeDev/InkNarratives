import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demos = ['暗室.html', '柳永.html', '苏轼.html', '王维.html', '长卷.html'];
const requiredFiles = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  'docs/quality-baseline.md',
  'docs/editorial-structure.md',
  ...demos,
];

const failures = [];
const fail = (message) => failures.push(message);

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    fail(`Missing required file: ${relativePath}`);
  }
}

for (const demo of demos) {
  const absolutePath = path.join(root, demo);
  if (!fs.existsSync(absolutePath)) continue;

  const html = fs.readFileSync(absolutePath, 'utf8');
  if (!/^\s*<!doctype html>/i.test(html)) fail(`${demo}: missing HTML doctype`);
  if (!/<html\b[^>]*\blang=["']zh-CN["']/i.test(html)) fail(`${demo}: html lang must be zh-CN`);
  if (!/<meta\b[^>]*\bcharset=["']?utf-8/i.test(html)) fail(`${demo}: missing UTF-8 charset`);
  if (!/<meta\b[^>]*\bname=["']viewport["']/i.test(html)) fail(`${demo}: missing viewport metadata`);
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${demo}: missing non-empty title`);
  if (!/<main\b/i.test(html)) fail(`${demo}: missing main landmark`);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    fail(`${demo}: duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const externalReferences = [...html.matchAll(/\b(?:src|href)=["'](https?:\/\/[^"']+)["']/gi)]
    .map((match) => match[1]);
  if (externalReferences.length > 0) {
    fail(`${demo}: remote runtime dependencies are not allowed: ${externalReferences.join(', ')}`);
  }

  if (/\son[a-z]+\s*=/i.test(html)) fail(`${demo}: inline event handlers are not allowed`);
  if (/<p\b[^>]*\baria-label=/i.test(html)) fail(`${demo}: aria-label is not valid on an untyped paragraph`);

  const headingLevels = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
  for (let index = 1; index < headingLevels.length; index += 1) {
    if (headingLevels[index] > headingLevels[index - 1] + 1) {
      fail(`${demo}: heading level jumps from h${headingLevels[index - 1]} to h${headingLevels[index]}`);
      break;
    }
  }
}

if (failures.length > 0) {
  console.error('Repository verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Repository verification passed: ${demos.length} standalone HTML demos.`);

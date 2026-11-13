import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const fail = message => { console.error('FAIL:', message); process.exitCode = 1; };
const pass = message => console.log('PASS:', message);

const html = read('index.html');
const worker = read('service-worker.js');
let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
  pass('manifest.json is valid JSON');
} catch (error) {
  fail('manifest.json is invalid: ' + error.message);
}

if (html.includes('</script>>')) fail('index.html contains a malformed script closing tag');
else pass('no malformed script closing tag');

const scripts = [...html.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script\\s*>/gi)];
let checked = 0;
for (const [index, match] of scripts.entries()) {
  if (/\\bsrc\\s*=/.test(match[1])) continue;
  try {
    new vm.Script(match[2], { filename: 'index.html:inline-script-' + (index + 1) });
    checked++;
  } catch (error) {
    fail('inline script ' + (index + 1) + ' has a syntax error: ' + error.message);
  }
}
if (checked < 20) fail('unexpectedly few inline scripts were checked (' + checked + ')');
else pass(checked + ' inline JavaScript blocks parse successfully');

const cache = worker.match(/CACHE_NAME\\s*=\\s*['"]([^'"]+)['"]/);
if (!cache) fail('service worker cache name is missing');
else pass('service worker cache is versioned: ' + cache[1]);

const files = [...worker.matchAll(/\\$\\{APP_PREFIX\\}([^'`]+)|APP_PREFIX\\s*,/g)]
  .map(match => match[1])
  .filter(Boolean);
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) fail('service worker precache file is missing: ' + file);
}
if (files.length) pass(files.length + ' named service-worker precache files exist');

if (!html.includes('href="manifest.json"')) fail('index.html does not link the PWA manifest');
else pass('index.html links the PWA manifest');

if (manifest && (!manifest.start_url || !manifest.scope || !Array.isArray(manifest.icons) || !manifest.icons.length)) {
  fail('manifest is missing start_url, scope, or icons');
} else if (manifest) pass('PWA manifest includes start URL, scope, and icons');

if (process.exitCode) process.exit(process.exitCode);
console.log('Etihad Traders source validation completed.');

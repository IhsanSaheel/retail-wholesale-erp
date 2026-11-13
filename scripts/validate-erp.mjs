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

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
let checked = 0;
for (const [index, match] of scripts.entries()) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  try {
    new vm.Script(match[2], { filename: 'index.html:inline-script-' + (index + 1) });
    checked++;
  } catch (error) {
    fail('inline script ' + (index + 1) + ' has a syntax error: ' + error.message);
  }
}
if (checked < 20) fail('unexpectedly few inline scripts were checked (' + checked + ')');
else pass(checked + ' inline JavaScript blocks parse successfully');

const cache = worker.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
if (!cache) fail('service worker cache name is missing');
else pass('service worker cache is versioned: ' + cache[1]);

const files = [...worker.matchAll(/\$\{APP_PREFIX\}([^'`]+)|APP_PREFIX\s*,/g)]
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


const restoreStart = html.indexOf("host.querySelectorAll('[data-audit-restore]')");
const restoreEnd = html.indexOf("\n }\n renderDeletionHistory();", restoreStart);
const restoreCode = restoreStart >= 0 && restoreEnd > restoreStart ? html.slice(restoreStart, restoreEnd) : '';
if (!restoreCode) fail('deletion-history restore handler could not be located');
else {
  const restoreChecks = [
    ['duplicate ID protection', restoreCode.includes('current.find(item=>String(item?.id)===String(record.id))')],
    ['no overwrite of existing records', restoreCode.includes('No duplicate was created and no existing record was overwritten')],
    ['confirmation before restore', restoreCode.includes('if(!confirm(')],
    ['restore audit marked only after storage write', restoreCode.indexOf("localStorage.setItem(collection,JSON.stringify(updated))") < restoreCode.indexOf("entry.restoredAt=new Date().toISOString()")],
    ['restore does not invoke branch deletion', !restoreCode.includes('deleteBranch(')]
  ];
  for (const [name, ok] of restoreChecks) ok ? pass('recovery safeguard: ' + name) : fail('missing recovery safeguard: ' + name);
}

const branchDeleteStart = html.indexOf('function deleteBranch(bid)');
const branchDeleteEnd = html.indexOf('\n}', branchDeleteStart);
const branchDeleteCode = branchDeleteStart >= 0 && branchDeleteEnd > branchDeleteStart ? html.slice(branchDeleteStart, branchDeleteEnd) : '';
if (!branchDeleteCode.includes('products.some(p=>p.branchId===bid)') || !branchDeleteCode.includes('transfers.some(t=>t.fromBranchId===bid||t.toBranchId===bid)')) {
  fail('branch deletion protections for products and transfer history are missing');
} else pass('branch deletion protects linked products and transfer history');

const backupStart = html.indexOf('document.getElementById(\'restoreBackup\').onclick');
const backupEnd = html.indexOf('\n };', backupStart);
const backupCode = backupStart >= 0 && backupEnd > backupStart ? html.slice(backupStart, backupEnd) : '';
if (!backupCode) fail('backup restore handler could not be located');
else {
  const validationAt = backupCode.indexOf('const backwardCompatibleKeys');
  const safetyAt = backupCode.indexOf('const safety=collectBackup()');
  const writeAt = backupCode.indexOf('localStorage.setItem(');
  if (validationAt < 0 || safetyAt < 0 || writeAt < 0 || !(validationAt < safetyAt && safetyAt < writeAt)) {
    fail('backup restore must validate all collections and create a safety backup before replacing records');
  } else pass('backup restore validates data and creates a safety backup before replacing records');
}

const cloudStart = html.indexOf('async function permittedCloudRecords()');
const cloudEnd = html.indexOf('function applyPermittedRecords', cloudStart);
const cloudCode = cloudStart >= 0 && cloudEnd > cloudStart ? html.slice(cloudStart, cloudEnd) : '';
if (!cloudCode || !cloudCode.includes(".eq('org_id',ORG_ID)")) fail('cloud record download is missing its organization filter');
else pass('cloud record download is restricted to the configured organization');


const cloudStartForSecurity = html.indexOf('async function permittedCloudRecords()');
const cloudEndForSecurity = html.indexOf('async function authorizeAndOpen()', cloudStartForSecurity);
const cloudSecurityCode = cloudStartForSecurity >= 0 && cloudEndForSecurity > cloudStartForSecurity
  ? html.slice(cloudStartForSecurity, cloudEndForSecurity)
  : '';
const securityChecks = [
  ['active company membership is required', cloudSecurityCode.includes('!r.data||!r.data.active')],
  ['automatic sync verifies the signed-in user', cloudSecurityCode.includes('user.id!==syncUser.id')],
  ['initial full-company upload is owner-only', cloudSecurityCode.includes("m.role!=='owner'")],
  ['cloud uploads use the signed-in user as updater', cloudSecurityCode.includes('updated_by:user.id')],
  ['deletion sync limitation is disclosed', cloudSecurityCode.includes('Deletions are not synchronized yet')]
];
for (const [name, ok] of securityChecks) ok ? pass('cloud safeguard: ' + name) : fail('missing cloud safeguard: ' + name);

if (/service_role|SUPABASE_SERVICE_ROLE_KEY/i.test(html)) {
  fail('a Supabase service-role credential marker was found in the browser application');
} else pass('no Supabase service-role credential marker appears in index.html');

if (process.exitCode) process.exit(process.exitCode);
console.log('Etihad Traders source validation completed.');

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseToml, readSourceConfig} from '../scripts/source.mjs';
import {canonicalConfig} from '../src/config.mjs';
import {applyPlan, makePlan} from '../scripts/sync-core.mjs';

const header = 'schemaVersion = 1\npublicOrigin = "https://s.vectorindex.cloud"\n';
const source = header + '\n[[redirects]]\npath = "/test"\ntarget = "https://vectorindex.cloud/"\n';
const existing = {schemaVersion: 1, publicOrigin: 'https://s.vectorindex.cloud', redirects: [{path:'/test',target:'https://vectorindex.cloud/'}]};

test('equivalent legacy JSON and TOML preserve mappings after canonicalization', async () => {
  assert.equal(canonicalConfig(parseToml(source)), canonicalConfig(existing));
  await readSourceConfig('links.toml');
});
test('full TOML supports comments, quoted/literal strings, escapes and array tables', () => {
  const parsed = parseToml(header + `
# Values are not parsed with regexes.
[[redirects]]
path = '/docs/nested'
target = 'https://example.com/a?x=1&y=2#heading' # Keep hash inside string.
[[redirects]]
path = "/a"
target = "https://example.com/\\u4e2d\\u6587"
`);
  assert.deepEqual(parsed.redirects.map(x=>x.path), ['/a','/docs/nested']);
  assert.equal(parsed.redirects[0].target, 'https://example.com/%E4%B8%AD%E6%96%87');
  assert.equal(parsed.redirects[1].target, 'https://example.com/a?x=1&y=2#heading');
});
test('literal Unicode is decoded as UTF-8 regardless of host locale', () => {
  const parsed = parseToml(header + `\n[[redirects]]\npath = "/unicode"\ntarget = "https://example.com/中文?名称=测试"\n`);
  assert.equal(parsed.redirects[0].target, new URL('https://example.com/中文?名称=测试').href);
});
test('invalid TOML, duplicate keys/paths, bad schema and unsafe targets are rejected', () => {
  for (const bad of [
    'invalid = [', source + 'target = "https://example.com/"',
    source + '\n[[redirects]]\npath="/test"\ntarget="https://example.com/"',
    source.replace('schemaVersion = 1','schemaVersion = "1"'),
    source.replace('schemaVersion = 1','schemaVersion = nan'),
    source.replace('schemaVersion = 1','schemaVersion = 2026-11-11'),
    source.replace('https://vectorindex.cloud/','javascript:alert(1)'),
    source.replace('https://vectorindex.cloud/','https://s.vectorindex.cloud/test'),
    source + '\nunknown = true', '#'.repeat(256 * 1024 + 1),
  ]) assert.throws(()=>parseToml(bad));
});
test('converted JSON feeds the existing publisher without rewriting unchanged KV', async () => {
  const config = parseToml(source);
  const target = {accountId:'a'.repeat(32),namespaceId:'b'.repeat(32)};
  const current = JSON.stringify(existing, null, 2);
  const plan = makePlan(current, config, target);
  let writes = 0;
  const result = await applyPlan({plan,desiredConfig:config,target,
    client:{read:async()=>current,write:async()=>{writes++;}},
    backup:async()=>assert.fail('unchanged snapshot must not create backups'),
  });
  assert.equal(result.status,'unchanged'); assert.equal(writes,0);
});
test('converter writes validated JSON; invalid source cannot replace existing output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'short-links-toml-'));
  try {
    const input = join(dir,'links.toml'), output = join(dir,'links.json');
    await writeFile(input,source);
    const convert = ()=>spawnSync(process.execPath,['scripts/convert.mjs','--file',input,'--output',output],{encoding:'utf8'});
    assert.equal(convert().status,0);
    assert.equal(await readFile(output,'utf8'), canonicalConfig(existing)+'\n');
    assert.equal(canonicalConfig(await readSourceConfig(output)), canonicalConfig(existing));
    await writeFile(input,'invalid = [');
    assert.notEqual(convert().status,0);
    assert.equal(await readFile(output,'utf8'), canonicalConfig(existing)+'\n');
    const sync = spawnSync(process.execPath,['scripts/sync.mjs','sync','--file',input],{encoding:'utf8',env:{...process.env,CLOUDFLARE_API_TOKEN:''}});
    assert.notEqual(sync.status,0); assert.match(sync.stderr,/Invalid TOML/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('private initialization defaults to TOML and refuses overwriting', async () => {
  const script = new URL('../scripts/sync.mjs',import.meta.url);
  const dir = await mkdtemp(join(tmpdir(),'short-links-init-'));
  try {
    const run = ()=>spawnSync(process.execPath,[fileURLToPath(script),'init'],{cwd:dir,encoding:'utf8'});
    assert.equal(run().status,0);
    assert.equal((await readSourceConfig(join(dir,'links.local.toml'))).redirects.length,0);
    assert.notEqual(run().status,0);
    const legacy = spawnSync(process.execPath,[fileURLToPath(script),'init','--file','links.local.json'],{cwd:dir,encoding:'utf8'});
    assert.equal(legacy.status,0);
    assert.equal((await readSourceConfig(join(dir,'links.local.json'))).redirects.length,0);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('workflow converts TOML before sync and keeps unprivileged PR and single publisher guards', async () => {
  const workflow = await readFile('.github/workflows/short-links.yml','utf8');
  assert.match(workflow,/paths: \['links.toml'/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/github.event_name != 'pull_request'/);
  assert.match(workflow,/vars.SHORT_LINKS_SYNC_ENABLED == 'true'/);
  assert.match(workflow,/git ls-remote --exit-code origin refs\/heads\/develop/);
  assert.ok(workflow.indexOf('Convert TOML') < workflow.indexOf('Synchronize the validated snapshot'));
  assert.match(workflow,/sync --file \.local\/links.json/);
  assert.match(workflow,/npm run links:verify/);
  assert.doesNotMatch(workflow,/pull_request_target|wrangler deploy/);
});

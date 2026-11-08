import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
const require = createRequire(import.meta.url);
const wranglerPackage = require.resolve('wrangler/package.json');
const wranglerRequire = createRequire(wranglerPackage);
const wranglerBin = resolve(dirname(wranglerPackage), wranglerRequire('./package.json').bin.wrangler);
const {Miniflare, convertV4MiniflareOptions} = wranglerRequire('miniflare');
mkdirSync('.local/xdg', {recursive:true});
const build = spawnSync(process.execPath, [wranglerBin, 'deploy', '--dry-run', '--outdir', '.local/dry-run'], {
  stdio:'inherit', env:{...process.env, XDG_CONFIG_HOME:resolve('.local/xdg'), WRANGLER_LOG_PATH:resolve('.local/wrangler-test.log'), WRANGLER_SEND_METRICS:'false'},
});
if(build.status !== 0) process.exit(build.status ?? 1);
const compatibilityDate = JSON.parse(readFileSync('wrangler.jsonc','utf8')).compatibility_date;
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'short-links',modules:true,scriptPath:'.local/dry-run/worker.js',compatibilityDate,kvNamespaces:['LINKS'],bindings:{PUBLIC_ORIGIN:'https://s.vectorindex.cloud'}}],host:'127.0.0.1',port:0}));
try {
 const kv=await mf.getKVNamespace('LINKS');
 const payload={schemaVersion:1,publicOrigin:'https://s.vectorindex.cloud',redirects:[{path:'/smoke',target:'https://example.com/guide?fixed=1'}]};
 await kv.put('redirects:v1',JSON.stringify(payload));
 const res=await mf.dispatchFetch('https://s.vectorindex.cloud/smoke?next=https://evil.example',{redirect:'manual'});
 assert.equal(res.status,302);assert.equal(res.headers.get('location'),'https://example.com/guide?fixed=1');
 const head=await mf.dispatchFetch('https://s.vectorindex.cloud/smoke',{method:'HEAD',redirect:'manual'});assert.equal(head.status,302);assert.equal(await head.text(),'');
 const absent=await mf.dispatchFetch('https://s.vectorindex.cloud/not-there');assert.equal(absent.status,404);
 const write=await mf.dispatchFetch('https://s.vectorindex.cloud/api/links',{method:'POST'});assert.equal(write.status,405);
 await kv.put('redirects:v1','broken');
 const broken=await mf.dispatchFetch('https://s.vectorindex.cloud/smoke');assert.equal(broken.status,503);
 console.log('Local workerd/KV integration: GET, HEAD, unknown path, blocked write and corrupt snapshot passed.');
} finally {await mf.dispose();}

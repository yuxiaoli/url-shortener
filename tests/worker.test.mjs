import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import {SNAPSHOT_KEY} from '../src/config.mjs';
const snapshot = JSON.stringify({schemaVersion:1,publicOrigin:'https://s.vectorindex.cloud',redirects:[{path:'/docs',target:'https://example.com/guide?fixed=1#top'}]});
function env(text = snapshot) {
  return {PUBLIC_ORIGIN:'https://s.vectorindex.cloud', LINKS:{async get(key,type){assert.equal(key,SNAPSHOT_KEY);assert.equal(type,'text');return text;}}};
}
test('redirects GET without forwarding caller query parameters', async () => {
  const result=await worker.fetch(new Request('https://s.vectorindex.cloud/docs?url=https://evil.com&token=private'),env());
  assert.equal(result.status,302);assert.equal(result.headers.get('location'),'https://example.com/guide?fixed=1#top');
  assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(result.headers.get('referrer-policy'),'no-referrer');
  assert.equal(await result.text(),'');
});
test('HEAD matches GET but has no body',async()=>{
  for(const path of ['/docs','/missing']){const res=await worker.fetch(new Request('https://s.vectorindex.cloud'+path,{method:'HEAD'}),env());assert.equal(res.status,path==='/docs'?302:404);assert.equal(await res.text(),'');}
});
test('unknown routes do not list or expose the mapping',async()=>{
  for(const path of ['/links.json','/api/links','/missing','/Docs','/docs/','/%64ocs']){
    const res=await worker.fetch(new Request('https://s.vectorindex.cloud'+path),env());assert.equal(res.status,404,path);assert.equal(res.headers.get('location'),null);
  }
});
test('root explains public short links without exposing configuration or caller data',async()=>{
  const res=await worker.fetch(new Request('https://s.vectorindex.cloud/?token=private'),env());
  assert.equal(res.status,200);assert.equal(res.headers.get('location'),null);
  assert.equal(res.headers.get('content-type'),'text/plain; charset=utf-8');
  assert.equal(res.headers.get('cache-control'),'no-store');
  const text=await res.text();assert.match(text,/VectorIndex short links/);
  assert.doesNotMatch(text,/private|example\.com|\/docs|redirects:v1|LINKS/);
  const head=await worker.fetch(new Request('https://s.vectorindex.cloud/',{method:'HEAD'}),env());
  assert.equal(head.status,200);assert.equal(await head.text(),'');
});
test('an explicitly configured root redirect still takes precedence',async()=>{
  const value=JSON.stringify({...JSON.parse(snapshot),redirects:[{path:'/',target:'https://example.com/'}]});
  const res=await worker.fetch(new Request('https://s.vectorindex.cloud/'),env(value));
  assert.equal(res.status,302);assert.equal(res.headers.get('location'),'https://example.com/');
});
test('root remains read-only and fails closed on missing or invalid configuration',async()=>{
  for(const value of [null,'broken',snapshot.replace('https://s.vectorindex.cloud','https://other.example.com')]){
    const res=await worker.fetch(new Request('https://s.vectorindex.cloud/'),env(value));assert.equal(res.status,503);
  }
  const res=await worker.fetch(new Request('https://s.vectorindex.cloud/',{method:'POST'}),{LINKS:{get(){throw Error('must not read');}}});
  assert.equal(res.status,405);
});
test('nonread methods never touch KV',async()=>{
  const forbidden={LINKS:{get(){throw Error('must not read');}}};
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){const res=await worker.fetch(new Request('https://s.vectorindex.cloud/docs',{method}),forbidden);assert.equal(res.status,405);assert.equal(res.headers.get('allow'),'GET, HEAD');}
});
test('missing, corrupt, wrong-origin, or unavailable KV fails closed',async()=>{
  for(const value of [null,'garbage',snapshot.replace('https://s.vectorindex.cloud','https://other.example.com'),snapshot.replace('https://example.com/guide?fixed=1#top','javascript:alert(1)')]){
    const res=await worker.fetch(new Request('https://s.vectorindex.cloud/docs'),env(value));assert.equal(res.status,503);assert.equal(res.headers.get('location'),null);
  }
  const res=await worker.fetch(new Request('https://s.vectorindex.cloud/docs'),{PUBLIC_ORIGIN:'https://s.vectorindex.cloud',LINKS:{async get(){throw Error('contains provider details');}}});
  assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/provider/);
});

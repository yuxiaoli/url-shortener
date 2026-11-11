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
test('parent and nested profile slugs resolve independently with exact matching',async()=>{
  const redirects=[
    {path:'/sean',target:'https://example.com/'},
    {path:'/sean/in',target:'https://www.linkedin.com/in/example/'},
    {path:'/sean/github',target:'https://github.com/example'},
  ];
  const configured=env(JSON.stringify({schemaVersion:1,publicOrigin:'https://s.vectorindex.cloud',redirects}));
  for(const link of redirects){
    for(const method of ['GET','HEAD']){
      const response=await worker.fetch(new Request('https://s.vectorindex.cloud'+link.path+'?next=https://evil.example',{method}),configured);
      assert.equal(response.status,302);assert.equal(response.headers.get('location'),link.target);
    }
  }
  for(const path of ['/sean/unknown','/sean/in/child','/sean/in/','/Sean/in']){
    const response=await worker.fetch(new Request('https://s.vectorindex.cloud'+path),configured);
    assert.equal(response.status,404);assert.equal(response.headers.get('location'),null);
  }
});
test('unknown routes do not list or expose the mapping',async()=>{
  for(const path of ['/','/links.json','/api/links','/missing','/Docs','/docs/','/%64ocs']){
    const res=await worker.fetch(new Request('https://s.vectorindex.cloud'+path),env());assert.equal(res.status,404,path);assert.equal(res.headers.get('location'),null);
  }
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

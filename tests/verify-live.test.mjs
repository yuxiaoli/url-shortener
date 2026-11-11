import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLive} from '../scripts/verify-live-core.mjs';

const config = {publicOrigin:'https://s.vectorindex.cloud',redirects:[
  {path:'/a',target:'https://example.com/a'},
  {path:'/b',target:'https://example.com/b'},
]};
function healthy(calls) {
  return async (url, options) => {
    calls.push({url,options});
    assert.equal(options.redirect,'manual');
    assert.equal(new URL(url).origin,config.publicOrigin);
    if (options.method === 'POST') return new Response(null,{status:405});
    const link = config.redirects.find(x=>x.path===new URL(url).pathname);
    if (!link) return new Response(null,{status:404});
    return new Response(null,{status:302,headers:{location:link.target,'cache-control':'no-store'}});
  };
}
test('live verifier checks all mappings, HEAD, unknown 404 and method 405 without following redirects', async () => {
  const calls=[];
  await verifyLive(config,{fetcher:healthy(calls),sleep:()=>assert.fail('must not wait'),log:()=>{}});
  assert.equal(calls.length,5);
  assert.deepEqual(calls.map(x=>x.options.method),['GET','GET','HEAD','GET','POST']);
});
test('live verifier retries reads for propagation but never writes KV', async () => {
  const calls=[]; let reads=0, waits=0;
  const expected=healthy(calls);
  await verifyLive(config,{fetcher:async (...args)=>++reads===1 ? new Response(null,{status:404}):expected(...args),
    sleep:async()=>{waits++;},log:()=>{}});
  assert.equal(waits,1);assert.equal(reads,6);
  assert.ok(calls.every(x=>new URL(x.url).hostname==='s.vectorindex.cloud'));
});
test('live verifier fails after bounded mismatches instead of treating 200 or 403 as success', async () => {
  for (const status of [200,403]) {
    let calls=0,waits=0;
    await assert.rejects(verifyLive(config,{fetcher:async()=>{calls++;return new Response(null,{status});},sleep:async()=>{waits++;},log:()=>{}}),/does not match/);
    assert.equal(calls,4);assert.equal(waits,3);
  }
});
test('live verifier rejects wrong destinations and unexpected unknown-path responses', async () => {
  await assert.rejects(verifyLive(config,{fetcher:async()=>new Response(null,{status:302,headers:{location:'https://wrong.example/','cache-control':'no-store'}}),attempts:1,log:()=>{}}),/does not match/);
  const calls=[],expected=healthy(calls);
  await assert.rejects(verifyLive(config,{fetcher:async (url,options)=>new URL(url).pathname.startsWith('/verify-missing-') ? new Response(null,{status:200}):expected(url,options),attempts:1,log:()=>{}}),/Unknown public path/);
});

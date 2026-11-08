import test from 'node:test';
import assert from 'node:assert/strict';
import {makePlan,applyPlan,cloudflareClient,BACKUP_KEY} from '../scripts/sync-core.mjs';
import {canonicalConfig,SNAPSHOT_KEY} from '../src/config.mjs';
const target={accountId:'a'.repeat(32),namespaceId:'b'.repeat(32)};
const cfg=(redirects=[])=>({schemaVersion:1,publicOrigin:'https://s.vectorindex.cloud',redirects});
const one=cfg([{path:'/a',target:'https://example.com/'}]);
const two=cfg([...one.redirects,{path:'/b',target:'https://example.org/'}]);
function harness(current,desired=two) {
  const data=new Map([[SNAPSHOT_KEY,current]]); const writes=[]; const backups=[];
  return {data,writes,backups,args:{plan:makePlan(current,desired,target),desiredConfig:desired,target,
    client:{async read(key){return data.get(key)??null;},async write(key,value){writes.push(key);data.set(key,value);}},
    backup:async value=>backups.push(value)}};
}
test('planning computes additions changes and removals without writing',()=>{
  const plan=makePlan(canonicalConfig(one),cfg([{path:'/b',target:'https://example.org'}]),target);
  assert.deepEqual(plan.diff,{added:['/b'],changed:[],removed:['/a']});
});
test('publish backs up and updates one complete snapshot',async()=>{
  const h=harness(canonicalConfig(one));const result=await applyPlan(h.args);
  assert.equal(result.status,'accepted');assert.deepEqual(h.writes,[BACKUP_KEY,SNAPSHOT_KEY]);assert.equal(h.data.get(BACKUP_KEY),canonicalConfig(one));
  assert.equal(h.data.get(SNAPSHOT_KEY),canonicalConfig(two));assert.equal(h.backups.length,1);
});
test('first publish writes only active snapshot',async()=>{const h=harness(null,one);await applyPlan(h.args);assert.deepEqual(h.writes,[SNAPSHOT_KEY]);});
test('formatting-only changes are noops',async()=>{const h=harness(JSON.stringify(one,null,2),one);assert.equal((await applyPlan(h.args)).status,'unchanged');assert.equal(h.writes.length,0);});
test('retargeting is a detected change',()=>{const plan=makePlan(canonicalConfig(one),cfg([{path:'/a',target:'https://example.org/'}]),target);assert.deepEqual(plan.diff.changed,['/a']);});
test('removals require explicit approval and keep current map intact',async()=>{
  const h=harness(canonicalConfig(two),one);await assert.rejects(applyPlan(h.args),/allow-removals/);assert.equal(h.writes.length,0);
  await applyPlan({...h.args,allowRemovals:true});assert.equal(h.data.get(SNAPSHOT_KEY),canonicalConfig(one));
});
test('empty publish requires both applicable safeguards',async()=>{
  const h=harness(canonicalConfig(one),cfg());await assert.rejects(applyPlan({...h.args,allowRemovals:true}),/allow-empty/);assert.equal(h.writes.length,0);
  await applyPlan({...h.args,allowRemovals:true,allowEmpty:true});assert.equal(h.data.get(SNAPSHOT_KEY),canonicalConfig(cfg()));
});
test('changed local input and wrong namespace cannot reuse a plan',async()=>{
  const h=harness(canonicalConfig(one));await assert.rejects(applyPlan({...h.args,desiredConfig:one}),/does not match/);
  await assert.rejects(applyPlan({...h.args,target:{...target,namespaceId:'c'.repeat(32)}}),/does not match/);assert.equal(h.writes.length,0);
});
test('stale remote plan cannot replace newer content',async()=>{
  const h=harness(canonicalConfig(one));h.data.set(SNAPSHOT_KEY,canonicalConfig(cfg()));await assert.rejects(applyPlan(h.args),/changed after planning/);assert.equal(h.writes.length,0);
});
test('remote drift during backup stops active replacement',async()=>{
  const h=harness(canonicalConfig(one));h.args.backup=async()=>{h.data.set(SNAPSHOT_KEY,canonicalConfig(cfg()));};
  await assert.rejects(applyPlan(h.args),/changed during preparation/);assert.deepEqual(h.writes,[BACKUP_KEY]);assert.equal(h.data.get(SNAPSHOT_KEY),canonicalConfig(cfg()));
});
test('local or remote backup failure preserves active snapshot',async()=>{
  const local=harness(canonicalConfig(one));await assert.rejects(applyPlan({...local.args,backup:async()=>{throw Error('disk full');}}),/disk full/);assert.equal(local.writes.length,0);
  const remote=harness(canonicalConfig(one));remote.args.client.write=async()=>{throw Error('backup failed');};await assert.rejects(applyPlan(remote.args),/backup failed/);assert.equal(remote.data.get(SNAPSHOT_KEY),canonicalConfig(one));
});
test('invalid old snapshot and mismatched origin are not overwritten',()=>{
  assert.throws(()=>makePlan('invalid',two,target));assert.throws(()=>makePlan(canonicalConfig({...one,publicOrigin:'https://other.example.com'}),two,target),/another publicOrigin/);
});
test('provider client uses fixed HTTPS destination and never follows redirects',async()=>{
  const calls=[];const client=cloudflareClient({...target,token:'example-not-a-real-token',fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({success:true,result:{id:target.namespaceId}}),{status:200});}});
  await client.verifyNamespace();await client.write(SNAPSHOT_KEY,canonicalConfig(one));
  assert.match(calls[0].url,/^https:\/\/api\.cloudflare\.com\//);assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.method,'PUT');
});
test('provider errors and timeouts never leak credential or response body',async()=>{
  const client=cloudflareClient({...target,token:'example-not-a-real-token',fetcher:async()=>{throw Error('example-not-a-real-token');}});
  await assert.rejects(client.write(SNAPSHOT_KEY,'{}'),error=>/uncertain/.test(error.message)&&!error.message.includes('example-not-a-real-token'));
  const denied=cloudflareClient({...target,token:'example-not-a-real-token',fetcher:async()=>new Response('private provider detail',{status:403})});
  await assert.rejects(denied.verifyNamespace(),/HTTP 403/);
});
test('invalid identifiers and missing credentials fail before network access',()=>{
  assert.throws(()=>cloudflareClient({...target,token:''}),/required/);assert.throws(()=>cloudflareClient({...target,accountId:'../../',token:'example'}),/valid/);
});

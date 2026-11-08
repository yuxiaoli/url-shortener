import {readFile, writeFile, mkdir, open} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {parseConfig, SNAPSHOT_KEY} from '../src/config.mjs';
import {makePlan, applyPlan, cloudflareClient} from './sync-core.mjs';

async function privateWrite(file, data) {
  const location = resolve(file);
  await mkdir(dirname(location), {recursive: true, mode: 0o700});
  const handle = await open(location, 'w', 0o600);
  try { await handle.chmod(0o600); await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); }
  finally { await handle.close(); }
}
async function main() {
  const {values, positionals} = parseArgs({allowPositionals: true, options: {
    file: {type: 'string', default: 'links.json'}, plan: {type: 'string', default: '.local/sync-plan.json'},
    'allow-removals': {type: 'boolean', default: false}, 'allow-empty': {type: 'boolean', default: false},
  }});
  const command = positionals[0];
  if (positionals.length !== 1 || !['init', 'validate', 'plan', 'apply', 'sync'].includes(command)) {
    throw new Error('Usage: node scripts/sync.mjs init|validate|plan|apply|sync [--file links.json] [--plan .local/sync-plan.json] [--allow-removals] [--allow-empty]');
  }
  if (command === 'init') {
    const file = values.file === 'links.json' ? 'links.local.json' : values.file;
    await writeFile(file, await readFile(new URL('../links.example.json', import.meta.url)), {flag: 'wx', mode: 0o600});
    console.log('Created a new private configuration. Existing files were not overwritten.');
    return;
  }
  const config = parseConfig(await readFile(values.file, 'utf8'));
  if (command === 'validate') { console.log(`Valid configuration: ${config.redirects.length} redirect(s).`); return; }
  const target = {accountId: process.env.CLOUDFLARE_ACCOUNT_ID, namespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID};
  const client = cloudflareClient({...target, token: process.env.CLOUDFLARE_API_TOKEN});
  await client.verifyNamespace();
  // A local lock blocks concurrent commands in one checkout. GitHub Actions also
  // serializes the publisher. KV itself has no compare-and-swap: use one writer.
  await mkdir('.local', {recursive: true, mode: 0o700});
  const lock = await open('.local/sync.lock', 'wx', 0o600).catch(() => { throw new Error('Another sync may be running. Check .local/sync.lock before starting another.'); });
  try {
    let plan;
    if (command === 'apply') plan = JSON.parse(await readFile(values.plan, 'utf8'));
    else {
      plan = makePlan(await client.read(SNAPSHOT_KEY), config, target);
      await privateWrite(values.plan, plan);
    }
    console.log(`Plan: ${plan.diff.added.length} addition(s), ${plan.diff.changed.length} target change(s), ${plan.diff.removed.length} removal(s). Destinations are not logged.`);
    if (command === 'plan') { console.log('Dry run only. No KV writes.'); return; }
    const result = await applyPlan({
      plan, desiredConfig: config, target, client,
      allowRemovals: values['allow-removals'], allowEmpty: values['allow-empty'],
      backup: data => privateWrite(`.local/backups/${Date.now()}-${plan.expectedHash.slice(0,12)}.json`, data),
    });
    await privateWrite('.local/last-sync.json', result);
    console.log(result.status === 'unchanged' ? 'Already synchronized. No writes.' : 'Cloudflare accepted the snapshot. Global propagation can take 60 seconds or more.');
  } finally {
    await lock.close();
    const {unlink} = await import('node:fs/promises');
    await unlink('.local/sync.lock');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

import {readFile, writeFile, mkdir, open} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {SNAPSHOT_KEY} from '../src/config.mjs';
import {readSourceConfig} from './source.mjs';
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
    file: {type: 'string', default: 'links.toml'}, plan: {type: 'string', default: '.local/sync-plan.json'},
    'allow-removals': {type: 'boolean', default: false}, 'allow-empty': {type: 'boolean', default: false},
  }});
  const command = positionals[0];
  if (positionals.length !== 1 || !['init', 'validate', 'plan', 'apply', 'sync'].includes(command)) {
    throw new Error('Usage: node scripts/sync.mjs init|validate|plan|apply|sync [--file links.toml|links.json] [--plan .local/sync-plan.json] [--allow-removals] [--allow-empty]');
  }
  if (command === 'init') {
    const file = values.file === 'links.toml' ? 'links.local.toml' : values.file;
    if (!['.toml', '.json'].includes(extname(file))) throw new Error('Configuration file must end in .toml or .json.');
    const template = new URL('../links.example.toml', import.meta.url);
    const content = extname(file) === '.json'
      ? JSON.stringify(await readSourceConfig(fileURLToPath(template)), null, 2) + '\n'
      : await readFile(template);
    await writeFile(file, content, {flag: 'wx', mode: 0o600});
    console.log('Created a new private configuration. Existing files were not overwritten.');
    return;
  }
  const config = await readSourceConfig(values.file);
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

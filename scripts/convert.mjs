import {mkdir, open} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {canonicalConfig} from '../src/config.mjs';
import {readSourceConfig} from './source.mjs';

async function main() {
  const {values} = parseArgs({options: {
    file: {type: 'string', default: 'links.toml'},
    output: {type: 'string', default: '.local/links.json'},
  }});
  if (resolve(values.file) === resolve(values.output)) throw new Error('Source and output paths must differ.');
  const config = await readSourceConfig(values.file);
  // Finish parsing and shared runtime validation before touching the output.
  const json = canonicalConfig(config) + '\n';
  await mkdir(dirname(resolve(values.output)), {recursive: true, mode: 0o700});
  const handle = await open(values.output, 'w', 0o600);
  try { await handle.chmod(0o600); await handle.writeFile(json); }
  finally { await handle.close(); }
  console.log(`Converted and validated ${config.redirects.length} redirect(s) to JSON. Destinations are not logged.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

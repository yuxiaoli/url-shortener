import {parseArgs} from 'node:util';
import {readSourceConfig} from './source.mjs';
import {verifyLive} from './verify-live-core.mjs';

async function main() {
  const {values} = parseArgs({options: {file: {type: 'string', default: '.local/links.json'}}});
  await verifyLive(await readSourceConfig(values.file));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

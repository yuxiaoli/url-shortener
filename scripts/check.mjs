import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
for (const dir of ['src', 'scripts', 'tests']) {
  for (const file of readdirSync(dir).filter(name => name.endsWith('.mjs'))) {
    const result = spawnSync(process.execPath, ['--check', `${dir}/${file}`], {stdio: 'inherit'});
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', ...tests], {stdio: 'inherit'});
process.exit(result.status ?? 1);

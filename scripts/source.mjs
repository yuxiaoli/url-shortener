import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {extname} from 'node:path';
import {MAX_BYTES, parseConfig} from '../src/config.mjs';

export function parseToml(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) {
    throw new Error('Configuration is larger than 256 KiB.');
  }
  // Use a full TOML parser, never an ad hoc line/regex converter. Isolated mode
  // ignores user Python startup and path customizations; no shell is involved.
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const parsed = spawnSync(python, ['-I', fileURLToPath(new URL('./parse-toml.py', import.meta.url))], {
    input: text, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
  });
  if (parsed.error) throw new Error('Cannot run the TOML converter. Install Python 3.11+ or set PYTHON to its executable path.');
  if (parsed.status !== 0) throw new Error('Invalid TOML configuration or unsupported value type. Python 3.11+ is required.');
  return parseConfig(parsed.stdout);
}

export async function readSourceConfig(file = 'links.toml') {
  const text = await readFile(file, 'utf8');
  if (extname(file) === '.toml') return parseToml(text);
  if (extname(file) === '.json') return parseConfig(text);
  throw new Error('Configuration file must end in .toml or .json.');
}

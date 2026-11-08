export const SNAPSHOT_KEY = 'redirects:v1';
export const MAX_BYTES = 256 * 1024;
export const MAX_LINKS = 1000;
const encoder = new TextEncoder();
const pathPattern = /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/;

export function validPath(path) {
  return typeof path === 'string' && path.length <= 160 && pathPattern.test(path);
}
function exactKeys(object, expected, context) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      Object.keys(object).length !== expected.length ||
      expected.some(key => !Object.hasOwn(object, key))) {
    throw new Error(`Invalid ${context} fields.`);
  }
}
export function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('publicOrigin must be an HTTPS origin.'); }
  if (typeof value !== 'string' || url.protocol !== 'https:' || url.origin !== value ||
      url.username || url.password || url.port || !url.hostname.includes('.')) {
    throw new Error('publicOrigin must be an HTTPS origin without a path, port, or credentials.');
  }
  return url;
}
function prohibitedHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return true;
  // Reject IP literals, including WHATWG-normalized hexadecimal/decimal IPv4.
  return /^\d+\.\d+\.\d+\.\d+$/.test(host);
}
export function normalizeTarget(value, origin) {
  if (typeof value !== 'string' || value.length > 4096 ||
      /[\u0000-\u0020\u007f\\]/.test(value) || /%0[ad]/i.test(value) ||
      !/^https?:\/\//i.test(value)) throw new Error('Target must be an absolute HTTP(S) URL without whitespace or control characters.');
  let target;
  try { target = new URL(value); } catch { throw new Error('Invalid destination URL.'); }
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password ||
      target.port || prohibitedHost(target.hostname) ||
      target.hostname.toLowerCase().replace(/\.$/, '') === origin.hostname.toLowerCase().replace(/\.$/, '')) {
    throw new Error('Destination must be an external public hostname without credentials or a nonstandard port.');
  }
  return target.href;
}
export function validateConfig(input) {
  exactKeys(input, ['schemaVersion', 'publicOrigin', 'redirects'], 'configuration');
  if (input.schemaVersion !== 1) throw new Error('Unsupported schemaVersion.');
  const origin = parseOrigin(input.publicOrigin);
  if (!Array.isArray(input.redirects) || input.redirects.length > MAX_LINKS) {
    throw new Error(`redirects must be an array containing at most ${MAX_LINKS} entries.`);
  }
  const seen = new Set();
  const redirects = input.redirects.map(entry => {
    exactKeys(entry, ['path', 'target'], 'redirect');
    if (!validPath(entry.path)) throw new Error('Invalid short path: use slash-separated ASCII letters, digits, underscores, or hyphens.');
    if (seen.has(entry.path)) throw new Error('Duplicate short path.');
    seen.add(entry.path);
    return {path: entry.path, target: normalizeTarget(entry.target, origin)};
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const config = {schemaVersion: 1, publicOrigin: origin.origin, redirects};
  if (encoder.encode(JSON.stringify(config)).byteLength > MAX_BYTES) throw new Error('Configuration is larger than 256 KiB.');
  return config;
}
export function parseConfig(text) {
  if (typeof text !== 'string' || encoder.encode(text).byteLength > MAX_BYTES) throw new Error('Configuration is larger than 256 KiB.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Configuration is not valid JSON.'); }
  return validateConfig(data);
}
export function canonicalConfig(config) { return JSON.stringify(validateConfig(config)); }

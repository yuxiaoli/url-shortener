import {createHash} from 'node:crypto';
import {canonicalConfig, parseConfig, SNAPSHOT_KEY} from '../src/config.mjs';
export const BACKUP_KEY = 'redirects:previous:v1';
export const hash = value => value === null ? 'missing' : createHash('sha256').update(value).digest('hex');
export function difference(before, after) {
  const old = new Map((before?.redirects ?? []).map(link => [link.path, link.target]));
  const next = new Map(after.redirects.map(link => [link.path, link.target]));
  return {
    added: [...next.keys()].filter(path => !old.has(path)),
    changed: [...next.keys()].filter(path => old.has(path) && next.get(path) !== old.get(path)),
    removed: [...old.keys()].filter(path => !next.has(path)),
  };
}
export function makePlan(currentText, desiredConfig, target) {
  const desired = canonicalConfig(desiredConfig);
  const current = currentText === null ? null : parseConfig(currentText);
  if (current && current.publicOrigin !== desiredConfig.publicOrigin) throw new Error('Existing snapshot uses another publicOrigin. Refusing to replace it.');
  return {
    version: 1, target, createdAt: new Date().toISOString(),
    expectedHash: hash(currentText), desiredHash: hash(desired),
    diff: difference(current, parseConfig(desired)),
  };
}
export async function applyPlan({plan, desiredConfig, target, client, backup, allowRemovals = false, allowEmpty = false}) {
  const desired = canonicalConfig(desiredConfig);
  if (plan.version !== 1 || plan.target.accountId !== target.accountId ||
      plan.target.namespaceId !== target.namespaceId || plan.desiredHash !== hash(desired)) {
    throw new Error('Plan does not match the configuration or Cloudflare destination. Generate a new plan.');
  }
  const currentText = await client.read(SNAPSHOT_KEY);
  if (hash(currentText) !== plan.expectedHash) throw new Error('KV changed after planning. No write was made; generate a new plan.');
  const currentPlan = makePlan(currentText, desiredConfig, target);
  // Compare canonical data: formatting-only edits never produce remote writes.
  if (currentText !== null && canonicalConfig(parseConfig(currentText)) === desired) return {status: 'unchanged', diff: currentPlan.diff};
  if (currentPlan.diff.removed.length && !allowRemovals) throw new Error('Removing existing paths requires --allow-removals. No write was made.');
  if (desiredConfig.redirects.length === 0 && !allowEmpty) throw new Error('Publishing an empty map requires --allow-empty. No write was made.');
  // Local recovery copy first. One remote previous-snapshot slot, not an unbounded history.
  // Neither backup is exposed by the redirect Worker.
  await backup({target, previous: currentText, previousHash: hash(currentText), createdAt: new Date().toISOString()});
  if (currentText !== null) await client.write(BACKUP_KEY, currentText);
  // Recheck after backup work to narrow, not eliminate, the KV read/write race.
  if (hash(await client.read(SNAPSHOT_KEY)) !== plan.expectedHash) throw new Error('KV changed during preparation. Active snapshot was not changed.');
  // A single KV value avoids partially published per-path updates.
  await client.write(SNAPSHOT_KEY, desired);
  return {status: 'accepted', desiredHash: hash(desired), diff: currentPlan.diff};
}
export function cloudflareClient({accountId, namespaceId, token, fetcher = fetch}) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? '') || !/^[a-f0-9]{32}$/i.test(namespaceId ?? '')) {
    throw new Error('Set valid CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_KV_NAMESPACE_ID.');
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('CLOUDFLARE_API_TOKEN is required; never put it in links.json.');
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  async function request(url, method = 'GET', body) {
    let response;
    try {
      response = await fetcher(url, {
        method, body, redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: {Authorization: `Bearer ${token}`, ...(body === undefined ? {} : {'Content-Type': 'text/plain; charset=utf-8'})},
      });
    } catch {
      throw new Error(method === 'PUT'
        ? 'Cloudflare write outcome is uncertain. Do not retry blindly; inspect active/previous snapshots first.'
        : 'Cloudflare read failed. No active snapshot write was attempted by this request.');
    }
    return response;
  }
  return {
    async verifyNamespace() {
      const response = await request(base);
      if (!response.ok) throw new Error(`Cannot verify the dedicated namespace (HTTP ${response.status}).`);
      const data = await response.json();
      if (!data.success || data.result?.id !== namespaceId) throw new Error('Unexpected namespace verification response.');
    },
    async read(key) {
      const response = await request(`${base}/values/${encodeURIComponent(key)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Cloudflare read failed (HTTP ${response.status}).`);
      return response.text();
    },
    async write(key, value) {
      const response = await request(`${base}/values/${encodeURIComponent(key)}`, 'PUT', value);
      if (!response.ok) throw new Error(`Cloudflare write returned HTTP ${response.status}; inspect state before retrying.`);
      let data;
      try { data = await response.json(); } catch { throw new Error('Cloudflare write response was incomplete; inspect state before retrying.'); }
      if (!data.success) throw new Error('Cloudflare did not confirm the write; inspect state before retrying.');
    },
  };
}

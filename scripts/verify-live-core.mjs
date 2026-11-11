import {randomUUID} from 'node:crypto';

export async function verifyLive(config, {
  fetcher = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 4, delayMs = 25000, log = console.log,
} = {}) {
  async function request(path, method = 'GET') {
    return fetcher(config.publicOrigin + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(20000),
      headers: {'Cache-Control': 'no-cache'},
    });
  }
  async function checkRedirect(link, method = 'GET') {
    const response = await request(link.path, method);
    const ok = response.status === 302 && response.headers.get('location') === link.target &&
      response.headers.get('cache-control')?.includes('no-store');
    await response.body?.cancel();
    if (!ok) throw new Error('A public redirect does not match the generated snapshot.');
  }
  // Read-only verification retries account for KV propagation. Never retry sync.
  for (let attempt = 0; ; attempt++) {
    try {
      for (const link of config.redirects) await checkRedirect(link);
      if (config.redirects.length) await checkRedirect(config.redirects[0], 'HEAD');
      const absent = await request(`/verify-missing-${randomUUID()}`);
      const absentStatus = absent.status; await absent.body?.cancel();
      if (absentStatus !== 404) throw new Error('Unknown public path did not return 404.');
      const post = await request('/test', 'POST');
      const postStatus = post.status; await post.body?.cancel();
      if (postStatus !== 405) throw new Error('Public write method did not return 405.');
      log(`Public verification passed for ${config.redirects.length} redirect(s), HEAD, unknown path and blocked writes. This checks one network region.`);
      break;
    } catch (error) {
      if (attempt + 1 >= attempts) throw error;
      log('Waiting for propagation before a read-only verification retry.');
      await sleep(delayMs);
    }
  }
}

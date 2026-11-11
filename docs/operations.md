# Deployment and operations

## Before any live change

1. Confirm the Cloudflare account and that `vectorindex.cloud` is an active zone in it. Inspect **all existing DNS records, Worker routes and custom-domain bindings** affecting `s.vectorindex.cloud`. Stop if another service owns the hostname; do not replace or delete it automatically.
2. Confirm the chosen repository/visibility before adding non-public destinations. TOML is the source format; validated JSON is the generated KV format. A public Git repository exposes committed targets permanently in its history. The initial `/test` mapping points only to the public `https://vectorindex.cloud/` homepage.
3. Use a dedicated KV namespace and Worker for this service. Do not reuse another application’s namespace. Confirm the account plan and shared usage; do not upgrade to a paid plan without approval.
4. Creating or configuring a deployment/API credential or adding it to GitHub establishes persistent access and needs the appropriate explicit approval. Never paste credentials into chat, Git, URLs or logs. Use a securely provisioned environment secret.
5. Confirm live provisioning/deployment/domain changes are authorized. The local implementation and dry-run do not mean that production is deployed.

## Cloudflare resources

Use a dedicated namespace for `LINKS`. The committed Wrangler configuration deliberately has a placeholder namespace ID and no production route. `workers_dev` and preview URLs are disabled; observability logging is disabled by default.

After the hostname conflict check and approval, make an ignored `wrangler.production.jsonc` from the provided configuration with the verified namespace ID and this route:

```json
"routes": [{ "pattern": "s.vectorindex.cloud", "custom_domain": true }]
```

Cloudflare Custom Domains create the DNS record and certificate. Do not create placeholder DNS or delete an existing CNAME to force this through. Keep `PUBLIC_ORIGIN` and the config’s `publicOrigin` identical. The root domain and unrelated DNS must remain untouched.

A deployment identity needs the minimal relevant Worker/KV/domain permissions. A separate GitHub **sync** identity only needs Workers KV read/edit for the selected account; it does not need DNS, zone edit, Worker deploy, repository write or general administration. Cloudflare’s available token scopes may be account-wide rather than namespace-specific; review the actual scopes instead of claiming namespace isolation that the platform does not provide.

Sync reads these environment variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_KV_NAMESPACE_ID`
- `CLOUDFLARE_API_TOKEN`

The first two are identifiers, not passwords. The token stays in a secure environment secret. The tool verifies the namespace before accessing the active key and does not follow HTTP redirects when sending authorization.

## TOML to JSON migration

Edit only `links.toml`. `npm run links:build` parses TOML with Python 3.11+ `tomllib`, applies the existing shared validator, and writes `.local/links.json`. The active KV key remains `redirects:v1` and its schema is unchanged. Legacy JSON can still be read using `--file` for reviewed recovery workflows. No Worker deploy, DNS change, namespace creation, credential change or security-setting change is needed for format conversion.

Before first automated synchronization, compare the canonical generated JSON with the currently active snapshot and retain all live mappings. Do not assume repository data includes mappings written by another publisher. An unchanged snapshot produces no writes. Additions/retargets use the existing backup-and-single-write flow; missing paths fail unless removal is explicitly approved.

## Enable GitHub publishing

Configure the `short-links-production` environment and its approved Cloudflare secret. Add the verified account/namespace IDs as variables. Review who can edit `develop` and the workflow, because a trusted-branch editor can change code that runs with the sync credential. Keep PRs unprivileged; never switch to `pull_request_target` to expose secrets.

Set repository variable `SHORT_LINKS_SYNC_ENABLED=true` only after initial live setup and testing. The workflow serializes publishers, checks that its commit is the current develop head, converts and validates the TOML source, backs up the previous snapshot only when changed, and then replaces the active key once. It verifies public redirects afterward and records `accepted` or `unchanged` in the Actions summary. A skipped sync job does not prove automation is enabled. Do not run other publishers against this namespace.

Deletion and empty-map flags are deliberately not enabled on push. Workflow dispatch checkboxes exist for deliberate destructive changes. They require the workflow to exist on the default branch to appear in the GitHub UI; alternatively use the approved local workflow and keep automation paused during that operation.

## Recovery

The active key is `redirects:v1`. Its immediate predecessor is stored at `redirects:previous:v1`. The Worker never serves backup keys. The latest previous snapshot is retained until the next actual update; it is not a durable history or a guaranteed atomic rollback point under multiple writers.

Local plans, receipts and backups are in ignored `.local/`, written with owner-only permissions where supported. CI runners are ephemeral, so the remote previous snapshot is the durable fallback. No backup artifact is uploaded to GitHub.

To recover after a confirmed bad change, retrieve the previous snapshot privately, review it, save it as the chosen source configuration, generate a **new** plan, and apply through the sole publisher. Ensure that no newer intended update will be overwritten. Never restore automatically after an uncertain write. Do not use KV edits to promise instant emergency revocation; investigate a separately authorized Worker/route-level block if urgent.

## Live verification checklist

After existing-target preflight and snapshot acceptance:

Run `npm run links:build` then `npm run links:verify` for non-following, read-only public checks. These checks cannot prove all-region KV convergence. If a write has an uncertain outcome, inspect current/previous snapshots before any rerun; a failed public check alone is not permission to retry publishing.

- Confirm the intended Worker version and dedicated namespace binding.
- Verify DNS and TLS for `s.vectorindex.cloud`, without affecting the root domain.
- Add a specifically approved harmless test mapping and check its exact 302 Location with redirect-following disabled.
- Check HEAD, unknown-path 404, POST/PUT 405, query non-forwarding, and absence of public mapping/API routes.
- Wait for KV propagation and verify from more than one network region before claiming global availability.
- Update a test link, observe propagation, then remove it through an explicitly approved deletion flow.
- Confirm invalid config stops publishing and the previously accepted redirect still works.
- Report acceptance, regional behavior, CI and unresolved checks separately. Never describe a dry-run as a live deployment.

## Cost and platform limits

As checked in Cloudflare’s official documentation on November 8, 2026, the Free plan includes 100,000 KV reads/day, 1,000 writes/day and 1 GB of storage. These quotas are shared with the account’s other workloads. Paid accounts have different included allowances and overage charges. Every valid-path redirect attempt reads one snapshot; misses also count. Each changed publish normally uses two writes (previous and active), or one on first publish. No visitor-count writes are performed. Large snapshots impose more read/parse work, hence the application’s 1,000-link / 256-KiB cap.

A key allows at most one write per second. Keep publishing infrequent. This design is for a small, read-heavy personal redirect service; a high-concurrency management API would require stronger coordination.

Sources:

- [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/)
- [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [KV limits](https://developers.cloudflare.com/kv/platform/limits/)
- [Workers custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

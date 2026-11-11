# VectorIndex short links

A small Cloudflare Worker backed by Workers KV. Edit a project configuration file, validate it, then publish a complete redirect snapshot. The initial hostname is `https://s.vectorindex.cloud`.

**Status:** TOML authoring, validated JSON conversion, the redirect Worker and safe KV synchronization are implemented. Production automation still requires its explicitly enabled environment and verified existing credentials; a successful validation job alone is not proof of synchronization. The original Python/TinyURL client remains available as `main.py`.

## Configuration

`links.toml` is the single repository-managed source of truth. `npm run links:build` converts it to ignored `.local/links.json`; do not edit generated JSON. The Worker continues reading the existing JSON snapshot from KV without a redeploy. The configured public mappings are `/sean` → `https://vectorindex.cloud/`, `/sean/linkedin` → `https://www.linkedin.com/in/yuxiaoli/`, and `/sean/github` → `https://github.com/yuxiaoli`. The existing `/test` homepage mapping is retained. Primary social slugs consistently use the platform domain name without its suffix, such as `linkedin` and `github`; the previously shared `/sean/in` remains a compatibility alias. Add a platform only after its actual personal-profile URL is verified, never from a schema field or example URL. These are source definitions; production activation must be verified separately. This repository is public: committing a destination URL publishes it in Git and its history. Never commit private URLs, signed download links, embedded credentials, or tokens. Keep private mappings in ignored `links.local.toml`, or use an explicitly approved private repository before enabling GitHub publishing.

Example, using public destinations only:

```toml
schemaVersion = 1
publicOrigin = "https://s.vectorindex.cloud"

# Comments stay in this source file, not in the generated KV JSON.
[[redirects]]
path = "/home"
target = "https://example.com/"

[[redirects]]
path = "/docs/cloudflare"
target = "https://developers.cloudflare.com/workers/"
```

`/home` matches exactly and redirects to the saved URL. Paths are case-sensitive; `/home/` is not an alias. Nested paths work. Allowed path characters are ASCII letters, digits, `_`, `-`, and `/` separators, up to 160 characters. An explicit `/` entry is allowed; otherwise the root returns 404. Each path must occur once.

Targets must be complete HTTP(S) URLs. Domain, path, query and fragment are supported. The validator rejects credentials, control characters, local/IP-literal destinations, nonstandard ports, and this short-link hostname (to prevent direct loops). It does not fetch destinations or claim to detect phishing, DNS changes, or redirect loops on other sites. Only trusted maintainers should edit the map.

Limit: 1,000 links / 256 KiB per snapshot. These are intentional application limits, not Cloudflare’s maximums.

## Local checks

Node 22+ and Python 3.11+ are required for authoring/sync. TOML is parsed by Python's standard-library `tomllib`, then checked by the same JavaScript validator as the Worker. No parser package or runtime Worker dependency is added. The converter uses `python3` on Unix and `python` on Windows; set `PYTHON` to an executable path if needed. CI installs Python 3.12.

```sh
npm run check
npm run links:validate
npm run links:build
npm ci
npm run test:edge
```

`test:edge` bundles in dry-run mode and runs a real local workerd/KV test. It neither deploys nor contacts a production namespace. Wrangler is pinned in the lockfile. `npm run dev` starts local Wrangler, but the local KV must be seeded before a redirect can work.

For private local configuration:

```sh
npm run links:init
node scripts/sync.mjs validate --file links.local.toml
node scripts/convert.mjs --file links.local.toml --output .local/private-links.json
```

Initialization refuses to overwrite an existing file. Local configuration, sync plans, backups, credentials and production Wrangler configuration are ignored by Git.

## Redirect behavior

- GET/HEAD return 302 with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
- Incoming query parameters do not override or append to the saved destination.
- Unknown paths return 404; other methods return 405.
- Missing/corrupt/incompatible snapshots or KV failures return 503 without exposing details.
- There is no public create/update API, mapping listing, analytics, click counter or destination fetching. The application does not log target URLs or request data. Cloudflare still processes requests as the hosting provider.
- Short links are public redirects, **not access controls**. Anyone who has or guesses a path can retrieve its destination. Protect confidential destinations at the destination service.

## Safe sync

See [deployment and operations](docs/operations.md) before provisioning or enabling automation.

The publisher defaults to `links.toml`; legacy JSON remains supported through `--file path.json`. The converter validates the whole file before producing JSON. The publisher writes one KV value, `redirects:v1`. This avoids a per-link update partially succeeding. Invalid local input never writes. A local recovery copy and a single previous-snapshot KV slot are created before replacing an existing active snapshot.

Dry-run plan, followed by explicit application:

```sh
npm run links:plan
npm run links:apply
```

The plan records target IDs, content hashes and path-change counts. Destinations are not printed. Apply refuses changed local input, a changed remote snapshot, another public origin, or a different target namespace. Retargeting and additions are supported. Removing links requires `--allow-removals`; publishing an empty map also requires `--allow-empty`.

```sh
npm run links:apply -- --allow-removals
# Only when deliberately disabling every link:
npm run links:apply -- --allow-removals --allow-empty
```

**KV is eventually consistent and has no compare-and-swap.** Hash checks narrow races but are not an atomic lock. Use exactly one publisher for a namespace. GitHub publishing is serialized; local commands lock only their own checkout. Do not publish locally while automation is active. A changed map or revocation may take 60 seconds or more to appear everywhere; `no-store` prevents additional browser caching but cannot bypass KV replication.

Validation/read/backup errors stop before the active write. A timeout or ambiguous response during the active write means the outcome is **unknown**, not “unchanged.” Do not retry or roll back blindly; inspect the active and previous snapshots first. A successful response confirms acceptance, not global propagation.

## GitHub editing workflow

`.github/workflows/short-links.yml` validates PRs and relevant pushes to `develop`. Publishing is disabled unless repository variable `SHORT_LINKS_SYNC_ENABLED` is exactly `true` and the `short-links-production` environment is configured.

Once explicitly enabled with authorized credentials and a verified dedicated namespace, valid commits on current `develop` automatically convert `links.toml` to `.local/links.json`, synchronize that JSON, and verify the public redirects. The active key and JSON schema are unchanged. Comments/formatting-only edits result in `unchanged`, with no KV writes. The job summary distinguishes `accepted` from `unchanged`; a skipped sync job is not an activated publisher. Stale workflow reruns are rejected. Intentional rollback should be a new commit, not a rerun of an old job. No PR receives the publishing secret, and the workflow has read-only repository permissions.

Path removals stop automatic publishing. Deliberate removals can be applied by a manual workflow run with the relevant checkbox, or by the approved single local publisher. GitHub requires the workflow to exist on the repository’s default branch for the manual Actions dispatch UI; this repository currently defaults to `main`. Do not change that branch or its contents merely to bypass this setup decision.

To use the same pipeline locally only when it is the authorized sole publisher, run `npm run links:sync`. `npm run links:verify` is read-only: it verifies all generated mappings, HEAD, unknown-path 404 and POST 405, without following redirects. It retries only reads for propagation and covers one network region.

An empty map will not be published automatically. Only public homepage links and Sean's verified LinkedIn/GitHub profiles are bundled; no credentials or private destinations are included.

## Original Python client

The existing `main.py` still sends a supplied URL to TinyURL via `pyshorteners`. It is separate from the Cloudflare service:

```sh
pip install -r requirements.txt
python main.py https://example.com
```

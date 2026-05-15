# Release Readiness Check

This checklist is for preparing the DocumentDB MCP server for customer release as an internal product/package. It focuses on customer safety, operability, supportability, and predictable behavior rather than public open-source process.

## Must Have Before Customer Release

### 1. Destructive Operation Confirmations — DONE

Implemented for the four destructive tools below. Each tool requires the caller to retype the target resource name; the request is rejected if the confirmation value is missing or does not match exactly.

| Tool | Confirmation field | Must equal |
|------|--------------------|------------|
| `drop_database` | `confirm_db_name` | `db_name` |
| `drop_collection` | `confirm_collection_name` | `collection_name` |
| `drop_index` | `confirm_index_name` | `index_name` |

`rename_collection` is intentionally **not** confirmation-gated: it is reversible (rename back), `dropTarget: false` already prevents clobbering an existing target, and confirming the source name does not catch the realistic failure (typo in the destination name).

Implementation: [src/tools/utils/confirmations.ts](../src/tools/utils/confirmations.ts) (`assertConfirmationMatches`).

Tests: [test/tools/confirmations.test.ts](../test/tools/confirmations.test.ts) (helper unit tests) and reject-on-mismatch / reject-on-missing cases in [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts).

Multi-document writes (`delete_documents` / `update_documents` with `multi=true` and broad filters) are tracked separately in section 5 below.

### 2. Data Volume And Payload Limits — DONE

Configurable, fail-closed limits prevent a single accidental request from overloading the server, the backend, or the calling LLM context window.

Configurable env vars (defaults shown), all enforced at startup against Azure DocumentDB hard caps:

| Env var | Default | Hard cap | Enforcement point |
|---|---|---|---|
| `MAX_FIND_LIMIT` | `100` | `10000` | `find_documents.options.limit`, `explain_operation` (find branch) |
| `MAX_SAMPLE_SIZE` | `50` | `10000` | `sample_documents.sample_size` |
| `MAX_INSERT_BATCH_SIZE` | `100` | `25000` | `insert_documents` (array branch) |
| `MAX_RETURN_BYTES` | `1048576` (1 MiB) | `50331648` (48 MiB) | every tool response (`serializeResponse`) |
| `MONGODB_MAX_TIME_MS` | `30000` | `600000` (10 min) | `find`, `countDocuments`, `aggregate`, `findOneAndUpdate`, `$indexStats`, `$sample` |

Hard caps are sourced from the [Azure DocumentDB limitations doc](https://docs.azure.cn/en-us/documentdb/limitations) and enforced in [src/config.ts](../src/config.ts) (`BACKEND_HARD_LIMITS`). Misconfigured values fail fast at startup with an actionable message.

Implementation:
- [src/tools/utils/limits.ts](../src/tools/utils/limits.ts) — `clampPositiveInt`, `assertBatchSizeWithinLimit`, `serializeResponse`, `maxTimeMSOption`
- [src/config.ts](../src/config.ts) — `config.limits` section + `parseBoundedPositiveInt`
- Wired into all four tool files: [document-tools.ts](../src/tools/document-tools.ts), [collection-tools.ts](../src/tools/collection-tools.ts), [database-tools.ts](../src/tools/database-tools.ts), [index-tools.ts](../src/tools/index-tools.ts)

Tests:
- [test/config.test.ts](../test/config.test.ts) — defaults + 5 hard-cap rejections + bad-value rejections (9 tests)
- [test/tools/limits.test.ts](../test/tools/limits.test.ts) — helper-level positive/negative coverage (17 tests)
- [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts) — wiring tests proving each tool actually clamps / rejects / carries `maxTimeMS` (7 new tests)

Manual verification steps are in [docs/e2e-testing-guide.md](./e2e-testing-guide.md).

### 3. Per-Profile Database And Collection Restrictions — DONE

Connection profiles can optionally restrict which databases and collections a caller may target through that profile. Profiles without these fields keep prior behavior (unrestricted).

All three profile allowlists (`allowedRoles`, `allowedDatabases`, `allowedCollections[db]`) follow the same field semantics:

- **omitted (`undefined`)** → documented default (unrestricted for resources; `["read"]` for roles)
- **listed (`[...]`)** → narrow to exactly the listed entries
- **empty (`[]`)** → explicit deny-all (lock-to-nothing)

Profile fields:

| Field | Type | Behavior |
|---|---|---|
| `allowedDatabases` | `string[]` | Listed = only those databases; omitted = all databases; `[]` = explicit deny-all. |
| `allowedCollections` | `Record<db, string[]>` | Per-database collection allowlist. `allowedCollections[db]` listed = only those; omitted = all in that db; `[]` = explicit deny-all in that db. |

Example profile:

```json
{
  "prod-read": {
    "authMode": "entra",
    "endpoint": "example.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedHosts": ["*.mongocluster.cosmos.azure.com"],
    "allowedDatabases": ["fleet"],
    "allowedCollections": {
      "fleet": ["vehicles", "maintenance"]
    }
  }
}
```

Enforcement:

- Every tool call passing `db_name` and/or `collection_name` is checked by `withDbGuard` against the profile's allowlist before contacting the backend. Violations return `isError: true` with an actionable message naming the resource and the allowed list.
- `rename_collection` is checked twice: the source `collection_name` and the `new_collection_name` must both be allowed.
- `list_databases` is filtered server-side: a profile with `allowedDatabases` only sees those databases in the response; a profile with per-db `allowedCollections` only sees those collections when listing per-database.
- Tools that do not take `db_name` (e.g. `current_ops`) are unaffected — those are gated by management-role capability.

Pipeline namespaces — covered:

The allowlist is also applied to namespaces referenced *inside* aggregation pipelines via `assertPipelineNamespacesAllowed` ([src/tools/utils/pipelineNamespaces.ts](../src/tools/utils/pipelineNamespaces.ts)), wired into both `aggregate` and `explain_operation` (`operation=aggregate`). The walker recursively visits `$lookup.from` (string and `{db, coll}` form, plus nested `pipeline`), `$unionWith` (string and object form), `$graphLookup.from`, `$merge.into`, `$out`, and `$facet` sub-pipelines. Each referenced namespace is checked against gate [9] using `db_name` as the default database for stage forms that omit it. With the default `ALLOW_AGGREGATE_WRITE_STAGES=false`, `$out` and `$merge` are additionally blocked outright by `assertAggregatePipelineIsReadOnly`.

Implementation:
- [src/config.ts](../src/config.ts) — added `allowedDatabases` and `allowedCollections` to `ConnectionProfileConfig`
- [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts) — `assertResourceAllowed`, `getProfileScope`
- [src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts) — calls `assertResourceAllowed` for both source and rename-target before invoking the handler; deny path is audit-logged
- [src/tools/database-tools.ts](../src/tools/database-tools.ts) — `list_databases` filters its response by `getProfileScope`

Tests:
- [test/security/connectionProfiles.test.ts](../test/security/connectionProfiles.test.ts) — 9 new helper-level tests covering allow/deny matrix for db and collection allowlists, empty-array semantics, and `getProfileScope`
- [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts) — 8 new wiring tests proving each enforcement point: db-out-of-scope deny, collection-out-of-scope deny, allowed pass-through, `rename_collection` target check, `list_databases` filtering (both branches), and unchanged behavior when no allowlist is configured

Manual verification steps live in [docs/e2e-testing-guide.md](./e2e-testing-guide.md).

### 4. Per-Profile Role And Capability Restrictions — DONE

Connection profiles narrow which tool capability tiers (`read` / `write` / `management`) may be invoked through them. **Default-deny semantics**: a profile that omits `allowedRoles` is treated as `["read"]` (read-only). A profile with `allowedRoles: []` is **explicit deny-all** and permits no tiers (the profile becomes unusable). Operators must explicitly list `"write"` and/or `"management"` to opt into those tiers per profile. This is a profile-side ceiling — it never broadens the global capability flags or the caller's role.

Profile fields:

| Field | Type | Default | Behavior |
|---|---|---|---|
| `allowedRoles` | `("read" \| "write" \| "management")[]` | `["read"]` (when omitted) | Listed = exactly those tiers; omitted = `["read"]`; `[]` = explicit deny-all (no tiers). |

Example profiles:

```json
{
  "prod-read": {
    "authMode": "entra",
    "endpoint": "prod.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default"
  },
  "sandbox-write": {
    "authMode": "entra",
    "endpoint": "sandbox.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedRoles": ["read", "write"]
  },
  "sandbox-admin": {
    "authMode": "entra",
    "endpoint": "sandbox.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedRoles": ["read", "write", "management"]
  }
}
```

`prod-read` above has no `allowedRoles`, so it is read-only by default.

Enforcement:

- `withDbGuard` calls `assertProfileCapabilityAllowed(profileName, requiredRole)` after `assertAuthorized` and before `assertResourceAllowed`. Denials return `isError: true` with an actionable message naming the profile and the disallowed tier, and are routed through the existing audit-log deny path.
- One MCP server can safely expose multiple backends with different risk levels: production profiles silently default to read-only, while sandbox profiles opt into broader tiers.

Important — what this section does **not** cover:

- This is a **profile-side** ceiling, not a **caller-to-profile binding**. Two callers with the same role claim can both pick the same profile name; section 4 has no notion of "caller A may use `prod-read` but not `sandbox-admin`." That gap is tracked in [docs/gaps-on-rbac.md](./gaps-on-rbac.md) (Gap 1).

Implementation:
- [src/config.ts](../src/config.ts) — added `allowedRoles` to `ConnectionProfileConfig`
- [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts) — `assertProfileCapabilityAllowed` with default-deny (`["read"]`) for omitted `allowedRoles` and explicit deny-all for `[]`
- [src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts) — calls `assertProfileCapabilityAllowed` after `assertAuthorized`; deny path is audit-logged

Tests:
- [test/security/connectionProfiles.test.ts](../test/security/connectionProfiles.test.ts) — helper-level tests covering: omitted `allowedRoles` → read-only deny matrix, `[]` → explicit deny-all (even read), allow/deny by tier, and unknown-profile no-op
- [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts) — wiring tests covering: write-denied-by-`allowedRoles`, management-denied-by-`allowedRoles`, read-still-allowed pass-through, read-only-default when `allowedRoles` is omitted, and `allowedRoles: []` denies even read tools

Manual verification steps live in [docs/e2e-testing-guide.md](./e2e-testing-guide.md).

### 4a. Fine-Grained Data Exposure Controls — DONE (initial cut)

Customers should be able to precisely control what data the MCP server can expose, beyond coarse read/write/management roles. The current model gates by tool category, but customers want to gate by data scope as well.

The two controls in this section are **shipped**. A `readOnly` profile flag was considered but dropped as redundant: omitting `allowedRoles` already defaults the profile to `["read"]`, so authoring `allowedRoles: ["read"]` (or omitting it) provides the same enforcement without introducing a second knob to reason about. Additional fine-grained controls are tracked separately in [section 4b](#4b-additional-fine-grained-data-exposure-controls--future).

**Shipped:**

- **Pipeline namespace enforcement — DONE.** `assertPipelineNamespacesAllowed` ([src/tools/utils/pipelineNamespaces.ts](../src/tools/utils/pipelineNamespaces.ts)) recursively walks every aggregation pipeline submitted to `aggregate` or `explain_operation` and applies the per-profile resource scope (section 3) to every namespace referenced via `$lookup.from` (string and `{db, coll}` form, plus nested `pipeline`), `$unionWith`, `$graphLookup.from`, `$merge.into`, `$out`, and `$facet` sub-pipelines. Closes the cross-namespace read path that the top-level `db_name` / `collection_name` check missed. Tests: [test/tools/pipelineNamespaces.test.ts](../test/tools/pipelineNamespaces.test.ts) (15 helper tests) and 5 wiring tests in [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts).
- **Denied databases / collections (deny-wins blocklists) — DONE.** Symmetric to `allowedDatabases` / `allowedCollections`. Profile fields `deniedDatabases: string[]` and `deniedCollections: Record<db, string[]>` are checked *before* the allowlist, so deny always wins. Empty / omitted = no extra denials. `list_databases` honors the denylist when filtering its response. Implementation in [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts) and [src/tools/database-tools.ts](../src/tools/database-tools.ts).

Updated profile fields:

| Field | Type | Behavior |
|---|---|---|
| `deniedDatabases` | `string[]` | Listed = those databases are denied even if otherwise allowed; omitted/`[]` = no extra denials. Deny wins. |
| `deniedCollections` | `Record<db, string[]>` | Per-database collection blocklist. `deniedCollections[db]` listed = those collections denied; omitted/`[]` = no extra denials in that db. Deny wins. |

The goal is to let a customer safely expose a narrow, audited slice of their data through MCP without depending only on caller role claims. Defaults remain restrictive, and any rule violations fail closed with a clear error.

### 4b. Additional Fine-Grained Data Exposure Controls — FUTURE

Deferred fine-grained controls. None of these are blockers for the initial release; the shipped 4a controls (resource scope, denylists, pipeline namespace enforcement) cover the highest-risk data-exposure paths. Each item below is independent design + implementation work and can be picked up in a later release.

- Per-collection capability overrides (for example, `vehicles` is read-only even for write-capable callers)
- Field-level projection allowlist or denylist, so sensitive fields like `ssn`, `email`, or `password_hash` are never returned
- Mandatory query filter injection (for example, force `tenant_id` or `region` constraints on every query)
- Maximum result size and document size per profile or collection (currently only globally via `MAX_RETURN_BYTES`)
- Allowed aggregation stages per profile (e.g. deny `$lookup` entirely on a profile)
- Allowed update operators per profile (for example, deny `$rename` or `$unset` on prod profiles)

Example profile shape (combining what is shipped today with what is still planned):

```json
{
  "prod-support": {
    "authMode": "entra",
    "endpoint": "prod.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedRoles": ["read"],
    "allowedDatabases": ["fleet"],
    "allowedCollections": { "fleet": ["vehicles"] },
    "deniedCollections": { "fleet": ["audit_log"] },
    "deniedFields": { "fleet.vehicles": ["owner_ssn", "owner_email"] },
    "requiredFilter": { "fleet.vehicles": { "tenant_id": "${caller.tid}" } },
    "maxResultDocuments": 50
  }
}
```

(`allowedRoles`, `allowedDatabases`, `allowedCollections`, `deniedCollections` are enforced today; `deniedFields`, `requiredFilter`, and `maxResultDocuments` are illustrative of the 4b future direction.)

### 5. Full-Collection Operation Protection — DONE

`update_documents` and `delete_documents` reject calls that would touch every document in the collection unless the caller explicitly opts in. The trigger is **`multi: true` AND an empty filter (`{}`)**; single-document operations (`multi !== true`) are unaffected even with an empty filter.

New tool input field on both tools:

| Field | Type | Default | Behavior |
|---|---|---|---|
| `confirm_full_collection_operation` | `boolean` | `false` | Required to be `true` when `multi=true` and `filter={}`. Without it, the call is rejected with an actionable message before any backend connection is opened. |

Deny example payload (rejected):

```json
{ "connection_profile": "sandbox", "db_name": "fleet", "collection_name": "vehicles", "filter": {}, "multi": true }
```

Allow example payload (proceeds):

```json
{ "connection_profile": "sandbox", "db_name": "fleet", "collection_name": "vehicles", "filter": {}, "multi": true, "confirm_full_collection_operation": true }
```

Enforcement runs in `withDbGuard` **before** the Mongo connection is opened, so denials fail fast with no connect timeout. Implementation in [src/tools/utils/fullCollectionGuard.ts](../src/tools/utils/fullCollectionGuard.ts), wired via [src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts).

Tests:
- [test/tools/fullCollectionGuard.test.ts](../test/tools/fullCollectionGuard.test.ts) — 7 helper-level tests covering deny / allow with confirm / non-empty filter / multi=false / non-`true` confirm values
- [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts) — 5 wiring tests covering `delete_documents` and `update_documents` deny + allow paths

Manual verification steps live in [docs/e2e-testing-guide.md](./e2e-testing-guide.md).

### 6. Startup Configuration Validation — DONE

The server validates its full configuration at startup, **before** any transport, server, or tool is registered. Misconfiguration is reported as an aggregated error listing every problem found in one go (so operators see the full picture rather than playing whack-a-mole) and the process exits with code `1`.

Validation runs in two layers:

**Layer 1 — already validated during config parsing** ([src/config.ts](../src/config.ts)):

| Check | Behavior |
|---|---|
| Numeric env vars (`MAX_FIND_LIMIT`, `MAX_SAMPLE_SIZE`, `MAX_INSERT_BATCH_SIZE`, `MAX_RETURN_BYTES`, `MONGODB_MAX_TIME_MS`) | Must be positive integers and at or below the documented Azure DocumentDB hard caps (`BACKEND_HARD_LIMITS`). |
| `CONNECTION_PROFILES` JSON | Must parse and be a JSON object (not array, not scalar). Parse errors are wrapped with the offending env-var name. |
| `CONNECTION_PROFILES_FILE` path | If set and unreadable, throws `CONNECTION_PROFILES_FILE='<path>' could not be read: <reason>` instead of a raw `ENOENT`. |

**Layer 2 — `validateConfig`** ([src/security/configValidation.ts](../src/security/configValidation.ts)):

| Check | Failure example |
|---|---|
| `TRANSPORT` must be `stdio` \| `sse` \| `streamable-http` | `TRANSPORT='websocket' is invalid. Must be one of: stdio, sse, streamable-http.` |
| `PORT` must be an integer in `[1, 65535]` | `PORT=70000 is invalid. Must be an integer in [1, 65535].` |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` must be positive integers | `RATE_LIMIT_WINDOW_MS=NaN must be a positive integer.` |
| `AUTH_REQUIRED=true` requires `ENTRA_TENANT_ID` | `AUTH_REQUIRED=true requires ENTRA_TENANT_ID to be set.` |
| `AUTH_REQUIRED=true` requires `ENTRA_AUDIENCE` (or `ENTRA_CLIENT_ID`) | `AUTH_REQUIRED=true requires ENTRA_AUDIENCE (or ENTRA_CLIENT_ID) to be set.` |
| Profile `authMode` (when set) must be `'entra'` or `'connectionString'` | `Connection profile 'dev' has invalid authMode='oauth'.` |
| Entra profile must define `endpoint` (or `uri`) | `Connection profile 'prod' uses Entra authentication and must define endpoint (or uri).` |
| Entra profile must define `tokenScope` or `tokenResource` | `Connection profile 'prod' uses Entra authentication and must define tokenScope or tokenResource.` |
| Connection-string profile must define `uri` or `uriEnv` | `Connection profile 'dev' must define authMode=entra, uri, or uriEnv.` |
| `uriEnv` must point to an env var that is actually set | `Connection profile 'dev' references environment variable 'DEV_URI', which is not set.` |
| `allowedDatabases` / `deniedDatabases` / `allowedHosts` shape | Must be a string array; each element must be a string. |
| `allowedCollections` / `deniedCollections` shape | Must be `Record<db, string[]>`; each value must be a string array of strings. |
| `allowedRoles` shape | Must be a string array drawn from `read` \| `write` \| `management`. |

Empty arrays remain valid everywhere they were already meaningful (explicit deny-all semantics for `allowedDatabases`, `allowedRoles`, `allowedCollections[db]`).

Wired from [src/main.ts](../src/main.ts) — `validateConfig(config)` runs immediately after `config` is loaded, before `runServer()`. On failure the aggregated message is printed to stderr and the process exits with code `1`.

Tests:
- [test/security/configValidation.test.ts](../test/security/configValidation.test.ts) — 26 tests covering happy paths (stdio, entra with `tokenScope`, entra with `tokenResource`, `uriEnv` set), every failure mode in the table above, empty-array allowlist semantics, and aggregated multi-error reporting.
- Existing [test/config.test.ts](../test/config.test.ts) continues to cover Layer 1 (hard-cap rejections, defaults).

### 7. Health And Readiness Endpoints — DONE

For HTTP and SSE deployments, two operational probes are mounted at the top of the Express app, **before** auth and rate-limit middleware, so orchestration platforms (Kubernetes, ACA, etc.) can call them without bearer tokens at constant frequency.

| Endpoint | Purpose | Success | Failure |
|---|---|---|---|
| `GET /healthz` | Liveness — is the process responding to HTTP? | `200 {"status":"ok"}` | (process down → connection refused) |
| `GET /readyz`  | Readiness — is configuration loaded and structurally valid? | `200 {"status":"ready"}` | `503 {"status":"not_ready","error":"<aggregated message from validateConfig>"}` |

Behavior notes:

- `/healthz` is a pure liveness probe. It never touches `config` or any backend, so it remains `200` even if `validateConfig` would fail (a process that boots through startup validation and then has its config mutated to an invalid shape is still alive — just not ready).
- `/readyz` re-runs `validateConfig(config)` against the in-memory `config` on every call. The check is pure (no I/O beyond `process.env` reads for `uriEnv`) and returns in microseconds. **It does not open backend connections** per the original §7 guidance ("Avoid connecting to every customer database on every readiness probe unless this is configurable.").
- Both endpoints bypass the auth middleware (`requireHttpAuthentication`) and the rate-limit middleware (`createRateLimitMiddleware`) by virtue of mount order in `runHttpServer` / `runSseServer`.
- Only mounted on `streamable-http` and `sse` transports. Stdio transport has no listening port and uses process liveness as its own health signal.

Implementation:

- [src/health.ts](../src/health.ts) — `registerHealthRoutes(app, cfg?)` mounts both routes
- [src/server.ts](../src/server.ts) — called from both `runHttpServer` and `runSseServer` immediately after `express.json()` and before `createRateLimitMiddleware()` / `requireHttpAuthentication()`

Tests:

- [test/health.test.ts](../test/health.test.ts) — 5 tests booting a real Express app on an ephemeral port and issuing live HTTP requests via `node:http`:
  - `/healthz` returns `200 {status:'ok'}` on a healthy app
  - `/healthz` still returns `200` even when the supplied config is invalid (liveness ≠ readiness)
  - `/readyz` returns `200 {status:'ready'}` when config is valid
  - `/readyz` returns `503 {status:'not_ready', error}` and surfaces the aggregated `validateConfig` message when config is invalid
  - Mount-order check: a 401 catch-all middleware is installed after the health routes; both probes still return `200` while every other path returns `401`

### 8. Production Configuration Guide

Add customer-facing documentation for secure production setup.

Recommended topics:

- Entra app registration setup
- App role values and assignment
- Managed identity or workload identity for backend access
- Connection profile examples
- Multiple backend profiles
- How to enable write tools safely
- How to enable management tools safely
- Recommended defaults
- What not to do in production
- Audit logging behavior

### 9. Troubleshooting Guide

Add a support-focused troubleshooting guide for common customer issues.

Recommended scenarios:

- Missing bearer token
- Wrong `ENTRA_AUDIENCE`
- Wrong tenant ID
- Caller has no matching role claim
- Write tools are disabled
- Management tools are disabled
- Unknown connection profile
- Backend token acquisition failure
- Database connection failure
- Aggregation `$out` or `$merge` blocked
- Rate limit exceeded

### 10. CI And Release Validation

Every release candidate should pass automated validation.

### 11. Unit Test Coverage

Yes. Unit test coverage should be part of the customer release bar, especially for security gates, configuration parsing, and tool behavior.

Recommended minimum coverage areas:

- Authentication failures and success paths
- Role hierarchy and capability checks
- Connection profile resolution
- Profile allowlists and per-profile permissions, if added
- `withDbGuard` allow and deny behavior
- Audit allow and deny events
- Parameter parsing and validation helpers
- Destructive-operation confirmations
- Full-collection update/delete protection
- Read limit and payload limit enforcement
- Tool registration and required `connection_profile` input
- Representative tool handlers for read, write, and management operations

Suggested coverage goals:

- 80% overall line coverage as a practical release floor
- 90%+ coverage for security-sensitive modules
- Explicit tests for every new safety guard before release

Suggested package scripts:

```json
{
  "test": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

The release pipeline should fail if coverage drops below the agreed threshold or if safety-critical tests are removed.

Recommended release gate:

```bash
npm ci
npm run build
npm test
npm run test:coverage
```

Also consider adding:

- Format check
- Dependency vulnerability scan
- Static analysis / CodeQL-equivalent scan
- Secret scanning
- Package artifact validation
- Smoke test against a local Mongo-compatible backend

## Should Have Soon After

### 1. Stable Tool Contract Documentation

Document each MCP tool with:

- Purpose
- Required role
- Required capability flag
- Input schema
- Output shape
- Common failure modes
- Example requests
- Example responses

### 2. Standardized Error Shape

Return consistent error objects from tool failures.

Recommended shape:

```json
{
  "error": {
    "code": "WRITE_TOOLS_DISABLED",
    "message": "Write tools are disabled by server configuration."
  }
}
```

This helps customers and support teams diagnose issues without parsing arbitrary message text.

### 3. Safe Audit Logging Contract

Document and test that audit logs never include:

- Access tokens
- Authorization headers
- Connection strings
- Query result documents
- Customer secrets
- Raw credentials

Audit logs should include enough context for support without leaking sensitive data.

### 4. Integration Tests

Add optional integration tests against a local Mongo-compatible backend.

Recommended coverage:

- List databases
- Insert/find/update/delete documents
- Index create/list/drop
- Aggregation read behavior
- Blocking `$out` and `$merge` by default
- Connection profile resolution

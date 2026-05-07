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

Profile fields:

| Field | Type | Behavior |
|---|---|---|
| `allowedDatabases` | `string[]` | If set and non-empty, only listed databases may be targeted. Omitted or `[]` = no restriction. |
| `allowedCollections` | `Record<db, string[]>` | Per-database collection allowlist. If `allowedCollections[db]` is omitted, all collections in that db are allowed (subject to `allowedDatabases`). If set, only listed collections are allowed. |

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

Implementation:
- [src/config.ts](../src/config.ts) — added `allowedDatabases` and `allowedCollections` to `ConnectionProfileConfig`
- [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts) — `assertResourceAllowed`, `getProfileScope`
- [src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts) — calls `assertResourceAllowed` for both source and rename-target before invoking the handler; deny path is audit-logged
- [src/tools/database-tools.ts](../src/tools/database-tools.ts) — `list_databases` filters its response by `getProfileScope`

Tests:
- [test/security/connectionProfiles.test.ts](../test/security/connectionProfiles.test.ts) — 9 new helper-level tests covering allow/deny matrix for db and collection allowlists, empty-array semantics, and `getProfileScope`
- [test/tools/registeredTools.test.ts](../test/tools/registeredTools.test.ts) — 8 new wiring tests proving each enforcement point: db-out-of-scope deny, collection-out-of-scope deny, allowed pass-through, `rename_collection` target check, `list_databases` filtering (both branches), and unchanged behavior when no allowlist is configured

Manual verification steps live in [docs/e2e-testing-guide.md](./e2e-testing-guide.md).

### 4. Per-Profile Role And Capability Restrictions

Global read, write, and management flags are useful, but customers may need different permissions per backend profile.

Example profile shape:

```json
{
  "prod-read": {
    "authMode": "entra",
    "endpoint": "prod.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedRoles": ["read"],
    "allowWriteTools": false,
    "allowManagementTools": false
  },
  "sandbox-admin": {
    "authMode": "entra",
    "endpoint": "sandbox.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "allowedRoles": ["management"]
  }
}
```

This lets one MCP server safely expose multiple backends with different risk levels.

### 4a. Fine-Grained Data Exposure Controls

Customers should be able to precisely control what data the MCP server can expose, beyond coarse read/write/management roles. The current model gates by tool category, but customers want to gate by data scope as well.

Recommended fine-grained controls (composable, per profile):

- Allowed databases and collections (already covered in section 3)
- Denied databases and collections, for explicit blocklists
- Per-collection capability overrides (for example, `vehicles` is read-only even for write-capable callers)
- Field-level projection allowlist or denylist, so sensitive fields like `ssn`, `email`, or `password_hash` are never returned
- Mandatory query filter injection (for example, force `tenant_id` or `region` constraints on every query)
- Maximum result size and document size per profile or collection
- Allowed aggregation stages per profile, with destructive stages blocked by default
- Allowed update operators per profile (for example, deny `$rename` or `$unset` on prod profiles)
- Read-only mode flag at the profile level that disables all write/management tools regardless of caller role

Example profile shape:

```json
{
  "prod-support": {
    "authMode": "entra",
    "endpoint": "prod.mongocluster.cosmos.azure.com",
    "tokenScope": "https://ossrdbms-aad.database.windows.net/.default",
    "readOnly": true,
    "allowedDatabases": ["fleet"],
    "allowedCollections": { "fleet": ["vehicles"] },
    "deniedFields": { "fleet.vehicles": ["owner_ssn", "owner_email"] },
    "requiredFilter": { "fleet.vehicles": { "tenant_id": "${caller.tid}" } },
    "maxResultDocuments": 50
  }
}
```

The goal is to let a customer safely expose a narrow, audited slice of their data through MCP without depending only on caller role claims. Defaults should remain restrictive, and any field/filter rule violations should fail closed with a clear error.

### 5. Full-Collection Operation Protection

Block broad write operations by default, especially empty filters with multi-document writes or deletes.

Example confirmation pattern:

```json
{
  "filter": {},
  "multi": true,
  "confirm_full_collection_operation": true
}
```

Default behavior should reject full-collection updates/deletes unless the customer explicitly opts in.

### 6. Startup Configuration Validation

Validate configuration at startup and fail fast with actionable messages.

Recommended validation checks:

- Invalid `TRANSPORT`
- Invalid `PORT`
- `AUTH_REQUIRED=true` without `ENTRA_TENANT_ID`
- `AUTH_REQUIRED=true` without `ENTRA_AUDIENCE` or `ENTRA_CLIENT_ID`
- Malformed `CONNECTION_PROFILES`
- Profile file path is unreadable
- Entra profile missing `endpoint`/`uri`
- Entra profile missing `tokenScope` or `tokenResource`
- Invalid allowlist shape
- Invalid role/capability shape

### 7. Health And Readiness Endpoints

For HTTP and SSE deployments, add operational probes.

Recommended endpoints:

```text
GET /healthz
GET /readyz
```

`/healthz` should confirm the process is alive. `/readyz` should confirm configuration is loaded and structurally valid. Avoid connecting to every customer database on every readiness probe unless this is configurable.

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

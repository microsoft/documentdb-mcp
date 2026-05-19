# Permission Model

This document describes the role-based access control (RBAC) and permission model used by the DocumentDB MCP server. It enumerates every authorization gate applied to a tool call, the order in which they fire, the default for each, and how they compose. It is the source-of-truth view of "who is allowed to do what, against which resource, and why."

## Goals

The permission model is designed around four properties:

1. **Default safe.** A fresh install with no extra configuration accepts only the safest operations. Each broader capability requires an explicit opt-in.
2. **Multiple independent gates.** No single misconfiguration unlocks data. A caller must clear authentication, authorization, capability, profile-tier, and resource-scope checks before a tool runs.
3. **Narrow, never broaden.** Profile-level controls only narrow what's globally allowed; they never override a global "off" with a profile-level "on."
4. **Auditable failure.** Every deny is recorded with a reason, before the backend is contacted.

## Pipeline

Every tool call passing through `withDbGuard` ([src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts)) is checked in this exact order. The first gate that throws produces a deny audit event ([src/security/audit.ts](../src/security/audit.ts)) and is returned to the caller as `isError: true`. The backend is **not** contacted.

```
Tool invocation
   │
   ▼
[1] Transport-level authentication      (Entra JWT, HTTP only)
   │
   ▼
[2] Rate limit                          (per category, soon per caller)
   │
   ▼
[3] Tool-input schema validation        (Zod)
   │
   ▼
[4] connection_profile present?         (mandatory tool input)
   │
   ▼
[5] Global capability flag enabled?     assertCapabilityEnabled(requiredRole)
   │
   ▼
[6] Caller authorized for this tier?    assertAuthorized(requiredRole)
   │
   ▼
[7] Profile resolves?                   resolveConnectionProfile(name)
   │
   ▼
[8] Profile permits this tier?          assertProfileCapabilityAllowed(name, requiredRole)
   │
   ▼
[9] Profile permits this resource?      assertResourceAllowed(name, { db, collection })
   │   (also runs against new_collection_name for rename_collection)
   │
   ▼
[10] Tool-specific guards               assertConfirmationMatches, assertBatchSizeWithinLimit,
   │                                    assertAggregatePipelineIsReadOnly, clampPositiveInt, etc.
   │
   ▼
[11] Backend call                       withDocumentDBClient(...)
   │
   ▼
[12] Response size guard                serializeResponse() — hard cap on output bytes
```

## Layer-by-layer reference

### [1] Transport authentication — `auth.ts`

| Aspect    | Detail                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where     | [src/security/auth.ts](../src/security/auth.ts)                                                                                                    |
| Default   | `AUTH_REQUIRED=false` (off). Production deployments must set `AUTH_REQUIRED=true`.                                                                 |
| Scope     | HTTP transport only. Stdio bypasses this entirely (the stdio process is implicitly trusted; see [docs/gaps-on-rbac.md](./gaps-on-rbac.md), Gap 2). |
| Inputs    | `Authorization: Bearer <jwt>` header.                                                                                                              |
| Validates | Issuer, audience, signature, expiry against `ENTRA_TENANT_ID` / `ENTRA_AUDIENCE`.                                                                  |
| On deny   | HTTP 401. The request never reaches the tool layer.                                                                                                |

This is where caller identity is established. Everything downstream reads claims from `getRequestContext()` ([src/security/requestContext.ts](../src/security/requestContext.ts)).

### [2] Rate limit — `rateLimit.ts`

| Aspect  | Detail                                                    |
| ------- | --------------------------------------------------------- |
| Where   | [src/security/rateLimit.ts](../src/security/rateLimit.ts) |
| Default | enabled, configurable window/budget                       |
| Scope   | per tool category (read / write / management)             |
| On deny | `isError: true` with rate-limit message                   |

Today this is keyed by category, not by caller. Per-caller rate limiting is a known gap ([docs/gaps-on-rbac.md](./gaps-on-rbac.md), Gap 6).

### [3] Tool-input schema validation

| Aspect  | Detail                                                   |
| ------- | -------------------------------------------------------- |
| Where   | each tool registration in `src/tools/*-tools.ts`         |
| Default | Zod schema rejects malformed input before any guard runs |
| On deny | `isError: true` with schema error                        |

Catches bad types, missing required fields, etc. Not a security boundary on its own but it normalizes input so downstream guards see well-formed values.

### [4] Connection profile resolution

| Aspect  | Detail                                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Where   | [src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts)                                                                  |
| Default | HTTP/SSE tools require `connection_profile`; local stdio can use `DEFAULT_CONNECTION_PROFILE` or the sole configured profile |
| On deny | `isError: true`, message `connection_profile is required`                                                                    |

The server is stateless — there is no mutable "current connection." Enterprise calls must name their profile explicitly. Local personal stdio usage may resolve a stable default profile from startup configuration, but tools still never accept runtime connection strings.

### [5] Global capability flag — `assertCapabilityEnabled`

| Aspect   | Detail                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| Where    | [src/security/authorization.ts](../src/security/authorization.ts)                                             |
| Inputs   | `ENABLE_READ_TOOLS`, `ENABLE_WRITE_TOOLS`, `ENABLE_MANAGEMENT_TOOLS` env vars                                 |
| Defaults | read = on, write = **off**, management = **off**                                                              |
| Effect   | If the global flag for a tier is off, every tool of that tier is rejected for every caller and every profile. |
| On deny  | "Write tools are disabled by default. Set `ENABLE_WRITE_TOOLS=true` to opt in." (or equivalent)               |

This is the **operator switch**: the only way to turn whole tool tiers on. Nothing downstream can override an off here.

### [6] Caller role check — `assertAuthorized`

| Aspect                                    | Detail                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Where                                     | [src/security/authorization.ts](../src/security/authorization.ts)                                                        |
| Inputs                                    | `roles` / `groups` / `scopes` claims from the JWT, mapped via `ENTRA_ROLE_*` env vars to `read` / `write` / `management` |
| Default (HTTP, AUTH_REQUIRED=true)        | caller must have a claim that maps to the required tier; no claim = deny                                                 |
| Default (stdio, or `AUTH_REQUIRED=false`) | bypassed                                                                                                                 |
| Role hierarchy                            | management > write > read; a caller mapped to a higher tier implicitly satisfies lower tiers                             |
| On deny                                   | "Caller is not authorized for '\*' MCP tools."                                                                           |

This is the **identity-side check**: does this specific caller have a claim granting the required tier?

### [7] Profile resolution — `resolveConnectionProfile`

| Aspect  | Detail                                                                      |
| ------- | --------------------------------------------------------------------------- |
| Where   | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts) |
| Inputs  | `CONNECTION_PROFILES` env var                                               |
| On deny | "Unknown connection profile '\*'."                                          |

Not strictly a permission check, but the resolution can fail (unknown profile name, missing `tokenScope` for Entra profiles, missing referenced env var). Failures here also produce a deny audit entry.

### [8] Profile capability tier — `assertProfileCapabilityAllowed`

| Aspect  | Detail                                                                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where   | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts)                                                                         |
| Inputs  | `allowedRoles` on the resolved profile                                                                                                              |
| Default | omitted → effective `["read"]` (**read-only by default**); `[]` → **explicit deny-all** (no tiers, profile unusable); `[...]` → exactly those tiers |
| Effect  | Narrows what the _profile_ permits; cannot broaden the global flag or the caller's role                                                             |
| On deny | "Tool tier 'write' is not allowed for connection profile 'dev'. Allowed tiers: read." (or `(none)` for `[]`)                                        |

This is the **profile-side ceiling**: even when the global flag is on and the caller has the role, a profile that doesn't list the tier rejects the call. See [release-readiness-check.md](./release-readiness-check.md) §4.

### [9] Profile resource scope — `assertResourceAllowed`

| Aspect  | Detail                                                                                                                                                                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where   | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts)                                                                                                                                                                     |
| Inputs  | `allowedDatabases`, `allowedCollections`, `deniedDatabases`, `deniedCollections` on the resolved profile, plus tool-input `db_name`, `collection_name`, `new_collection_name`                                                                   |
| Default | omitted = unrestricted; `[]` = **explicit deny-all** (allowlists); `[...]` = narrow to listed entries (uniform with `allowedRoles`). Denylists are pure overlays — omitted/`[]` = no extra denials, `[...]` = those entries denied (deny wins). |
| Effect  | Per-profile allowlist + denylist of databases and per-database collections. Denylist runs first, so `denied*` always wins over `allowed*`.                                                                                                      |
| On deny | "Database 'secrets' is not allowed for connection profile 'dev'. Allowed databases: fleet." (or `(none)` for `[]`); for denylist hits: "Database 'secrets' is denied for connection profile 'dev'."                                             |

For `rename_collection`, the source and destination collection names are both checked.

`list_databases` additionally filters its **response** by the same scope ([src/tools/database-tools.ts](../src/tools/database-tools.ts)) so callers cannot enumerate databases or collections outside the allowlist or that are explicitly denied.

For `aggregate` and `explain_operation` (`operation=aggregate`), this gate is also applied recursively to every namespace referenced from inside the pipeline — see gate [10] (`assertPipelineNamespacesAllowed`). The top-level `db_name` / `collection_name` check no longer leaves the pipeline-internal cross-namespace path open.

### [10] Tool-specific guards

| Guard                               | Tool(s)                                                                 | What it enforces                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertConfirmationMatches`         | `drop_database`, `drop_collection`, `drop_index`                        | Caller must retype the target name in a confirmation field                                                                                                                                                                              |
| `assertBatchSizeWithinLimit`        | `insert_documents`                                                      | Array length ≤ `MAX_INSERT_BATCH_SIZE`                                                                                                                                                                                                  |
| `assertAggregatePipelineIsReadOnly` | `aggregate`, `explain_operation`                                        | Rejects `$out` / `$merge` unless `ALLOW_AGGREGATE_WRITE_STAGES=true`                                                                                                                                                                    |
| `assertPipelineNamespacesAllowed`   | `aggregate`, `explain_operation` (`operation=aggregate`)                | Recursively walks every aggregation pipeline (`$lookup`, `$unionWith`, `$graphLookup`, `$merge`, `$out`, `$facet` sub-pipelines) and applies gate [9] to every referenced namespace. Closes the pipeline-internal cross-namespace path. |
| `assertFullCollectionOpAllowed`     | `update_documents`, `delete_documents`                                  | Rejects `multi=true` with an empty filter (`{}`) unless `confirm_full_collection_operation=true`. Runs in `withDbGuard` pre-connection.                                                                                                 |
| `clampPositiveInt`                  | `find_documents`, `sample_documents`, `explain_operation` (find branch) | Caps `limit` / `sample_size` at configured maxima                                                                                                                                                                                       |
| `maxTimeMSOption`                   | every read query                                                        | Adds `maxTimeMS` to backend operations to prevent runaway queries                                                                                                                                                                       |

These run **after** all permission gates, against a request that is already authenticated, authorized, and in scope.

### [11] Backend call

`withDocumentDBClient(connection, handler)` ([src/context/documentdb.ts](../src/context/documentdb.ts)) opens a connection (or reuses a cached one), invokes the handler, and returns the result.

For Entra profiles, the connection itself is gated by `allowedHosts` (a Mongo-driver-level allowlist of cluster hostnames) — defense in depth against a profile being pointed at the wrong cluster.

### [12] Response size guard — `serializeResponse`

| Aspect  | Detail                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Where   | [src/tools/utils/limits.ts](../src/tools/utils/limits.ts)                                                                                    |
| Default | `MAX_RETURN_BYTES = 1 MiB` (hard cap 48 MiB)                                                                                                 |
| Effect  | Wraps every tool response. If serialization exceeds the cap, the call is converted to a `isError: true` response with an actionable message. |

This protects the calling LLM context window and prevents oversized responses from leaving the server even after backend execution succeeded.

## Default end-to-end behavior

A fresh install (`AUTH_REQUIRED=false`, default env, default profile) gives a stdio caller:

| Tool tier  | Result                                                    |
| ---------- | --------------------------------------------------------- |
| Read       | ✅ allowed                                                |
| Write      | ❌ rejected at gate [5] (`ENABLE_WRITE_TOOLS=false`)      |
| Management | ❌ rejected at gate [5] (`ENABLE_MANAGEMENT_TOOLS=false`) |

If the operator sets `ENABLE_WRITE_TOOLS=true` but does not list `write` in the profile's `allowedRoles`:

| Tool tier  | Result                                                   |
| ---------- | -------------------------------------------------------- |
| Read       | ✅ allowed                                               |
| Write      | ❌ rejected at gate [8] (profile defaults to `["read"]`) |
| Management | ❌ rejected at gate [5]                                  |

To make a profile fully capable, the operator must:

1. Set both `ENABLE_WRITE_TOOLS=true` and `ENABLE_MANAGEMENT_TOOLS=true` globally
2. Set the profile's `allowedRoles: ["read", "write", "management"]`
3. (HTTP only) Configure Entra app roles and assign them to the caller
4. Optionally narrow with `allowedDatabases` / `allowedCollections`

## Composition rules

The layers are **AND-composed**: every gate must pass for the call to proceed. There is no "OR" anywhere in the pipeline. Concretely:

- Global flag `OFF` ⇒ deny, regardless of caller role or profile config.
- Caller role missing ⇒ deny, regardless of global flag or profile config.
- Profile tier missing ⇒ deny, regardless of caller role or global flag.
- Profile resource not in scope ⇒ deny, regardless of all of the above.

There is no escalation path: a more permissive layer cannot override a stricter one. Section 8 (profile capability) and section 9 (profile resource scope) **only narrow**.

Within a single layer, the rule for combinations is:

- **Uniform field semantics across `allowedRoles` / `allowedDatabases` / `allowedCollections[db]`:** `undefined` → documented default; `[...]` → narrow to listed; `[]` → **explicit deny-all** (lock-to-nothing). The deny-all case is rare in practice but lets operators express "this profile sees nothing" without inventing a sentinel.
- **Denylist precedence:** `deniedDatabases` / `deniedCollections[db]` are deny-wins overlays on top of the corresponding allowlist. They are checked _before_ the allowlist, so an entry listed in both is denied.
- **Profile resource scope (`assertResourceAllowed`):** an undefined `allowedDatabases` / `allowedCollections[db]` is unrestricted; `[]` is explicit deny-all; per-collection check only runs once the database itself passes.

## What the model does _not_ yet cover

These are tracked in [docs/gaps-on-rbac.md](./gaps-on-rbac.md) — listed here so the model is honest about its boundaries:

- **Caller-to-profile binding.** Two callers with the same role claim can pick the same profile. Profile names are not secrets.
- **Stdio identity.** Stdio transport bypasses gates [1] and [6]. Trust boundary is the operator process.
- **Field/filter-level controls.** Gate [9] stops at the collection boundary. Field denylists, mandatory filter injection, etc. are tracked under [release-readiness-check.md](./release-readiness-check.md) §4a.
- **Per-caller rate limit.** Gate [2] is per category, not per caller.
- **Hot reload of profile changes.** Profiles load once at startup; changes require a restart.

## Quick reference: where each control lives

| Question                                    | Layer | File                                                                                                  |
| ------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Is the request authenticated?               | [1]   | [src/security/auth.ts](../src/security/auth.ts)                                                       |
| Is the tier globally enabled?               | [5]   | [src/config.ts](../src/config.ts) + [src/security/authorization.ts](../src/security/authorization.ts) |
| Does this caller have the role?             | [6]   | [src/security/authorization.ts](../src/security/authorization.ts)                                     |
| Is the profile valid?                       | [7]   | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts)                           |
| Does this profile allow this tier?          | [8]   | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts)                           |
| Does this profile allow this db/collection? | [9]   | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts)                           |
| Tool-specific safety (confirmations, caps)  | [10]  | [src/tools/utils/](../src/tools/utils/)                                                               |
| Response too large?                         | [12]  | [src/tools/utils/limits.ts](../src/tools/utils/limits.ts)                                             |
| Where are denials logged?                   | every | [src/security/audit.ts](../src/security/audit.ts)                                                     |

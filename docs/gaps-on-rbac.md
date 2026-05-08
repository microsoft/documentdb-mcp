# Gaps In Role-Based Access Control

This note captures known gaps in the DocumentDB MCP server's authorization model as of section 3 (per-profile resource allowlists) being merged. It is intentionally narrow: it tracks *what's missing*, why it matters, and which checklist items would close it. Implementation is out of scope here.

## What's in place today

| Layer | Where | What it gates |
|---|---|---|
| Bearer token validation (Entra) | [src/security/auth.ts](../src/security/auth.ts) | HTTP transport requires a valid Entra JWT when `AUTH_REQUIRED=true`. Issuer, audience, signature, expiry are all checked. |
| Capability buckets from `roles` claim | [src/security/authorization.ts](../src/security/authorization.ts) | `ENTRA_ROLE_*` env vars map app-role values → `read` / `write` / `management`. `assertAuthorized` rejects calls whose required capability isn't granted by the caller's roles. |
| Per-profile resource allowlist | [src/security/connectionProfiles.ts](../src/security/connectionProfiles.ts), [src/tools/utils/dbGuard.ts](../src/tools/utils/dbGuard.ts) | If a profile sets `allowedDatabases` / `allowedCollections`, calls outside that scope are denied (and `list_databases` is filtered). |

This is real defense — it correctly blocks unauthenticated callers, callers without a role claim, and in-scope callers from escaping the profile's data scope.

## Gap 1: Caller cannot be bound to a profile

**What's missing.** A caller picks `connection_profile` by name on every tool call. The server does not check whether *this specific caller* is allowed to pick *this specific profile*. As long as the caller has the right capability bucket (e.g. `management`), they can target any profile loaded into the server.

**Why it matters.** Profile names are not secrets. They appear in logs, error messages, client configs, source control. A caller with `management` who guesses or learns the name of an admin profile (e.g. `ops-admin`) can drive admin operations against backends that were never intended for them. This is the "shared MCP server, multiple tenants/teams" failure mode.

**Why the existing layers don't cover it.**
- Entra token auth proves *identity*, but the capability mapping is global to the server — not scoped to a profile.
- Per-profile resource allowlists (section 3) limit *what* a profile can touch, not *who* can pick it.
- Section 4 as currently drafted (`allowedRoles`) narrows what the *profile* permits — still profile-centric, not caller-centric.

**Closes when.** A new control is added that, at `resolveConnectionProfile` time, checks the caller's claims against a per-profile binding. Two reasonable shapes:

1. **Role-based binding** — profile declares `requiredRoles: ["DocumentDB.Admin"]`; resolver checks the caller's `roles` claim. Composes naturally with the existing app-role model. Recommended default.
2. **Subject/group binding** — profile declares `allowedPrincipals: ["<oid>", "<groupId>"]`; resolver checks `oid` / `sub` / `groups`. More precise, more config to maintain.

Either should fail closed with "profile not found" rather than "forbidden" so the existence of restricted profiles isn't leaked.

## Gap 2: stdio transport has no caller identity at all

**What's missing.** Stdio transport bypasses Entra entirely — the `Authorization` header pipeline only runs for HTTP. Anything with stdio access is implicitly "the operator" and can call any tool against any profile, subject only to the global capability flags.

**Why it matters in practice.** Usually this is fine: stdio MCP servers are local subprocesses launched by a single trusted client (an editor/agent). They share the operator's trust boundary. The operator could read `CONNECTION_PROFILES` directly anyway.

**Why it can still bite.** If a stdio server is launched with admin profiles loaded "just in case," any agent prompt-injection or local process that can write to the stdio socket inherits that authority. Mitigation is operational rather than code-level: don't co-locate admin profiles with constrained profiles in the same process — run two server instances.

**Closes when.** Production guide (section 8) explicitly documents the stdio trust model and recommends per-profile-set process isolation for sensitive backends.

## Gap 3: Profile changes require a process restart

**What's missing.** `CONNECTION_PROFILES` is read once at startup and cached in the singleton config ([src/config.ts](../src/config.ts)). There is no SIGHUP, no file watcher, no admin tool to mutate profiles at runtime. Every change — adding a profile, tightening an allowlist, rotating a credential — needs a restart.

**Why it matters.** For credential rotation under incident response, restart-to-rotate is operationally heavy and tends to drift toward "we'll rotate next maintenance window." For allowlist tightening (e.g. quickly revoking access to a collection), the same applies.

**Why it's acceptable today.** Profiles carry credentials. Treating them as immutable deployment config is the conservative default. The Kubernetes-style answer ("redeploy to change") is a real, legitimate model.

**Closes when.** Either of the following is added:
- `CONNECTION_PROFILES_FILE` as an alternative to the env var, watched via `fs.watch`. Ops mounts a Kubernetes Secret or Key Vault CSI volume; updates apply on the next idle moment.
- SIGHUP handler that re-runs the loader and atomically swaps the cached map.

Hot reload is *not* required for the current release; documenting the restart-to-rotate expectation in the production guide is sufficient for v1.

## Gap 4: Credentials and non-secret config share one blob

**What's missing.** A profile mixes a connection URI / Entra credential with non-secret structured config (allowlists, role bindings). Today both live together in `CONNECTION_PROFILES`. That's awkward operationally:
- Tweaking an allowlist forces a touch on the secret store (if you're using one).
- Auditing "who changed the role binding" mixes with "who rotated the password."
- Env-var delivery for secrets is widely considered weak (env leaks into crash dumps, child processes, `/proc`).

**Closes when.** The loader supports composing a profile from two sources — secret material from a secret store / mounted secret file, non-secret scope/role/allowlist material from a ConfigMap or plain file. This is the standard split (Envoy bootstrap, OPA bundles, Dapr components all work this way). Not blocking for v1.

## Gap 5: No field-level or filter-level controls

**What's missing.** Section 3 stops at the collection boundary. A caller scoped to `fleet.vehicles` can still read every field of every document and run arbitrary aggregation pipelines.

**Already tracked.** Section 4a ("Fine-Grained Data Exposure Controls") in the readiness checklist enumerates the recommended controls: field denylists, mandatory filter injection, allowed aggregation stages, allowed update operators, per-collection capability overrides, per-profile read-only flag.

**Closes when.** Section 4a is implemented.

## Gap 6: No rate limiting per caller

**What's missing.** [src/security/rateLimit.ts](../src/security/rateLimit.ts) gates by tool category, not by caller identity. A misbehaving caller cannot be throttled independently of well-behaved ones. Token-claim-aware rate limiting (per `oid` or per app-role) is not implemented.

**Closes when.** Rate limiter is keyed by request context principal in addition to category.

## Gap 7: Aggregation pipelines bypass the per-profile resource allowlist

**What's missing.** Section 3's allowlist is enforced against the top-level `db_name` / `collection_name` tool inputs in `withDbGuard`. It is not applied to namespace references *inside* an aggregation pipeline. A caller scoped to `fleet.vehicles` can still reach other collections via `$lookup.from`, `$lookup.pipeline` (recursive), `$unionWith`, `$graphLookup.from`, or `$facet` sub-pipelines. With `ALLOW_AGGREGATE_WRITE_STAGES=true` the same gap applies to `$merge.into` / `$out` writes.

**Why it matters.** The whole point of the allowlist is that a profile cannot reach data outside its declared scope. `$lookup` to a sibling collection in the same database silently returns that data joined into the response.

**Why the existing layers don't fully cover it.**
- `assertResourceAllowed` only sees the tool-input namespace, not pipeline-internal namespaces.
- `assertAggregatePipelineIsReadOnly` ([src/tools/document-tools.ts](../src/tools/document-tools.ts)) blocks `$out` and `$merge` by default, which closes the cross-namespace **write** path with default settings — but does nothing for read-side cross-namespace stages.
- Section 4a's "allowed aggregation stages" bullet would close the gap only by banning `$lookup` / `$unionWith` / `$graphLookup` outright, which is too blunt for most workloads.

**Closes when.** A recursive pipeline-namespace walker is added (tracked in readiness checklist section 4a as "Pipeline namespace enforcement"). It should:
- Walk every pipeline submitted to `aggregate` and `explain_operation` (with `operation=aggregate`).
- Extract every namespace referenced via `$lookup.from`, `$lookup.pipeline` (recurse), `$unionWith` (string and `{ db, coll, pipeline }` forms; recurse into `pipeline`), `$graphLookup.from`, `$merge.into`, `$out`, and `$facet` sub-pipelines (recurse).
- Run each extracted `(db, coll)` through `assertResourceAllowed` against the resolved profile, defaulting `db` to the tool-input `db_name` when the stage omits it.
- Fail closed with the same audit-logged deny path used by the top-level check.

Until that lands, customers needing strict pipeline-level scoping should disable the `aggregate` tool on restricted profiles or rely on backend-side RBAC at the DocumentDB account.

## Recommended sequencing

For the v1 release readiness pass:

1. **Required.** Add **Caller-To-Profile Binding** (Gap 1) as a new section 4b in the readiness checklist. This is the only gap above that materially changes the security posture and is small to implement.
2. **Required.** Document **stdio trust model** (Gap 2) in the production guide (section 8). No code change.
3. **Required.** Document **restart-to-rotate** expectation (Gap 3) in the production guide. No code change.
4. **Required.** Land **Pipeline namespace enforcement** (Gap 7) — self-contained walker plus wiring for `aggregate` and `explain_operation`. Without it, the section 3 allowlist over-promises.
5. **Should-have soon after.** Section 4a fine-grained controls (Gap 5).
6. **Nice-to-have.** Hot reload, split secret/config sources, per-caller rate limiting (Gaps 3, 4, 6).

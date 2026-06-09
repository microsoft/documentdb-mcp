# DocumentDB MCP Server Release & Distribution Design (1-Pager)

Status: Draft for discussion. Owner: DocumentDB MCP team. Audience: PM (Product Management) + Eng (Engineering) leads

## 1. Problem

The DocumentDB MCP Server today is shipped as source / `npx github:microsoft/documentdb-mcp` for users to run locally against any MongoDB-compatible DocumentDB. This is fine for early adopters but does not scale for the Azure managed DocumentDB customer base, where customers expect a turnkey, governed, low-latency MCP endpoint that integrates with their cluster, identity, and networking. We need a distribution strategy that covers self-hosted users **and** managed Azure DocumentDB users without forking the codebase.

## 2. Goals / Non-Goals

**Goals:** (1) One codebase, multiple deployment shapes. (2) Zero-touch onboarding for managed Azure DocumentDB users. (3) Entra ID auth end-to-end; no DB passwords in the client. (4) Per-tenant isolation and auditable access. (5) Co-location with the customer's cluster VM (same compute, loopback to the gateway) for the managed offering.

**Non-Goals:** Re-implementing the MCP protocol; supporting non-DocumentDB backends; replacing the local stdio experience for developers.

## 3. Distribution Options

### 3.1 Distribution Channels (where we publish)

Channels are *where* the same self-host binary is discoverable. They are not separate deployment topologies; the binary published to each channel is identical. Discoverability across AI tool marketplaces is critical because that is where customers shop for MCP servers today. Aim to be present in every relevant registry on day 1.

| # | Channel | What we publish | Audience | Priority |
| - | ------- | --------------- | -------- | -------- |
| 1 | **Anthropic MCP Registry** (the official `modelcontextprotocol/servers` index and Claude Desktop / Claude Code directory) | Server manifest + install JSON | Claude users | P0 |
| 2 | **VS Code MCP Gallery** (the curated MCP servers list surfaced by GitHub Copilot and VS Code's "Add MCP server" UI) | `vscode://mcp/install` deep link + manifest | Copilot / VS Code users | P0 |
| 3 | **GitHub Copilot Coding Agent / Copilot CLI** MCP catalog | Same install JSON | Copilot users outside VS Code | P0 |
| 4 | **OpenAI Apps / GPT Store / ChatGPT MCP connector directory** (OpenAI adopted MCP for ChatGPT desktop and the Responses API) | MCP server endpoint + OAuth / Entra config | ChatGPT and OpenAI API users | P0 |
| 5 | **Cursor** MCP directory (`mcp.json` install button) | Install button + manifest | Cursor users | P0 |
| 6 | **Azure Marketplace** | 1-click VM / Container App / AKS offer (ARM/Bicep) into customer subscription | Azure customers with procurement / EA needs | P0 |
| 7 | **Microsoft Container Registry (MCR)** | Signed OCI (Open Container Initiative) container image | AKS, Container Apps, `docker run` | P0 |
| 8 | **npm registry** (`@microsoft/documentdb-mcp-server`) | Node package consumable via `npx` | Any MCP client that spawns over stdio | P0 |
| 9 | **GitHub** (`microsoft/documentdb-mcp`) | Source + signed release artifacts + SBOM | OSS / on-prem / air-gapped | P0 |
| 10 | **Docker Hub** | Mirror of the MCR image | Non-Azure container users | P1 |
| 11 | **Smithery.ai** (community MCP registry / installer) | Server manifest | Cross-client MCP users | P1 |
| 12 | **PulseMCP / Glama / mcp.so** community indexes | Server manifest + README | Community discovery / SEO (Search Engine Optimization) | P1 |
| 13 | **Windsurf / Codeium** MCP catalog | Install manifest | Windsurf users | P1 |
| 14 | **Cline, Continue, Zed** MCP catalogs | Install manifest | Open-source AI IDE users | P1 |
| 15 | **Microsoft AI Toolkit for VS Code** built-in MCP catalog | Same VS Code manifest | Microsoft AI Toolkit users | P1 |
| 16 | **AWS Marketplace** (DocumentDB also runs on AWS) | Container image + CloudFormation template | AWS-hosted DocumentDB customers | P2 |
| 17 | **Meta AI tools / Llama Stack tool registry** (if/when Meta publishes a public MCP-compatible tool registry) | Server manifest | Meta agent users | P2 |
| 18 | **Hugging Face Spaces / MCP servers tag** | Server manifest + demo space | Open-source AI builders | P2 |
| 19 | **Linux distro package managers** (apt/yum/Homebrew) | OS package wrapping the Node bundle | Power users on Linux/macOS | P3 |
| 20 | **Azure Container Apps "Marketplace gallery"** (built-in MCP server gallery if/when GA) | Same MCR image | Customers provisioning via Container Apps | P2 |

Priority key: P0 = ship at GA, P1 = within one release of GA, P2 = opportunistic, P3 = only if community asks.

All channels listed above apply to **Option A** below. Channel 7 (MCR) is also the supply chain for the container image used by the **Option B** sidecar baked into cluster VM images, and would feed the **Option C** pool if/when it is unparked.

### 3.2 Deployment Topologies (how it runs)

**Background on the managed DocumentDB data plane.** Each Azure DocumentDB cluster today is backed by a dedicated VM that runs (a) the DocumentDB **gateway container**, which speaks the **MongoDB wire protocol**, and (b) an internal Postgres + DocumentDB-extension container. The customer-facing load balancer exposes the gateway only. **Customers and their MCP agents speak Mongo to the gateway. Postgres is an internal implementation detail and is never visible to the customer, the agent, or the MCP server.**

### Option A: Self-host (BYO, Bring Your Own), multi-channel  *(today, expanded)*
Customer runs the server in their environment (laptop, VM, AKS (Azure Kubernetes Service), on-prem, or their own Azure subscription). Stdio or Streamable HTTP transport. Customer owns auth, networking, upgrades. Distributed through every channel in Section 3.1, with Azure Marketplace, MCR, npm, the Anthropic registry, the VS Code / Copilot gallery, OpenAI's MCP connector directory, and Cursor as the P0 launch surfaces.
- **Pros:** Max flexibility; works on-prem and air-gapped; broad AI-tool discoverability via the MCP registries; Marketplace channel gives a near-managed UX (User Experience) while data/network stays in the customer's boundary; one binary across all channels.
- **Cons:** Customer still owns patching/upgrades (mitigated by image auto-update channels and Marketplace updates); not zero-touch like Option B/C.
- **Keep as:** baseline for OSS, on-prem, dev, and BYO-Azure procurement.

### Option B: "Configure MCP" tick-box at cluster create (Managed Per-Cluster Sidecar)
When provisioning an Azure DocumentDB cluster, the customer ticks **"Enable MCP endpoint"**. The control plane deploys an **MCP container as a sidecar on the same cluster VM** that already runs the gateway. The MCP container speaks the **MongoDB wire protocol** to the **local gateway over loopback** (`mongodb://127.0.0.1:<gw-port>`) using the cluster's managed identity. The cluster load balancer exposes a new MCP listener on a separate hostname, for example `https://<cluster>.mcp.documentdb.azure.com`, alongside the existing Mongo endpoint. The agent talks MCP to that hostname; MCP talks Mongo to the local gateway; the gateway translates to Postgres internally. **Postgres is never reachable from MCP, the agent, or the customer.** This is the industry-standard pattern for managed-database proxies (AWS RDS Proxy, Cloud SQL Auth Proxy, MongoDB `mongos`).

```
[Agent / Agent Kit]
        |  MCP over Streamable HTTP + Entra token
        v
[Load Balancer: <cluster>.mcp.documentdb.azure.com]
        |
        v
[Cluster VM]
   [MCP container] --(MongoDB wire over localhost, managed identity)--> [Gateway container] --internal--> [Postgres + DocumentDB ext]
```

- **Pros:** Strong isolation (1 cluster = 1 MCP); reuses the existing VM, image-build pipeline, patching pipeline, observability, and trust boundary, so the marginal operational cost is small; **loopback hop = sub-millisecond MCP-to-gateway latency**; trivial RBAC (Role-Based Access Control) scoping; co-located with the cluster, so no cross-VNet hop and no Private Link plumbing; no cross-tenant blast radius. **Server code barely changes**, since today's binary is already single-`connection_profile` and is already a pure Mongo client via the `mongodb` driver, so the work is mostly control-plane plus ARM/Bicep plus lifecycle hooks plus a new LB listener.
- **Cons:** Adds RAM/CPU baseline on every cluster VM where MCP is enabled (mitigated by small Node footprint, cgroup caps, off-by-default); patching N clusters instead of one fleet (mitigated by the same image-based rollout used for the gateway today); resource contention with gateway/Postgres on the same VM (mitigated by separate container with conservative resource limits).
- **Best for:** All currently planned managed DocumentDB SKUs, since every cluster already has dedicated VM compute. Especially good for enterprise / regulated / single-tenant production clusters.
- **Effort:** Low to Medium. Weeks of control-plane work; minimal code changes (the existing binary runs as-is with a localhost `connection_profile`).

### Option C: Shared Managed MCP Pool ("MCP-as-SaaS")  *(parked, future SKUs)*
Microsoft operates a regional **fleet** of MCP server instances behind a routing front door (APIM (Azure API Management) / Azure Front Door). Customer requests carry an Entra token; the front door resolves the target cluster from the token's tenant + cluster ID claim (or a request header) and forwards to a backend worker. Workers are stateless; per-request `connection_profile` is materialized on the fly from a managed profile store keyed by `(tenantId, clusterId)` and connects to the customer's cluster gateway over Private Link. This is the dominant pattern for **SaaS MCP servers** today (GitHub, Atlassian, Linear, Notion, Cloudflare AI Gateway), and it is the right answer when there is no per-cluster compute to host a sidecar on.
- **Pros:** Lowest per-customer cost at scale; instant onboarding (no provisioning); centralized patching, telemetry, rate-limits; easy A/B and canary; single endpoint for many tenants.
- **Cons:** Multi-tenant blast radius needs hard isolation (per-request connection pools, strict auth, per-tenant rate limiting, no shared in-memory caches). Requires the server to be **stateless and tenant-aware**, which is mostly true today but needs review of `connectionProfiles.ts`, `rateLimit.ts`, `requestContext.ts`. Needs a routing front door, a managed profile store, fleet autoscaler, noisy-neighbor controls, Private-Link reachability into every customer VNet, and a full multi-tenant security/threat review before GA (General Availability). Adds a network hop (front door to worker to Private Link to cluster gateway), so latency is higher than Option B.
- **When this is the right choice:** (1) a future **serverless** or **free-tier** DocumentDB SKU that has no dedicated per-cluster compute; (2) a hosted dev/test / sandbox / playground tier where pool economics matter more than isolation; (3) a future **"MCP-as-a-service"** surface that is decoupled from a provisioned cluster. **None of these are on the near-term DocumentDB roadmap, so Option C is parked for now.** Listed here so the architecture stays consistent if/when those SKUs appear.
- **Effort:** High. Quarters of code hardening plus new front door plus security review. Do not start until a triggering SKU is committed.

### Industry pattern (why sidecar over pool here)

Two precedents are well established:

- **Managed database proxies** (AWS RDS Proxy, Cloud SQL Auth Proxy, MongoDB `mongos`, Aurora Proxy, Azure Database for PostgreSQL Connection Pooler) run as a **per-cluster sidecar** on the cluster's compute, lifecycle-managed by the control plane.
- **SaaS MCP servers** (GitHub, Atlassian, Linear, Notion, Cloudflare AI Gateway) run as a **shared multi-tenant pool** because there is no per-customer compute to attach to.

MCP for a managed database is closer to the proxy precedent, because the MCP server is effectively a typed-tool proxy over the database wire protocol. Since every DocumentDB cluster already provisions a dedicated VM that hosts the gateway, **Option B (sidecar) is the industry-aligned choice**. Option C (MCP-as-SaaS) becomes the right choice only when a future SKU removes per-cluster compute.

### Other approaches considered
- **MCP-as-an-extension inside DocumentDB itself** (run MCP in-process with the DB engine). Tightest coupling, lowest latency, but blurs the DB security boundary and forces engine-team release coupling. **Rejected** for v1.
- **Client-side library only** (MCP runs inside the user's IDE (Integrated Development Environment) / agent, no server). Doesn't fit the managed value prop (no central auditing, no Entra brokering, no governance).
- **Azure Functions / serverless per request.** Cold-start hostile for stdio-style sessions; HTTP transport is feasible but adds little over Container Apps. **Skip.**

## 4. Recommendation

Phased rollout, one binary across all phases:

1. **Phase 1: Self-host (Option A) via Marketplace + MCR + npx + source.** Ship first; shortest path to GA, immediately unblocks Azure customers (Marketplace 1-click), OSS/on-prem (source + `npx`), and AKS/Container Apps users (MCR image).
2. **Phase 2: Per-cluster sidecar (Option B)** as the default managed experience. Chosen over Option C because every managed DocumentDB cluster already runs a dedicated VM with the gateway; adding an MCP sidecar container is incremental, not net-new. Today's binary already speaks the Mongo wire protocol via the `mongodb` driver, so it works against the local gateway over loopback with a one-line `connection_profile` change. No multi-tenant security review is on the critical path, and customers get sub-millisecond MCP-to-gateway latency.
3. **Phase 3 (parked): MCP-as-SaaS shared pool (Option C).** Do not start until the roadmap introduces a SKU that needs it: serverless DocumentDB, a free tier without dedicated compute, or a standalone MCP-as-a-service offering. None of these are on the near-term roadmap. The architecture is documented so that, if and when those SKUs land, we can extend the same codebase without re-architecting.

Key engineering investments to enable Phase 1 and Phase 2:

- Cluster VM image: add the MCP container alongside the gateway container; gated by a control-plane flag set by the "Enable MCP" tick-box.
- Load balancer: add an HTTPS listener on `<cluster>.mcp.documentdb.azure.com` that routes to the MCP container on the VM.
- `connection_profile`: in the managed sidecar build, default to `mongodb://127.0.0.1:<gw-port>` with managed-identity auth to the local gateway. No customer-supplied DB credentials at any layer.
- HTTP/Streamable transport parity with stdio (already partially in `server.ts`); add LB-friendly health + readiness on `/healthz`.
- Container image published to MCR; signed releases; SBOM (Software Bill of Materials); channel goes from `preview` to `ga`.
- Control-plane API: `EnableMcp(clusterId)` plus portal toggle, plus image-rollout pipeline shared with the gateway.

Deferred until a Phase 3 trigger SKU is committed:

- Make `connection_profile` resolution pluggable to support `(tenantId, clusterId)` lookup from a managed profile store.
- Harden multi-tenancy: per-request Mongo client (or pool keyed by tenant), no global mutable state, per-tenant `rateLimit` buckets, audit log includes `tenantId` + `clusterId`.
- Routing front door (APIM / Front Door), Private-Link reachability into every customer VNet, multi-tenant threat model and red-team review.

## 5. Billing

The managed MCP sidecar (Option B) is positioned as a **premium, opt-in feature**, monetized through a **dedicated meter owned by our team**. When a customer toggles "Enable MCP" on a cluster, the meter starts; in exchange, we own the lifecycle: provisioning, image updates, patching, telemetry, SLAs, and support. This keeps the value exchange clean: customers pay for the managed experience and the operational guarantees, not just the compute.

- **Meter ownership:** the DocumentDB MCP team owns the meter end-to-end. We control pricing levers, SKU mapping, and reporting independent of the underlying cluster meter.
- **What's covered:** sidecar runtime, image patching, security updates, version upgrades, telemetry pipeline, and support for the managed MCP endpoint.
- **What's not covered:** Option A (self-host) remains free / OSS; customers running our binary themselves are not metered.
- **Exact meter shape (per-cluster flat, per-call, per-tool-tier, tiered by request volume, etc.) and price points are TBD with PM.** This section commits only to the principle: dedicated meter, premium opt-in, lifecycle managed by us.

## 6. Open Questions

- Billing meter design: per-cluster flat surcharge, per-call metered, per-tool-tier (read vs write vs management), or tiered by request volume? Owner: PM.
- Sidecar resource budget defaults (RAM/CPU caps) and whether they are tunable per-SKU.
- Same LB with path/SNI routing vs a dedicated MCP LB rule: operational preference?
- Sidecar patching: couple to the cluster image release train, or allow out-of-band MCP-only hotfixes via the existing gateway patch channel?
- Per-cluster telemetry routing: ship MCP logs/metrics through the same diagnostic-settings path the gateway already uses?
- Version pinning: do customers pick MCP server version, or always-latest with N-1 support?
- Trigger criteria for un-parking Option C: which roadmap event (serverless SKU, free tier, MCP-as-a-service announcement) flips the switch?

# DocumentDB MCP Server Release & Distribution Design (1-Pager)

Status: Draft for discussion. Owner: DocumentDB MCP team. Audience: PM (Product Management) + Eng (Engineering) leads

## 1. Problem

The DocumentDB MCP Server today is shipped as source / `npx github:microsoft/documentdb-mcp` for users to run locally against any MongoDB-compatible DocumentDB. This is fine for early adopters but does not scale for the Azure managed DocumentDB customer base, where customers expect a turnkey, governed, low-latency MCP endpoint that integrates with their cluster, identity, and networking. We need a distribution strategy that covers self-hosted users **and** managed Azure DocumentDB users without forking the codebase.

## 2. Goals / Non-Goals

**Goals:** (1) One codebase, multiple deployment shapes. (2) Zero-touch onboarding for managed Azure DocumentDB users. (3) Entra ID auth end-to-end; no DB passwords in the client. (4) Per-tenant isolation and auditable access. (5) Region/VNet (Virtual Network) co-location with the customer cluster.

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

All channels listed above apply to **Option A** below. Channels 6, 7, and 9 are also the supply chain for the container image used in Options **B** and **C**.

### 3.2 Deployment Topologies (how it runs)

### Option A: Self-host (BYO, Bring Your Own), multi-channel  *(today, expanded)*
Customer runs the server in their environment (laptop, VM, AKS (Azure Kubernetes Service), on-prem, or their own Azure subscription). Stdio or Streamable HTTP transport. Customer owns auth, networking, upgrades. Distributed through every channel in Section 3.1, with Azure Marketplace, MCR, npm, the Anthropic registry, the VS Code / Copilot gallery, OpenAI's MCP connector directory, and Cursor as the P0 launch surfaces.
- **Pros:** Max flexibility; works on-prem and air-gapped; broad AI-tool discoverability via the MCP registries; Marketplace channel gives a near-managed UX (User Experience) while data/network stays in the customer's boundary; one binary across all channels.
- **Cons:** Customer still owns patching/upgrades (mitigated by image auto-update channels and Marketplace updates); not zero-touch like Option B/C.
- **Keep as:** baseline for OSS, on-prem, dev, and BYO-Azure procurement.

### Option B: "Configure MCP" checkbox at cluster create (Managed Per-Cluster)
When provisioning an Azure DocumentDB cluster, customer ticks **"Enable MCP endpoint"**. Control plane deploys a dedicated MCP server instance (Container App / sidecar) per cluster, in the cluster's region/VNet, pre-bound to that cluster via Entra-only `connection_profile`. Endpoint surfaced in portal as `https://<cluster>.mcp.documentdb.azure.com`.
- **Pros:** Strong isolation (1 cluster = 1 server); simple mental model; trivial RBAC (Role-Based Access Control) scoping; co-located, so low latency; no cross-tenant blast radius. **Server code barely changes**, since today's binary is already single-`connection_profile`, so the work is mostly control-plane plus ARM/Bicep plus lifecycle hooks.
- **Cons:** Higher idle cost per cluster; provisioning latency; more instances to patch (mitigated by managed rollouts).
- **Best for:** Enterprise / regulated customers, single-tenant production clusters.
- **Effort:** Low to Medium. Weeks of control-plane work; minimal code changes.

### Option C: Shared Managed MCP Pool (Multi-tenant Gateway)
Microsoft operates a regional **fleet** of MCP server instances behind a routing front-door (APIM (Azure API Management) / Azure Front Door). Customer requests carry an Entra token; gateway resolves the target cluster from the token's tenant + cluster ID claim (or a request header) and forwards to a backend worker. Workers are stateless; per-request `connection_profile` is materialized on the fly from a managed profile store keyed by `(tenantId, clusterId)`.
- **Pros:** Lowest per-customer cost; instant onboarding (no provisioning); centralized patching, telemetry, rate-limits; easy A/B and canary.
- **Cons:** Multi-tenant blast radius needs hard isolation (per-request connection pools, strict auth, per-tenant rate limiting, no shared in-memory caches). Requires the server to be **stateless and tenant-aware**, which is mostly true today but needs review of `connectionProfiles.ts`, `rateLimit.ts`, `requestContext.ts`. Also needs a routing gateway, managed profile store, fleet autoscaler, noisy-neighbor controls, and a full multi-tenant security/threat review before GA (General Availability).
- **Best for:** Free/standard tier, dev/test, agentic SaaS scenarios, once at the scale where per-cluster cost matters.
- **Effort:** High. Quarters of code hardening plus new gateway plus security review.

### Option D: Hybrid, per-cluster managed first, shared pool as a cheaper fast-follow  *(recommended)*
Ship **A + B** in v1, and add **C** as a fast-follow cost-optimization tier. New managed clusters get Option B (dedicated MCP via the "Enable MCP" tick-box) because it's the cheapest path from today's code to a managed offering and gives the strongest isolation story. Option C lands later as a cheaper, instant-on tier for free/standard SKUs (Stock Keeping Units) once we have usage data to justify the multi-tenancy investment. Option A (multi-channel self-host, including Azure Marketplace) covers everyone else: on-prem, OSS, air-gapped, and BYO-Azure. One binary, three deployment topologies, multiple distribution channels, all from the same codebase.

### Other approaches considered
- **MCP-as-an-extension inside DocumentDB itself** (run MCP in-process with the DB engine). Tightest coupling, lowest latency, but blurs the DB security boundary and forces engine-team release coupling. **Rejected** for v1.
- **Client-side library only** (MCP runs inside the user's IDE (Integrated Development Environment) / agent, no server). Doesn't fit the managed value prop (no central auditing, no Entra brokering, no governance).
- **Azure Functions / serverless per request.** Cold-start hostile for stdio-style sessions; HTTP transport is feasible but adds little over Container Apps. **Skip.**

## 4. Recommendation

Adopt **Option D (Hybrid)** with a phased rollout:

1. **Phase 1: Self-host (Option A) via Marketplace + MCR + npx + source.** Ship first; shortest path to GA, immediately unblocks Azure customers (Marketplace 1-click), OSS/on-prem (source + `npx`), and AKS/Container Apps users (MCR image).
2. **Phase 2: Per-cluster managed (Option B)** as the default managed experience. Chosen over Option C for v1 because **B is meaningfully easier**: today's server is already single-`connection_profile`, so the work is almost entirely Azure control-plane (ARM/Bicep, lifecycle hook on cluster create, Container App per cluster, Private Link), with no invasive code refactor and no multi-tenant security review on the critical path. Strong isolation also makes the security story trivial for the first managed GA.
3. **Phase 3: Shared pool (Option C) as a cheaper fast-follow tier.** Add once Phase 2 is in market and we have telemetry on usage patterns. C unlocks lower per-customer cost for free/standard SKUs and dev/test scenarios, but it requires per-tenant isolation in code (`connectionProfiles.ts`, `rateLimit.ts`, `requestContext.ts`), a routing gateway, a managed profile store, and a multi-tenant threat model. Investments that only pay off at scale.

Key engineering investments to enable this:

- Make `connection_profile` resolution pluggable: today static JSON; add a **managed profile provider** that resolves `(tenantId, clusterId)` to a profile from the control plane.
- Harden multi-tenancy: per-request Mongo client (or pool keyed by tenant), no global mutable state, per-tenant `rateLimit` buckets, audit log includes `tenantId` + `clusterId`.
- HTTP/Streamable transport parity with stdio (already partially in `server.ts`); add gateway-friendly health + readiness on `/healthz`.
- Container image published to MCR; signed releases; SBOM (Software Bill of Materials); channel goes from `preview` to `ga`.
- Control-plane API: `EnableMcp(clusterId, mode: pool|dedicated)` plus portal toggle.

## 5. Open Questions

- Billing model: included with cluster, per-call, or per-dedicated-instance?
- Quotas: requests/min per tenant in the pool tier?
- Cross-region routing: pin to cluster region or allow nearest-edge?
- BYO network: dedicated tier into customer VNet via Private Link, required for v1 or fast-follow?
- Version pinning: do customers pick MCP server version, or always-latest with N-1 support?

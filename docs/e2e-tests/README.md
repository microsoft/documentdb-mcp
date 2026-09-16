# End-to-end testing

This folder collects everything you need to exercise the DocumentDB MCP
server end-to-end: the manual test matrix, the Entra ID setup guide, and
the scripted Entra E2E runbook.

## Contents

| Path | What it is |
| --- | --- |
| [e2e-testing-guide.md](./e2e-testing-guide.md) | Manual verification steps for every shipped security control (referenced from [release-readiness-check.md](../release-readiness-check.md)). |
| [entra-e2e-with-agent-kit.md](./entra-e2e-with-agent-kit.md) | Concepts + MCP client wiring (VS Code, Copilot CLI, Claude Code) for running the server with Entra ID on both caller and backend surfaces, including negative tests. |
| [entra-e2e/](./entra-e2e/guideline.md) | Numbered PowerShell + Bash scripts (`01`..`05`, `99`) that provision a cluster, register the app, run the server, and smoke-test it with Entra on both surfaces. Start at [guideline.md](./entra-e2e/guideline.md). |

## Related

- Automated stdio harnesses live in [scripts/e2e-tests/](../../scripts/e2e-tests/)
  (`e2e-stdio-gates.mjs`, `e2e-stdio-positive.mjs`).
- Test suite: `npm test` (Vitest, under [test/](../../test/)).

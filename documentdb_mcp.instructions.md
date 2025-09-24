# GitHub Copilot / Agent Instructions

## Query Handling
- When answering questions about queries, **always retrieve real data from the database** using the provided MCP tools.
- **Never invent or assume data** if it is not in context.

## Optimization Suggestions
- Suggest **considering enable Index-Only scan feature to improve the performance** when optimizing `count` operations.

# DocumentDB MCP Tools

All tools are stateless and require `connection_profile` in the tool arguments. Connection profiles are administrator-defined at deployment time; runtime connection strings are not accepted by the tools. Production profiles should use `authMode=entra` so backend access uses Azure Identity / Entra OIDC instead of database secrets. The server exposes tools only; prompts and resources are not registered.

Tool access is enforced server-side through Entra-authenticated roles and secure capability gates:

- `read` tools are enabled by default.
- `write` tools require `ENABLE_WRITE_TOOLS=true`.
- `management` tools require `ENABLE_MANAGEMENT_TOOLS=true`.

## Index

- `create_index` (`management`) - Create an index.
- `list_indexes` (`read`) - List indexes.
- `drop_index` (`management`) - Drop an index.

## Database

- `list_databases` (`read`) - List all databases when `db_name` is omitted; provide database details when `db_name` is specified.
- `drop_database` (`management`) - Drop a database.

## Collection

- `drop_collection` (`management`) - Drop a collection.
- `rename_collection` (`management`) - Rename a collection.
- `sample_documents` (`read`) - Sample documents from a collection.
- `current_ops` (`management`) - Get current operations.
- `get_statistics` (`read`) - Get database, collection, or index statistics with one command.

## Document

- `find_documents` (`read`) - Find documents.
- `count_documents` (`read`) - Count documents.
- `insert_documents` (`write`) - Insert one or more documents.
- `update_documents` (`write`) - Update one or more documents.
- `delete_documents` (`write`) - Delete one or more documents.
- `aggregate` (`read`) - Run an aggregate operation. `$out` and `$merge` are disabled unless explicitly enabled.
- `find_and_modify` (`write`) - Run a find and modify operation.
- `explain_operation` (`read`) - Explain a find, count, or aggregate operation.

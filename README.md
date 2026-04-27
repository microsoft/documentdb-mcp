# DocumentDB MCP Server (TypeScript)

A tools-only Model Context Protocol (MCP) server for Azure Cosmos DB for MongoDB vCore and MongoDB-compatible DocumentDB operations.

## Tool Model

The server is stateless. Every tool call must include `connection_string`; the server does not keep a shared connection, expose connection tools, or fall back to `DOCUMENTDB_URI`.

The MCP surface intentionally exposes tools only. Prompts and resources are not registered.

## Tools

### Index

- `create_index` - Create an index on a collection.
- `list_indexes` - List all indexes on a collection.
- `drop_index` - Drop an index from a collection.

### Database

- `list_databases` - List all databases. When `db_name` is provided, return collection details for that database.
- `drop_database` - Drop a database and all its collections.

### Collection

- `drop_collection` - Drop a collection from a database.
- `rename_collection` - Rename a collection.
- `sample_documents` - Retrieve sample documents from a collection.
- `current_ops` - Get current MongoDB operations with an optional filter.
- `get_statistics` - Get database, collection, or index statistics through one tool.

### Document

- `find_documents` - Find documents with query and consolidated find options.
- `count_documents` - Count documents matching a query.
- `insert_documents` - Insert one document or many documents.
- `update_documents` - Update one document by default, or all matches with `multi=true`.
- `delete_documents` - Delete one document by default, or all matches with `multi=true`.
- `aggregate` - Run an aggregation pipeline.
- `find_and_modify` - Atomically find and update one document.
- `explain_operation` - Explain `find`, `count`, or `aggregate` operations with `executionStats` verbosity.

## Installation

```bash
npm install
```

## Configuration

Server transport is configured with environment variables:

```env
TRANSPORT=streamable-http
HOST=localhost
PORT=8070
```

`TRANSPORT` can be `stdio`, `sse`, or `streamable-http`.

## Usage

Development:

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

## Example Tool Call

```json
{
  "name": "find_documents",
  "arguments": {
    "connection_string": "mongodb://localhost:27017",
    "db_name": "mydb",
    "collection_name": "users",
    "query": { "status": "active" },
    "options": { "limit": 10 }
  }
}
```

## Project Structure

```text
src/
├── main.ts
├── server.ts
├── config.ts
├── models.ts
├── context/
│   └── documentdb.ts
└── tools/
    ├── collection-tools.ts
    ├── database-tools.ts
    ├── document-tools.ts
    ├── index-tools.ts
    └── utils/
```

## Error Handling

Tools return structured MCP error responses for validation failures, connection failures, and database operation errors.

## License

See LICENSE.md in the project root.

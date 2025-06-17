# DocumentDB MCP Server

A Model Context Protocol (MCP) server implementation for DocumentDB operations, enabling seamless integration with AI agents and LLMs.

## Supported Operations

- Connect to DocumentDB cluster
- List collections
- Query operations (find, aggregate)
- Insert operations
- Update operations
- Delete records

## MCP Features

- Supports both SSE and STDIO transport methods

## Onboard DocumentDB to the MCP Server

### DB Connection Setup Guide
To get started with DocumentDB locally, follow these steps:

1. Pull the latest DocumentDB local image:
```bash
docker pull ghcr.io/microsoft/documentdb/documentdb-local:latest
```

2. Pull the latest gateway image:
```bash
# From https://github.com/microsoft/documentdb/pkgs/container/documentdb%2Fdocumentdb-local/419775665?tag=latest
docker pull ghcr.io/microsoft/documentdb/documentdb-local:latest
```

3. Run the DocumentDB container:
```bash
docker run -dt -p 10260:10260 \
  -e USERNAME=your_username \
  -e PASSWORD=your_password \
  ghcr.io/microsoft/documentdb/documentdb-local:latest
```

4. Connect to DocumentDB using mongosh:
```bash
# Option 1: Direct connection
mongosh localhost:10260 \
  -u your_username \
  -p your_password \
  --authenticationMechanism SCRAM-SHA-256 \
  --tls \
  --tlsAllowInvalidCertificates

# Option 2: Connection string (recommended)
mongosh "mongodb://your_username:your_password@localhost:10260/?authMechanism=SCRAM-SHA-256&tls=true&tlsAllowInvalidCertificates=true"
```

The connection string from Option 2 should be used as the `DOCUMENTDB_URI` environment variable.

For more detailed information about the DocumentDB gateway, refer to the official documentation:
https://github.com/microsoft/documentdb/blob/main/docs/v1/gateway.md#getting-started-with-documentdb-gateway

### Environment Variables

After setting up DocumentDB, configure your `.env` file or mcp configure json with the following variables:
```bash
DOCUMENTDB_URI=your_documentdb_uri
DB_NAME=your_database_name
```

Note: Ensure you replace `your_documentdb_uri`, `your_database_name` with your actual DocumentDB connection string and desired database name.

## Running the MCP Server

### Using uv

Install uv:
```bash
pip install uv
```

Install the package in development mode:
```bash
uv venv
uv pip install -e .
```

Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your DocumentDB configuration
```
#### Streamable HTTP and SSE Transport

```bash
# Set TRANSPORT=streamable-http or sse in .env then:
uv run src/documentdb_mcp.py
```
The MCP server will essentially be run as an API endpoint that you can then connect to with config shown below.

#### Stdio Transport
With stdio, the MCP client itself can spin up the MCP server, so nothing to run at this point.

### Using Docker

#### SSE Transport
```bash
docker build -t documentdb-mcp --build-arg PORT=8070 .
docker run --env-file .env -p 8070:8070 documentdb-mcp
```
The MCP server will essentially be run as an API endpoint within the container that you can then connect to with config shown below.

#### Stdio Transport
With stdio, the MCP client itself can spin up the MCP server container, so nothing to run at this point.

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us the rights to use your contribution. For details, visit https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will automatically determine whether you need to provide a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the Microsoft Open Source Code of Conduct. For more information see the Code of Conduct FAQ or contact opencode@microsoft.com with any additional questions or comments.

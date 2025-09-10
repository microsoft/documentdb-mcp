# DocumentDB MCP Server

DocumentDB MCP Server is a TypeScript-based Model Context Protocol (MCP) server that provides comprehensive DocumentDB/MongoDB database operations through structured tools. The server supports both stdio and HTTP transport modes for integration with MCP-compatible clients.

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the information here.

## Working Effectively

### Prerequisites and Bootstrap
- **Node.js Requirement**: Node.js 20.0.0+ (verified working with v20.19.5)
- **Package Manager**: npm (verified working with v10.8.2)

### Installation and Build Process
1. **Install Dependencies**:
   ```bash
   npm install
   ```
   - Takes ~9 seconds to complete
   - Installs 149 packages (~70MB in node_modules)

2. **Build the Project**:
   ```bash
   npm run build
   ```
   - **Timing**: Takes ~3.5 seconds. NEVER CANCEL. Set timeout to 60+ seconds for safety.
   - Compiles TypeScript to JavaScript in `dist/` directory
   - Generates source maps and declaration files

3. **Clean Build Artifacts**:
   ```bash
   npm run clean
   ```
   - Removes the `dist/` directory

### Environment Configuration
1. **Create Environment File**:
   ```bash
   cp .env.example .env
   ```

2. **Configure Transport Mode** (edit `.env`):
   
   **For stdio mode (recommended for MCP clients)**:
   ```env
   TRANSPORT='stdio'
   DOCUMENTDB_URI=mongodb://your-connection-string
   ```
   
   **For HTTP mode (browser/HTTP clients)**:
   ```env
   TRANSPORT='streamable-http'
   HOST='localhost'
   PORT='8070'
   DOCUMENTDB_URI=mongodb://your-connection-string
   ```

### Running the Server

**Development Mode**:
```bash
npm run dev
```
- Uses `tsx` for direct TypeScript execution
- Hot reloading during development
- Starts immediately in stdio mode (no immediate DB connection required)

**Production Mode**:
```bash
npm run build
npm start
```
- Runs compiled JavaScript from `dist/`
- Must build first before starting

## Transport Modes

### stdio Transport (Default for MCP)
- **Use Case**: Integration with MCP-compatible clients (Claude Desktop, VS Code, etc.)
- **Behavior**: Communicates via standard input/output streams
- **Connection**: Database connection established on first tool call, not at startup
- **Configuration**: Set `TRANSPORT='stdio'` in `.env`

### streamable-http Transport
- **Use Case**: Browser-based clients and HTTP integrations  
- **Behavior**: Runs HTTP server on specified host/port
- **Endpoint**: `http://localhost:8070/mcp`
- **Methods**: GET (SSE streams), POST (requests), DELETE (session termination)
- **Connection**: Requires valid MongoDB connection at startup or server fails
- **Configuration**: Set `TRANSPORT='streamable-http'`, `HOST`, and `PORT` in `.env`

## Validation and Testing

### Build Validation
Always run these commands in sequence to validate your changes:

1. **Clean and Build**:
   ```bash
   npm run clean && npm run build
   ```
   - Ensures clean compilation
   - Verify no TypeScript errors

2. **Test Development Mode**:
   ```bash
   # Set TRANSPORT='stdio' in .env first
   timeout 5s npm run dev
   ```
   - Should start and show: "Server will run on stdio transport"
   - Should not error immediately

3. **Test Production Mode**:
   ```bash
   timeout 5s npm start  
   ```
   - Should start successfully after build
   - Should show same transport message

### Functional Validation Scenarios

**Without MongoDB Connection** (stdio mode):
- Server starts successfully
- Database connection attempted only on first tool call
- Appropriate error returned if database unavailable

**With MongoDB Connection** (both modes):
- Test basic tool functionality:
  - `list_databases` - Lists available databases
  - `get_db_info` - Gets database and collection information
  - `sample_documents` - Retrieves sample documents from collections

### Manual Testing Checklist
- [ ] `npm install` completes without errors (~9 seconds)
- [ ] `npm run build` completes without errors (~3.5 seconds)  
- [ ] `npm run dev` starts in stdio mode
- [ ] `npm start` starts after build
- [ ] HTTP mode requires valid MongoDB URI
- [ ] stdio mode starts without immediate DB connection

## Common Issues and Solutions

### TypeScript Compilation Issues
- **Issue**: Module resolution errors in production
- **Solution**: Ensure all relative imports use `.js` extensions in TypeScript files
- **Example**: `import { config } from './config.js';` (not `'./config'`)

### MongoDB Connection Issues  
- **stdio mode**: Connection errors appear only when tools are called
- **HTTP mode**: Server fails to start if MongoDB unavailable
- **Solution**: Verify `DOCUMENTDB_URI` in `.env` is correct

### Build Failures
- **Missing tsconfig.json**: Ensure `tsconfig.json` exists (not `tscofig.json`)
- **ESM Import Issues**: Use `.js` extensions in all relative imports
- **Clean Build**: Run `npm run clean` before rebuilding if issues persist

## Project Structure

```
src/
├── main.ts              # Entry point and startup logic
├── server.ts            # MCP server setup and tool registration  
├── config.ts            # Environment configuration management
├── models.ts            # TypeScript interfaces and types
├── context/             # MongoDB client lifecycle management
│   └── documentdb.ts    # Connection handling and context
└── tools/               # MCP tool implementations
    ├── database.ts      # Database operations (list, stats, info, drop)
    ├── collection.ts    # Collection operations (stats, rename, drop, sample)
    ├── document.ts      # Document CRUD operations (find, insert, update, delete, aggregate)
    ├── index.ts         # Index management (create, list, drop, stats)
    └── workflow.ts      # Workflow tools (query optimization, enhanced info)
```

## Tool Categories and Capabilities

### Database Tools
- `list_databases` - List all databases
- `db_stats` - Get database statistics  
- `get_db_info` - Get database information and collection names
- `drop_database` - Drop a database

### Collection Tools  
- `collection_stats` - Get collection statistics
- `rename_collection` - Rename a collection
- `drop_collection` - Drop a collection
- `sample_documents` - Get sample documents from a collection

### Document Tools
- `find_documents` - Find documents with query, projection, sort, limit, skip
- `count_documents` - Count documents matching a query
- `insert_document` - Insert a single document
- `insert_many` - Insert multiple documents  
- `update_document` - Update a single document
- `delete_document` - Delete a single document
- `aggregate` - Run aggregation pipelines

### Index Tools
- `create_index` - Create an index
- `list_indexes` - List all indexes on a collection
- `drop_index` - Drop an index  
- `index_stats` - Get index usage statistics
- `current_ops` - Get current database operations

### Workflow Tools
- `optimize_find_query` - Analyze and optimize find queries
- `optimize_aggregate_query` - Analyze and optimize aggregation queries
- `list_databases_for_generation` - List databases with metadata for query generation
- `get_db_info_for_generation` - Get enhanced database info for query generation

## Dependencies and Technology Stack

### Core Dependencies
- `@modelcontextprotocol/sdk` - MCP SDK for TypeScript
- `mongodb` - Official MongoDB Node.js driver  
- `dotenv` - Environment variable management
- `express` - Web framework (HTTP transport only)
- `cors` - CORS middleware (HTTP transport only)

### Development Dependencies
- `typescript` - TypeScript compiler
- `tsx` - TypeScript execution engine for development
- `@types/*` - Type definitions

## Important Notes

### No Testing Infrastructure
- **Status**: No test files, test scripts, or testing framework configured
- **Validation**: Manual testing through actual server execution required
- **CI/CD**: No GitHub workflows or automated testing present

### No Linting/Formatting
- **Status**: No ESLint, Prettier, or code formatting tools configured  
- **Code Style**: Follow existing patterns in the codebase
- **Manual Review**: Code quality depends on manual review

### TypeScript Configuration
- **Target**: ES2022
- **Module**: ESNext with Node.js resolution
- **Strict Mode**: Enabled  
- **Output**: `dist/` directory with source maps and declarations

### Example Tool Usage
```json
{
  "name": "find_documents",
  "arguments": {
    "db_name": "mydb",
    "collection_name": "users", 
    "query": {"status": "active"},
    "limit": 10
  }
}
```

## Quick Reference Commands

```bash
# Full development cycle
npm install                    # Install dependencies (~9 seconds)
cp .env.example .env          # Create environment config
npm run build                 # Build TypeScript (~3.5 seconds)  
npm run dev                   # Start development server
npm start                     # Start production server (after build)

# Validation workflow  
npm run clean && npm run build    # Clean build verification
timeout 5s npm run dev            # Test startup (stdio mode)
timeout 5s npm start              # Test production startup
```
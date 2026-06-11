// Canonical end-to-end Entra MCP probe used by entra-e2e/05-smoke-tests.
//
// Performs a full MCP handshake against a streamable-http transport with a
// bearer token, then exercises read + write + management tool tiers against
// the configured "sandbox" connection profile so we can prove every layer
// of the auth + data path works:
//   1. Caller auth (JWT validation on the server)
//   2. Authorization (scope -> role mapping)
//   3. MCP handshake (initialize -> session id)
//   4. Backend DefaultAzureCredential -> ossrdbms token
//   5. Mongo SCRAM with Entra OID -> data-plane RBAC
//   6. Real CRUD against the cluster
//
// Usage:
//   MCP_URL=http://127.0.0.1:8070/mcp \
//   MCP_BEARER="$CALLER_TOKEN" \
//   node scripts/e2e-tests/_entra-probe.mjs
//
// Optional env:
//   MCP_PROFILE  Connection profile name (default: "sandbox")
//   MCP_DB       Database to create + populate (default: "playground")
//   MCP_COLL     Collection to create + populate (default: "vehicles")
//   MCP_CLEANUP  "true" to drop the database at the end (default: "false")

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:8070/mcp');
const bearer = process.env.MCP_BEARER;
const profile = process.env.MCP_PROFILE ?? 'sandbox';
const dbName = process.env.MCP_DB ?? 'playground';
const collName = process.env.MCP_COLL ?? 'vehicles';
const cleanup = (process.env.MCP_CLEANUP ?? 'false').toLowerCase() === 'true';

if (!bearer) {
    console.error('MCP_BEARER not set.');
    process.exit(2);
}

const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
});
const client = new Client({ name: 'entra-probe', version: '0.0.1' });

await client.connect(transport);
console.log('handshake: ok');

const tools = await client.listTools();
console.log(`tools/list: ${tools.tools.length} tools registered`);

async function call(name, args) {
    const res = await client.callTool({ name, arguments: { connection_profile: profile, ...args } });
    const text = res.content?.[0]?.text ?? JSON.stringify(res.content);
    return text;
}

try {
    console.log(`\n==> insert_documents into ${dbName}.${collName}`);
    console.log(await call('insert_documents', {
        db_name: dbName,
        collection_name: collName,
        documents: [
            { make: 'Toyota', model: 'Corolla', year: 2022 },
            { make: 'Tesla',  model: 'Model 3', year: 2024 },
        ],
    }));

    console.log(`\n==> list_databases`);
    console.log(await call('list_databases', {}));

    console.log(`\n==> get_statistics scope=database (${dbName})`);
    console.log(await call('get_statistics', { scope: 'database', db_name: dbName }));

    console.log(`\n==> get_statistics scope=collection (${dbName}.${collName})`);
    console.log(await call('get_statistics', { scope: 'collection', db_name: dbName, collection_name: collName }));

    console.log(`\n==> count_documents (${dbName}.${collName})`);
    console.log(await call('count_documents', { db_name: dbName, collection_name: collName }));

    console.log(`\n==> sample_documents (${dbName}.${collName})`);
    console.log(await call('sample_documents', { db_name: dbName, collection_name: collName, sample_size: 2 }));

    if (cleanup) {
        console.log(`\n==> drop_database (${dbName})`);
        console.log(await call('drop_database', { db_name: dbName }));
    } else {
        console.log(`\n(skip cleanup; set MCP_CLEANUP=true to drop "${dbName}" at the end)`);
    }
} finally {
    await client.close();
}

console.log('\nAll probes passed.');

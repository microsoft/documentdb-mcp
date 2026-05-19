#!/usr/bin/env node
// E2E positive driver: spawns dist/main.js over stdio against the local DocumentDB container
// and asserts that the *allow* paths actually return data through the gates.
//
// Covers e2e-testing-guide.md:
//   Section 7b.2  database allowlist allow
//   Section 7b.5  list_databases top-level filtering
//   Section 7b.6  list_databases per-db filtering
//   Section 7c.4  full opt-in works (management tool succeeds)
// Plus baseline read+write smoke against sampledb.products.
//
// Requires: docker container `documentdb-container` running on localhost:10260
// Usage:    node scripts/e2e-tests/e2e-stdio-positive.mjs

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, '..', '..', 'dist', 'main.js');

const LOCAL_URI =
    'mongodb://mcpadmin:McpDev%212026@localhost:10260/?tls=true&tlsAllowInvalidCertificates=true&authMechanism=SCRAM-SHA-256';

let pass = 0;
let fail = 0;
const failures = [];

async function withClient(env, fn) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverEntry],
        env: { ...process.env, ...env },
        stderr: 'ignore',
    });
    const client = new Client({ name: 'e2e-positive', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

function parseJsonText(result) {
    const text = result?.content?.[0]?.text ?? '';
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function check(name, env, callArgs, assert) {
    process.stdout.write(`  - ${name} ... `);
    try {
        const result = await withClient(env, (client) => client.callTool(callArgs));
        const text = result?.content?.[0]?.text ?? '';
        const isError = result?.isError === true;
        const verdict = assert({ isError, text, parsed: parseJsonText(result), raw: result });
        if (verdict === true) {
            pass += 1;
            console.log('PASS');
        } else {
            fail += 1;
            failures.push({ name, reason: verdict || 'assertion returned falsy', isError, text });
            console.log(`FAIL — ${verdict || 'assertion returned falsy'}\n      isError=${isError}\n      text=${text.slice(0, 400)}`);
        }
    } catch (err) {
        fail += 1;
        failures.push({ name, reason: `threw: ${err.message}` });
        console.log(`THREW — ${err.message}`);
    }
}

const baseEnv = {
    TRANSPORT: 'stdio',
    AUTH_REQUIRED: 'false',
    TRUST_LOCAL_STDIO: 'true',
    ENABLE_READ_TOOLS: 'true',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_MANAGEMENT_TOOLS: 'true',
    ALLOW_AGGREGATE_WRITE_STAGES: 'false',
    DOCUMENTDB_LOCAL_URI: LOCAL_URI,
};

const profileSampleOnly = {
    CONNECTION_PROFILES: '{"local":{"uriEnv":"DOCUMENTDB_LOCAL_URI","allowedRoles":["read","write","management"],"allowedDatabases":["sampledb"]}}',
};

const profileSampleProductsOnly = {
    CONNECTION_PROFILES:
        '{"local":{"uriEnv":"DOCUMENTDB_LOCAL_URI","allowedRoles":["read","write","management"],"allowedDatabases":["sampledb"],"allowedCollections":{"sampledb":["products"]}}}',
};

const profileFullOptIn = {
    CONNECTION_PROFILES: '{"local":{"uriEnv":"DOCUMENTDB_LOCAL_URI","allowedRoles":["read","write","management"]}}',
};

console.log('\n## Baseline read + write smoke\n');

await check(
    'find_documents on sampledb.products returns docs',
    { ...baseEnv, ...profileFullOptIn },
    { name: 'find_documents', arguments: { connection_profile: 'local', db_name: 'sampledb', collection_name: 'products', query: {}, options: { limit: 3 } } },
    ({ isError, parsed }) => {
        if (isError) return 'tool returned isError';
        const docs = parsed?.documents ?? parsed?.result?.documents;
        return Array.isArray(docs) && docs.length > 0 ? true : `expected non-empty documents array, got ${JSON.stringify(parsed).slice(0, 200)}`;
    },
);

await check(
    'count_documents on sampledb.products returns a number',
    { ...baseEnv, ...profileFullOptIn },
    { name: 'count_documents', arguments: { connection_profile: 'local', db_name: 'sampledb', collection_name: 'products', query: {} } },
    ({ isError, parsed }) => {
        if (isError) return 'tool returned isError';
        const n = parsed?.count ?? parsed?.result?.count;
        return typeof n === 'number' && n >= 0 ? true : `expected numeric count, got ${JSON.stringify(parsed).slice(0, 200)}`;
    },
);

const e2eMarkerColl = `e2e_marker_${Date.now()}`;

await check(
    'insert_documents into sampledb.<marker> succeeds',
    { ...baseEnv, ...profileFullOptIn },
    { name: 'insert_documents', arguments: { connection_profile: 'local', db_name: 'sampledb', collection_name: e2eMarkerColl, documents: [{ ok: true, ts: Date.now() }] } },
    ({ isError, parsed }) => {
        if (isError) return 'tool returned isError';
        const ack = parsed?.acknowledged ?? parsed?.result?.acknowledged;
        return ack === true ? true : `expected acknowledged=true, got ${JSON.stringify(parsed).slice(0, 200)}`;
    },
);

console.log('\n## Section 7b allow paths\n');

await check(
    '7b.2 allowedDatabases:["sampledb"] allows find on sampledb.products',
    { ...baseEnv, ...profileSampleOnly },
    { name: 'find_documents', arguments: { connection_profile: 'local', db_name: 'sampledb', collection_name: 'products', query: {}, options: { limit: 1 } } },
    ({ isError, parsed }) => {
        if (isError) return 'tool returned isError';
        const docs = parsed?.documents ?? parsed?.result?.documents;
        return Array.isArray(docs) ? true : `expected documents array, got ${JSON.stringify(parsed).slice(0, 200)}`;
    },
);

await check(
    '7b.5 list_databases (no db_name) is filtered to allowlist',
    { ...baseEnv, ...profileSampleOnly },
    { name: 'list_databases', arguments: { connection_profile: 'local' } },
    ({ isError, parsed }) => {
        if (isError) return 'tool returned isError';
        const dbs = parsed?.databases ?? parsed?.result?.databases;
        if (!Array.isArray(dbs)) return `expected databases array, got ${JSON.stringify(parsed).slice(0, 200)}`;
        const names = dbs.map((d) => (typeof d === 'string' ? d : d?.name));
        if (!names.includes('sampledb')) return `expected sampledb in list, got ${JSON.stringify(names)}`;
        const extras = names.filter((n) => n && n !== 'sampledb');
        return extras.length === 0 ? true : `expected only sampledb, got extras ${JSON.stringify(extras)}`;
    },
);

await check(
    '7b.6 list_databases db_name=sampledb filters collections to allowlist',
    { ...baseEnv, ...profileSampleProductsOnly },
    { name: 'list_databases', arguments: { connection_profile: 'local', db_name: 'sampledb' } },
    ({ isError, parsed }) => {
        if (isError) return 'tool returned isError';
        const colls = parsed?.collections ?? parsed?.result?.collections;
        if (!Array.isArray(colls)) return `expected collections array, got ${JSON.stringify(parsed).slice(0, 200)}`;
        const names = colls.map((c) => (typeof c === 'string' ? c : c?.name));
        if (!names.includes('products')) return `expected products in list, got ${JSON.stringify(names)}`;
        const extras = names.filter((n) => n && n !== 'products');
        return extras.length === 0 ? true : `expected only products, got extras ${JSON.stringify(extras)}`;
    },
);

console.log('\n## Section 7c.4 — full opt-in management tool succeeds\n');

// Drop the marker collection we created during the insert smoke test.
await check(
    '7c.4 drop_collection on sampledb.<marker> succeeds',
    { ...baseEnv, ...profileFullOptIn },
    { name: 'drop_collection', arguments: { connection_profile: 'local', db_name: 'sampledb', collection_name: e2eMarkerColl, confirm_collection_name: e2eMarkerColl } },
    ({ isError, parsed, text }) => {
        if (isError) return `tool returned isError: ${text.slice(0, 200)}`;
        // accept any non-error response shape (some tools return {success:true} or echo the dropped name)
        return parsed !== null ? true : `expected JSON response, got ${text.slice(0, 200)}`;
    },
);

console.log('\n---');
console.log(`PASS: ${pass}   FAIL: ${fail}`);
if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
}
process.exit(0);

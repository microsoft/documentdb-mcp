#!/usr/bin/env node
// E2E driver: spawns dist/main.js over stdio for each scenario, runs one tool call, asserts the result.
// Covers all stdio-gated checks in docs/e2e-testing-guide.md Section 7b (resource scope) and Section 7c (capability tier).
//
// Usage:  node scripts/e2e-tests/e2e-stdio-gates.mjs

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, '..', '..', 'dist', 'main.js');

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
    const client = new Client({ name: 'e2e-driver', version: '0.0.0' }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await fn(client);
    } finally {
        await client.close();
    }
}

async function check(name, env, callArgs, assert) {
    process.stdout.write(`  - ${name} ... `);
    try {
        const result = await withClient(env, (client) => client.callTool(callArgs));
        const text = result?.content?.[0]?.text ?? '';
        const isError = result?.isError === true;
        const verdict = assert({ isError, text, raw: result });
        if (verdict === true) {
            pass += 1;
            console.log('PASS');
        } else {
            fail += 1;
            failures.push({ name, reason: verdict || 'assertion returned falsy', isError, text });
            console.log(`FAIL — ${verdict || 'assertion returned falsy'}\n      isError=${isError}\n      text=${text.slice(0, 300)}`);
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
    ALLOW_UNAUTHENTICATED_STDIO: 'true',
    ENABLE_READ_TOOLS: 'true',
    ENABLE_WRITE_TOOLS: 'true',
    ENABLE_MANAGEMENT_TOOLS: 'true',
    ALLOW_AGGREGATE_WRITE_STAGES: 'false',
};

console.log('\n## Section 7b — Per-Profile Database And Collection Restrictions\n');

await check(
    '7b.1 database allowlist deny',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"]}}' },
    { name: 'find_documents', arguments: { connection_profile: 'dev', db_name: 'secrets', collection_name: 'x', query: {} } },
    ({ isError, text }) => isError && /Database 'secrets' is not allowed/.test(text) || `expected deny on 'secrets'`,
);

await check(
    '7b.3 collection allowlist deny',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}' },
    { name: 'find_documents', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'maintenance', query: {} } },
    ({ isError, text }) => (isError && /Collection 'fleet\.maintenance' is not allowed/.test(text)) || `expected deny on fleet.maintenance`,
);

await check(
    '7b.4 rename_collection target check',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":["vehicles"]}}}' },
    { name: 'rename_collection', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', new_collection_name: 'leaks' } },
    ({ isError, text }) => (isError && /Collection 'fleet\.leaks' is not allowed/.test(text)) || `expected deny on fleet.leaks`,
);

await check(
    '7b.7a allowedDatabases:[] is explicit deny-all',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":[]}}' },
    { name: 'find_documents', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', query: {} } },
    ({ isError, text }) => (isError && /Database 'fleet' is not allowed.*Allowed databases: \(none\)\./.test(text)) || `expected deny-all`,
);

await check(
    '7b.7b allowedCollections[db]:[] is explicit deny-all',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"],"allowedDatabases":["fleet"],"allowedCollections":{"fleet":[]}}}' },
    { name: 'find_documents', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', query: {} } },
    ({ isError, text }) => (isError && /Collection 'fleet\.vehicles' is not allowed.*Allowed collections in 'fleet': \(none\)\./.test(text)) || `expected collection deny-all`,
);

console.log('\n## Section 7c — Per-Profile Role And Capability Restrictions\n');

await check(
    '7c.1 default is read-only (omitted allowedRoles)',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake"}}' },
    { name: 'insert_documents', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', documents: [{ x: 1 }] } },
    ({ isError, text }) => (isError && /Tool tier 'write' is not allowed.*Allowed tiers: read\./.test(text)) || `expected default read-only deny on write`,
);

await check(
    '7c.2 allowedRoles:[] is explicit deny-all (denies even read)',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":[]}}' },
    { name: 'find_documents', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', query: {} } },
    ({ isError, text }) => (isError && /Tool tier 'read' is not allowed.*Allowed tiers: \(none\)\./.test(text)) || `expected deny-all (none)`,
);

await check(
    '7c.3 explicit allowedRoles denies management',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write"]}}' },
    { name: 'drop_collection', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', confirm_collection_name: 'vehicles' } },
    ({ isError, text }) => (isError && /Tool tier 'management' is not allowed/.test(text)) || `expected management deny`,
);

console.log('\n## Bonus stdio gates (sanity)\n');

await check(
    'unknown profile name',
    { ...baseEnv, CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read"]}}' },
    { name: 'find_documents', arguments: { connection_profile: 'missing', db_name: 'x', collection_name: 'y', query: {} } },
    ({ isError, text }) => (isError && /Unknown connection profile 'missing'/.test(text)) || `expected unknown-profile error`,
);

await check(
    'global ENABLE_WRITE_TOOLS=false denies write at gate [5]',
    { ...baseEnv, ENABLE_WRITE_TOOLS: 'false', CONNECTION_PROFILES: '{"dev":{"uri":"mongodb://fake","allowedRoles":["read","write","management"]}}' },
    { name: 'insert_documents', arguments: { connection_profile: 'dev', db_name: 'fleet', collection_name: 'vehicles', documents: [{ x: 1 }] } },
    ({ isError, text }) => (isError && /Write tools are disabled/.test(text)) || `expected global write deny`,
);

console.log('\n---');
console.log(`PASS: ${pass}   FAIL: ${fail}`);
if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f.name}: ${f.reason}`);
    process.exit(1);
}
process.exit(0);

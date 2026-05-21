/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MCPConfig } from '../../src/config';
import { validateConfig } from '../../src/security/configValidation';

const originalEnv = { ...process.env };

function baseConfig(overrides: Partial<MCPConfig> = {}): MCPConfig {
    return {
        transport: 'stdio',
        host: 'localhost',
        port: 8070,
        auth: { required: false, tenantId: '', audience: '' },
        rateLimit: { enabled: false, windowMs: 60_000, maxRequests: 120 },
        authorization: { readRoleValues: [], writeRoleValues: [], managementRoleValues: [] },
        capabilities: {
            readTools: true,
            writeTools: false,
            managementTools: false,
            allowWriteStagesInAggregate: false,
        },
        limits: {
            maxFindLimit: 100,
            maxSampleSize: 50,
            maxInsertBatchSize: 100,
            maxReturnBytes: 1_048_576,
            mongoMaxTimeMs: 30_000,
        },
        connectionProfiles: { dev: { uri: 'mongodb://localhost:27017' } },
        defaultConnectionProfile: '',
        trustLocalStdio: true,
        ...overrides,
    } as MCPConfig;
}

describe('validateConfig', () => {
    beforeEach(() => {
        process.env = { ...originalEnv };
    });
    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('happy path', () => {
        it('accepts a minimal valid stdio config', () => {
            expect(() => validateConfig(baseConfig())).not.toThrow();
        });

        it('accepts a valid entra profile with tokenScope', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            prod: {
                                authMode: 'entra',
                                endpoint: 'example.mongocluster.cosmos.azure.com',
                                tokenScope: 'https://ossrdbms-aad.database.windows.net/.default',
                                allowedRoles: ['read'],
                            },
                        },
                    }),
                ),
            ).not.toThrow();
        });

        it('accepts a valid entra profile with tokenResource (no scope)', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            prod: {
                                authMode: 'entra',
                                endpoint: 'example.mongocluster.cosmos.azure.com',
                                tokenResource: 'https://ossrdbms-aad.database.windows.net',
                            },
                        },
                    }),
                ),
            ).not.toThrow();
        });

        it('accepts uriEnv when the env var is set', () => {
            process.env.DEV_URI = 'mongodb://localhost:27017';
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: { dev: { uriEnv: 'DEV_URI' } },
                    }),
                ),
            ).not.toThrow();
        });

        it('accepts DEFAULT_CONNECTION_PROFILE for stdio when the profile exists', () => {
            expect(() => validateConfig(baseConfig({ defaultConnectionProfile: 'dev' }))).not.toThrow();
        });
    });

    describe('default connection profile', () => {
        it('rejects DEFAULT_CONNECTION_PROFILE for non-stdio transports', () => {
            expect(() =>
                validateConfig(baseConfig({ transport: 'streamable-http', defaultConnectionProfile: 'dev' })),
            ).toThrow(/DEFAULT_CONNECTION_PROFILE is only supported for local stdio transport/);
        });

        it('rejects DEFAULT_CONNECTION_PROFILE when the profile name is unknown', () => {
            expect(() => validateConfig(baseConfig({ defaultConnectionProfile: 'missing' }))).toThrow(
                /does not match a configured connection profile/,
            );
        });
    });

    describe('transport', () => {
        it('rejects an unknown transport', () => {
            expect(() => validateConfig(baseConfig({ transport: 'websocket' as any }))).toThrow(
                /TRANSPORT='websocket' is invalid/,
            );
        });
    });

    describe('port', () => {
        it('rejects NaN port (parseInt of non-numeric)', () => {
            expect(() => validateConfig(baseConfig({ port: NaN }))).toThrow(/PORT=NaN is invalid/);
        });
        it('rejects out-of-range port', () => {
            expect(() => validateConfig(baseConfig({ port: 70000 }))).toThrow(/PORT=70000 is invalid/);
        });
        it('rejects zero port', () => {
            expect(() => validateConfig(baseConfig({ port: 0 }))).toThrow(/PORT=0 is invalid/);
        });
    });

    describe('rate limit', () => {
        it('rejects NaN windowMs', () => {
            expect(() =>
                validateConfig(baseConfig({ rateLimit: { enabled: true, windowMs: NaN, maxRequests: 10 } })),
            ).toThrow(/RATE_LIMIT_WINDOW_MS=NaN/);
        });
        it('rejects non-positive maxRequests', () => {
            expect(() =>
                validateConfig(baseConfig({ rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 0 } })),
            ).toThrow(/RATE_LIMIT_MAX_REQUESTS=0/);
        });
    });

    describe('auth cross-field', () => {
        it('rejects AUTH_REQUIRED=true without tenantId', () => {
            expect(() =>
                validateConfig(baseConfig({ auth: { required: true, tenantId: '', audience: 'aud' } })),
            ).toThrow(/AUTH_REQUIRED=true requires ENTRA_TENANT_ID/);
        });
        it('rejects AUTH_REQUIRED=true without audience', () => {
            expect(() =>
                validateConfig(baseConfig({ auth: { required: true, tenantId: 'tid', audience: '' } })),
            ).toThrow(/AUTH_REQUIRED=true requires ENTRA_AUDIENCE/);
        });
        it('does not require ENTRA_* when AUTH_REQUIRED=false', () => {
            expect(() =>
                validateConfig(baseConfig({ auth: { required: false, tenantId: '', audience: '' } })),
            ).not.toThrow();
        });
    });

    describe('profile shape', () => {
        it('rejects a non-object profile', () => {
            expect(() => validateConfig(baseConfig({ connectionProfiles: { broken: null as any } }))).toThrow(
                /Connection profile 'broken' must be a JSON object/,
            );
        });
        it('rejects an unknown authMode', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: { authMode: 'oauth' as any, uri: 'mongodb://x' },
                        },
                    }),
                ),
            ).toThrow(/invalid authMode='oauth'/);
        });
        it('with invalid authMode, does not also emit a contradictory uri/uriEnv error', () => {
            // Profile has invalid authMode AND no uri/uriEnv. Pre-fix this produced two
            // contradictory errors; we now want exactly one — the authMode message —
            // because suggesting `authMode=entra, uri, or uriEnv` would conflict with the
            // already-flagged authMode field.
            try {
                validateConfig(
                    baseConfig({
                        connectionProfiles: { dev: { authMode: 'oauth' as any } },
                    }),
                );
                throw new Error('expected validateConfig to throw');
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toMatch(/invalid authMode='oauth'/);
                expect(message).not.toMatch(/must define authMode=entra, uri, or uriEnv/);
                expect(message).toMatch(/Found 1 problem\(s\)/);
            }
        });
        it('with invalid authMode, still surfaces orthogonal allowlist shape errors', () => {
            // authMode is broken AND allowedRoles has an unknown tier. The two are independent;
            // surfacing both in one pass is the headline UX of aggregated reporting.
            try {
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: {
                                authMode: 'oauth' as any,
                                uri: 'mongodb://x',
                                allowedRoles: ['admin'] as any,
                            },
                        },
                    }),
                );
                throw new Error('expected validateConfig to throw');
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toMatch(/invalid authMode='oauth'/);
                expect(message).toMatch(/allowedRoles\[0\]='admin' is invalid/);
                expect(message).toMatch(/Found 2 problem\(s\)/);
            }
        });
        it('rejects entra profile missing endpoint', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            prod: {
                                authMode: 'entra',
                                tokenScope: 'scope',
                            },
                        },
                    }),
                ),
            ).toThrow(/must define endpoint/);
        });
        it('rejects entra profile missing both tokenScope and tokenResource', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            prod: {
                                authMode: 'entra',
                                endpoint: 'example.com',
                            },
                        },
                    }),
                ),
            ).toThrow(/must define tokenScope or tokenResource/);
        });
        it('rejects connectionString profile missing both uri and uriEnv', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: { dev: { authMode: 'connectionString' } as any },
                    }),
                ),
            ).toThrow(/must define authMode=entra, uri, or uriEnv/);
        });
        it('rejects uriEnv when the referenced env var is unset', () => {
            delete process.env.MISSING_URI;
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: { dev: { uriEnv: 'MISSING_URI' } },
                    }),
                ),
            ).toThrow(/'MISSING_URI', which is not set/);
        });
    });

    describe('allowlist shape', () => {
        it('rejects allowedDatabases that is not an array', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: { uri: 'mongodb://x', allowedDatabases: 'fleet' as any },
                        },
                    }),
                ),
            ).toThrow(/allowedDatabases must be a string array/);
        });
        it('rejects allowedCollections that is not an object', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: { uri: 'mongodb://x', allowedCollections: ['vehicles'] as any },
                        },
                    }),
                ),
            ).toThrow(/allowedCollections must be an object/);
        });
        it('rejects allowedCollections[db] that is not an array', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: {
                                uri: 'mongodb://x',
                                allowedCollections: { fleet: 'vehicles' as any },
                            },
                        },
                    }),
                ),
            ).toThrow(/allowedCollections\['fleet'\] must be a string array/);
        });
        it('rejects allowedRoles containing an unknown tier', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: { uri: 'mongodb://x', allowedRoles: ['read', 'admin'] as any },
                        },
                    }),
                ),
            ).toThrow(/allowedRoles\[1\]='admin' is invalid/);
        });
        it('rejects deniedDatabases that is not an array', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: { uri: 'mongodb://x', deniedDatabases: 'secrets' as any },
                        },
                    }),
                ),
            ).toThrow(/deniedDatabases must be a string array/);
        });
        it('accepts empty arrays (explicit deny-all semantics)', () => {
            expect(() =>
                validateConfig(
                    baseConfig({
                        connectionProfiles: {
                            dev: {
                                uri: 'mongodb://x',
                                allowedDatabases: [],
                                allowedRoles: [],
                                allowedCollections: { fleet: [] },
                            },
                        },
                    }),
                ),
            ).not.toThrow();
        });
    });

    describe('aggregated reporting', () => {
        it('reports multiple errors in one throw', () => {
            try {
                validateConfig(
                    baseConfig({
                        transport: 'bogus' as any,
                        port: 0,
                        connectionProfiles: { broken: { authMode: 'entra' } },
                    }),
                );
                throw new Error('expected validateConfig to throw');
            } catch (error) {
                const message = (error as Error).message;
                expect(message).toMatch(/Found 4 problem\(s\)/);
                expect(message).toMatch(/TRANSPORT='bogus'/);
                expect(message).toMatch(/PORT=0/);
                expect(message).toMatch(/must define endpoint/);
                expect(message).toMatch(/must define tokenScope or tokenResource/);
            }
        });
    });
});

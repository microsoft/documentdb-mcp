/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DefaultAzureCredential } from '@azure/identity';
import { AuthMechanism, MongoClient, type MongoClientOptions } from 'mongodb';

export type DocumentDBConnectionConfig =
    | {
          kind: 'connectionString';
          uri: string;
          appName?: string;
      }
    | {
          kind: 'entra';
          uri: string;
          tokenScope: string;
          tokenResource?: string;
          username?: string;
          retryWrites?: boolean;
          appName?: string;
          allowedHosts?: string[];
      };

const azureCredential = new DefaultAzureCredential();

function createDocumentDBClient(connection: DocumentDBConnectionConfig): MongoClient {
    if (connection.kind === 'connectionString') {
        return connection.appName
            ? new MongoClient(connection.uri, { appName: connection.appName })
            : new MongoClient(connection.uri);
    }

    const options: MongoClientOptions = {
        authMechanism: AuthMechanism.MONGODB_OIDC,
        authSource: '$external',
        authMechanismProperties: {
            TOKEN_RESOURCE: connection.tokenResource || connection.tokenScope.replace(/\/\.default$/, ''),
            ALLOWED_HOSTS: connection.allowedHosts,
            OIDC_CALLBACK: async () => {
                const token = await azureCredential.getToken(connection.tokenScope);
                if (!token) {
                    throw new Error(`Azure credential did not return an access token for '${connection.tokenScope}'.`);
                }
                return {
                    accessToken: token.token,
                    expiresInSeconds: Math.max(0, Math.floor((token.expiresOnTimestamp - Date.now()) / 1000)),
                };
            },
        },
        retryWrites: connection.retryWrites,
        appName: connection.appName,
    };

    if (connection.username) {
        options.auth = { username: connection.username };
    }

    return new MongoClient(connection.uri, options);
}

export async function withDocumentDBClient<T>(
    connection: DocumentDBConnectionConfig,
    handler: (client: MongoClient) => Promise<T>,
): Promise<T> {
    const client = createDocumentDBClient(connection);
    try {
        await client.connect();
        return await handler(client);
    } finally {
        await client.close();
    }
}

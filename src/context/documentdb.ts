/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';

export async function withDocumentDBClient<T>(
    connectionString: string,
    handler: (client: MongoClient) => Promise<T>,
): Promise<T> {
    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        return await handler(client);
    } finally {
        await client.close();
    }
}

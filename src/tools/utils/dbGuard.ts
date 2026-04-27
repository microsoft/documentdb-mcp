import { type MongoClient } from 'mongodb';
import { withDocumentDBClient } from '../../context/documentdb';

export interface StatelessConnectionInput {
    connection_string: string;
}

export function withDbGuard<Inp extends StatelessConnectionInput>(
    handler: (input: Inp, client: MongoClient) => Promise<any> | any,
) {
    return async (input: Inp, _extra?: unknown): Promise<any> => {
        if (!input.connection_string) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { error: 'connection_string is required for stateless DocumentDB tool execution.' },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }

        try {
            return await withDocumentDBClient<any>(input.connection_string, (client) => handler(input, client));
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(
                            { error: error instanceof Error ? error.message : String(error) },
                            null,
                            2,
                        ),
                    },
                ],
                isError: true,
            };
        }
    };
}

import {
    createSolanaRpcApi,
    GetAccountInfoApi,
    GetBlockApi,
    GetMultipleAccountsApi,
    GetProgramAccountsApi,
    GetTransactionApi,
} from '@solana/rpc-core';
import { createHttpTransport, createJsonRpc } from '@solana/rpc-transport';
import type { Rpc } from '@solana/rpc-types';
import fetchMock from 'jest-fetch-mock-fork';

import { createRpcGraphQL, RpcGraphQL } from '../../index';

describe('account loader', () => {
    jest.useFakeTimers();
    let rpc: Rpc<GetAccountInfoApi & GetBlockApi & GetMultipleAccountsApi & GetProgramAccountsApi & GetTransactionApi>;
    let rpcGraphQL: RpcGraphQL;
    beforeEach(() => {
        fetchMock.resetMocks();
        fetchMock.dontMock();
        rpc = createJsonRpc<
            GetAccountInfoApi & GetBlockApi & GetMultipleAccountsApi & GetProgramAccountsApi & GetTransactionApi
        >({
            api: createSolanaRpcApi(),
            transport: createHttpTransport({ url: 'http://127.0.0.1:8899' }),
        });
        rpcGraphQL = createRpcGraphQL(rpc);
    });
    afterEach(async () => {
        // await jest.runAllTimersAsync();
        jest.runAllTicks();
    });
    describe('cached responses', () => {
        it('coalesces multiple requests for the same account into one', async () => {
            expect.assertions(1);
            const source = /* GraphQL */ `
                query testQuery {
                    account1: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                        lamports
                    }
                    account2: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                        lamports
                    }
                    account3: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                        lamports
                    }
                }
            `;
            rpcGraphQL.query(source);
            await jest.runAllTimersAsync();
            jest.runAllTicks();
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
        it('cache resets on new tick', async () => {
            expect.assertions(1);
            const source = /* GraphQL */ `
                query testQuery {
                    account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                        lamports
                    }
                }
            `;
            // Call the query twice
            rpcGraphQL.query(source);
            rpcGraphQL.query(source);
            await jest.runAllTimersAsync();
            jest.runAllTicks();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });
    describe('batch loading', () => {
        describe('request partitioning', () => {
            it('coalesces multiple requests for the same account but different fields into one request', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery($address: String!) {
                        account1: account(address: $address) {
                            lamports
                        }
                        account2: account(address: $address) {
                            space
                        }
                        account3: account(address: $address) {
                            ... on MintAccount {
                                supply
                            }
                        }
                    }
                `;
                rpcGraphQL.query(source, { address: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr' });
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('coalesces multiple requests for multiple accounts into one `getMultipleAccounts` request', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account1: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            lamports
                        }
                        account2: account(address: "E3gxDM5HFkRALNTiWkdi9CNnXpCyTRuHz1fijP9EZbqr") {
                            lamports
                        }
                        account3: account(address: "8mU8aurnEhNooLD7gRbY3jhtjWHsYpBEcFL1Dut3wu8M") {
                            lamports
                        }
                        account4: account(address: "BXiu8QD4YiJ9QhMhijgDrdZh6buNe1Axtz5JG71fuDBx") {
                            lamports
                        }
                        account5: account(address: "68xCDFqAHkce2tRMCTg8NMYDP9UHyMzSGsJQcHwto7aC") {
                            lamports
                        }
                        account6: account(address: "FAMce8gx9Kt6CiE1AE7at6P15myQyQFqQr9fXoZbfJSa") {
                            lamports
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('coalesces multi-layered multiple requests into `getMultipleAccounts` requests', async () => {
                expect.assertions(2);

                const source = /* GraphQL */ `
                    query testQuery {
                        # Nonce account (see scripts/fixtures/nonce-account.json)
                        account1: account(address: "AiZExP8mK4RxDozh4r57knvqSZgkz86HrzPAMx61XMqU") {
                            lamports
                            ownerProgram {
                                lamports
                            }
                        }
                        # Mint account (see scripts/fixtures/spl-token-mint-account.json)
                        account2: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            lamports
                            ownerProgram {
                                lamports
                                ownerProgram {
                                    lamports
                                }
                            }
                        }
                        # Stake account (see scripts/fixtures/stake-account.json)
                        account3: account(address: "CSg2vQGbnwWdSyJpwK4i3qGfB6FebaV3xQTx4U1MbixN") {
                            lamports
                        }
                        # Vote account (see scripts/fixtures/vote-account.json)
                        account4: account(address: "4QUZQ4c7bZuJ4o4L8tYAEGnePFV27SUFEVmC7BYfsXRp") {
                            lamports
                            ownerProgram {
                                space
                            }
                        }
                    }
                `;

                // Set up mocks
                type MockDataOwner = { data: [string, string]; owner: string };
                const defaultSpaceLamports = ({ data, owner }: MockDataOwner) => ({
                    data,
                    lamports: 0n,
                    owner,
                    space: 0n,
                });

                // First we should see `getMultipleAccounts` used for the first two layers
                const getMultipleAccountsMockResponse = (accounts: MockDataOwner[]) => ({
                    context: {
                        slot: 0,
                    },
                    value: accounts.map(({ data, owner }) => defaultSpaceLamports({ data, owner })),
                });
                const getMultipleAccountsMock = jest
                    .fn()
                    .mockResolvedValueOnce(
                        getMultipleAccountsMockResponse([
                            {
                                data: ['AA', 'base64'],
                                owner: '11111111111111111111111111111111',
                            },
                            {
                                data: ['AA', 'base64'],
                                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                            },
                            {
                                data: ['AA', 'base64'],
                                owner: 'Stake11111111111111111111111111111111111111',
                            },
                            {
                                data: ['AA', 'base64'],
                                owner: 'Vote111111111111111111111111111111111111111',
                            },
                        ]),
                    )
                    .mockResolvedValueOnce(
                        getMultipleAccountsMockResponse([
                            {
                                data: ['AA', 'base64'],
                                owner: 'NativeLoader1111111111111111111111111111111',
                            },
                            {
                                data: ['AA', 'base64'],
                                owner: 'BPFLoader2111111111111111111111111111111111',
                            },
                            {
                                data: ['AA', 'base64'],
                                owner: 'NativeLoader1111111111111111111111111111111',
                            },
                        ]),
                    );

                // Then we should see `getAccountInfo` used for the single
                // account in the last layer
                const getAccountInfoMock = jest.fn().mockResolvedValueOnce({
                    context: {
                        slot: 0,
                    },
                    value: defaultSpaceLamports({
                        data: ['AA', 'base64'],
                        owner: 'NativeLoader1111111111111111111111111111111',
                    }),
                });

                const thisRpc = {
                    getAccountInfo: () => ({
                        send: () => getAccountInfoMock(),
                    }),
                    getMultipleAccounts: () => ({
                        send: () => getMultipleAccountsMock(),
                    }),
                } as unknown as Parameters<typeof createRpcGraphQL>[0];
                rpcGraphQL = createRpcGraphQL(thisRpc);

                rpcGraphQL.query(source);
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(getMultipleAccountsMock).toHaveBeenCalledTimes(2);
                expect(getAccountInfoMock).toHaveBeenCalledTimes(1);
            });
            it('breaks multiple account requests into multiple `getMultipleAccounts` requests if the batch limit is exceeded', async () => {
                expect.assertions(1);

                const baseAddress = 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGt'; // Missing last three characters `KJr`
                let accountQueries = '';
                for (let i = 0; i < 150; i++) {
                    accountQueries += `
                            account${i}: account(address: "${baseAddress + i.toString().padStart(3, '0')}") {
                                lamports
                            }
                        `;
                }
                const source = /* GraphQL */ `
                        query testQuery {
                            ${accountQueries}
                        }
                    `;
                rpcGraphQL.query(source);
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(2);
            });
        });
        describe('encoding requests', () => {
            it('does not use `jsonParsed` if no parsed type is queried', async () => {
                expect.assertions(2);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            lamports
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
                expect(fetchMock).toHaveBeenCalledWith(
                    'http://127.0.0.1:8899',
                    expect.objectContaining({
                        body: expect.stringContaining(
                            '"params":["Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",{"encoding":"base64"}]',
                        ),
                    }),
                );
            });
            it('uses only `base58` if one data field is requested with `base58` encoding', async () => {
                expect.assertions(2);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_58)
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
                expect(fetchMock).toHaveBeenCalledWith(
                    'http://127.0.0.1:8899',
                    expect.objectContaining({
                        body: expect.stringContaining(
                            '"params":["Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",{"encoding":"base58"}]',
                        ),
                    }),
                );
            });
            it('uses only `base64` if one data field is requested with `base64` encoding', async () => {
                expect.assertions(2);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_64)
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
                expect(fetchMock).toHaveBeenCalledWith(
                    'http://127.0.0.1:8899',
                    expect.objectContaining({
                        body: expect.stringContaining(
                            '"params":["Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",{"encoding":"base64"}]',
                        ),
                    }),
                );
            });
            it('uses only `base64+zstd` if one data field is requested with `base64+zstd` encoding', async () => {
                expect.assertions(2);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_64_ZSTD)
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
                expect(fetchMock).toHaveBeenCalledWith(
                    'http://127.0.0.1:8899',
                    expect.objectContaining({
                        body: expect.stringContaining(
                            '"params":["Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",{"encoding":"base64+zstd"}]',
                        ),
                    }),
                );
            });
            it('only uses `jsonParsed` if a parsed type is queried, but data is not', async () => {
                expect.assertions(2);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            ... on MintAccount {
                                supply
                            }
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
                expect(fetchMock).toHaveBeenCalledWith(
                    'http://127.0.0.1:8899',
                    expect.objectContaining({
                        body: expect.stringContaining(
                            '"params":["Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr",{"encoding":"jsonParsed"}]',
                        ),
                    }),
                );
            });
            it('does not call the loader twice for other base fields and `base58` encoding', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_58)
                            lamports
                            space
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('does not call the loader twice for other base fields and `base64` encoding', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_64)
                            lamports
                            space
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('does not call the loader twice for other base fields and `base64+zstd` encoding', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_64_ZSTD)
                            lamports
                            space
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('does not call the loader twice for other base fields and inline fragment', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            lamports
                            space
                            ... on MintAccount {
                                supply
                            }
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('will not make multiple calls for more than one inline fragment', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            ... on MintAccount {
                                supply
                            }
                            ... on TokenAccount {
                                lamports
                            }
                            ... on NonceAccount {
                                blockhash
                            }
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(1);
            });
            it('uses `jsonParsed` and the requested data encoding if a parsed type is queried alongside encoded data', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            data(encoding: BASE_64)
                            ... on MintAccount {
                                supply
                            }
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(2);
            });
            it('uses only the number of requests for the number of different encodings requested', async () => {
                expect.assertions(1);
                const source = /* GraphQL */ `
                    query testQuery {
                        account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                            dataBase58_1: data(encoding: BASE_58)
                            dataBase58_2: data(encoding: BASE_58)
                            dataBase58_3: data(encoding: BASE_58)
                            dataBase64_1: data(encoding: BASE_64)
                            dataBase64_2: data(encoding: BASE_64)
                            dataBase64_3: data(encoding: BASE_64)
                            dataBase64Zstd_1: data(encoding: BASE_64_ZSTD)
                            dataBase64Zstd_2: data(encoding: BASE_64_ZSTD)
                            dataBase64Zstd_3: data(encoding: BASE_64_ZSTD)
                            ... on MintAccount {
                                supply
                            }
                        }
                    }
                `;
                rpcGraphQL.query(source);
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.advanceTimersToNextTimerAsync();
                await jest.runAllTimersAsync();
                jest.runAllTicks();
                expect(fetchMock).toHaveBeenCalledTimes(4);
            });
        });
        describe('data slice requests', () => {
            describe('single account queries', () => {
                it('does not call the loader twice for data slice and other fields', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                lamports
                                space
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(1);
                });
                it('coalesces a data with no data slice and data with data slice within byte limit to the same request', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataWithNoSlice: data(encoding: BASE_64)
                                dataWithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(1);
                });
                it('coalesces non-sliced and sliced data requests across encodings', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataBase58WithNoSlice: data(encoding: BASE_58)
                                dataBase58WithSlice: data(encoding: BASE_58, dataSlice: { offset: 0, length: 10 })
                                dataBase64WithNoSlice: data(encoding: BASE_64)
                                dataBase64WithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataBase64ZstdWithNoSlice: data(encoding: BASE_64_ZSTD)
                                dataBase64ZstdWithSlice: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 10 }
                                )
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(3);
                });
                it('coalesces multiple data slice requests within byte limit to the same request', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2, length: 16 })
                                dataSlice3: data(encoding: BASE_64, dataSlice: { offset: 6, length: 20 })
                                dataSlice4: data(encoding: BASE_64, dataSlice: { offset: 10, length: 10 })
                                dataSlice5: data(encoding: BASE_64, dataSlice: { offset: 30, length: 10 })
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(1);
                });
                it('splits multiple data slice requests beyond byte limit into two requests', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2000, length: 4 })
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(2);
                });
                it('honors the byte limit across encodings', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataBase58WithinByteLimit: data(encoding: BASE_58, dataSlice: { offset: 0, length: 4 })
                                dataBase58BeyondByteLimit: data(
                                    encoding: BASE_58
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64WithinByteLimit: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataBase64BeyondByteLimit: data(
                                    encoding: BASE_64
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64ZstdWithinByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 4 }
                                )
                                dataBase64ZstdBeyondByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(6);
                });
            });
            describe('multiple account queries', () => {
                it('does not call the loader twice for data slice and other fields', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            accountA: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                lamports
                                space
                            }
                            accountB: account(address: "2KAARoNUYTddAChEdWb21bdKH6dWu51AAPFjSjRmzsbb") {
                                data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                lamports
                                space
                            }
                            accountC: account(address: "4rFV8bvFpacLkvxTFuVN4pqe5s7CTyEkmYvPpu45779u") {
                                data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                lamports
                                space
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(1);
                });
                it('coalesces a data with no data slice and data with data slice within byte limit to the same request', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            accountA: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataWithNoSlice: data(encoding: BASE_64)
                                dataWithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                            }
                            accountB: account(address: "2KAARoNUYTddAChEdWb21bdKH6dWu51AAPFjSjRmzsbb") {
                                dataWithNoSlice: data(encoding: BASE_64)
                                dataWithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                            }
                            accountC: account(address: "4rFV8bvFpacLkvxTFuVN4pqe5s7CTyEkmYvPpu45779u") {
                                dataWithNoSlice: data(encoding: BASE_64)
                                dataWithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(1);
                });
                it('coalesces non-sliced and sliced data requests across encodings', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            accountA: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataBase58WithNoSlice: data(encoding: BASE_58)
                                dataBase58WithSlice: data(encoding: BASE_58, dataSlice: { offset: 0, length: 10 })
                                dataBase64WithNoSlice: data(encoding: BASE_64)
                                dataBase64WithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataBase64ZstdWithNoSlice: data(encoding: BASE_64_ZSTD)
                                dataBase64ZstdWithSlice: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 10 }
                                )
                            }
                            accountB: account(address: "2KAARoNUYTddAChEdWb21bdKH6dWu51AAPFjSjRmzsbb") {
                                dataBase58WithNoSlice: data(encoding: BASE_58)
                                dataBase58WithSlice: data(encoding: BASE_58, dataSlice: { offset: 0, length: 10 })
                                dataBase64WithNoSlice: data(encoding: BASE_64)
                                dataBase64WithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataBase64ZstdWithNoSlice: data(encoding: BASE_64_ZSTD)
                                dataBase64ZstdWithSlice: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 10 }
                                )
                            }
                            accountC: account(address: "4rFV8bvFpacLkvxTFuVN4pqe5s7CTyEkmYvPpu45779u") {
                                dataBase58WithNoSlice: data(encoding: BASE_58)
                                dataBase58WithSlice: data(encoding: BASE_58, dataSlice: { offset: 0, length: 10 })
                                dataBase64WithNoSlice: data(encoding: BASE_64)
                                dataBase64WithSlice: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataBase64ZstdWithNoSlice: data(encoding: BASE_64_ZSTD)
                                dataBase64ZstdWithSlice: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 10 }
                                )
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(3);
                });
                it('coalesces multiple data slice requests within byte limit to the same request', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            accountA: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2, length: 16 })
                                dataSlice3: data(encoding: BASE_64, dataSlice: { offset: 6, length: 20 })
                                dataSlice4: data(encoding: BASE_64, dataSlice: { offset: 10, length: 10 })
                                dataSlice5: data(encoding: BASE_64, dataSlice: { offset: 30, length: 10 })
                            }
                            accountB: account(address: "2KAARoNUYTddAChEdWb21bdKH6dWu51AAPFjSjRmzsbb") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2, length: 16 })
                                dataSlice3: data(encoding: BASE_64, dataSlice: { offset: 6, length: 20 })
                                dataSlice4: data(encoding: BASE_64, dataSlice: { offset: 10, length: 10 })
                                dataSlice5: data(encoding: BASE_64, dataSlice: { offset: 30, length: 10 })
                            }
                            accountC: account(address: "4rFV8bvFpacLkvxTFuVN4pqe5s7CTyEkmYvPpu45779u") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 10 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2, length: 16 })
                                dataSlice3: data(encoding: BASE_64, dataSlice: { offset: 6, length: 20 })
                                dataSlice4: data(encoding: BASE_64, dataSlice: { offset: 10, length: 10 })
                                dataSlice5: data(encoding: BASE_64, dataSlice: { offset: 30, length: 10 })
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(1);
                });
                it('splits multiple data slice requests beyond byte limit into two requests', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            accountA: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2000, length: 4 })
                            }
                            accountB: account(address: "2KAARoNUYTddAChEdWb21bdKH6dWu51AAPFjSjRmzsbb") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2000, length: 4 })
                            }
                            accountC: account(address: "4rFV8bvFpacLkvxTFuVN4pqe5s7CTyEkmYvPpu45779u") {
                                dataSlice1: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataSlice2: data(encoding: BASE_64, dataSlice: { offset: 2000, length: 4 })
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(2);
                });
                it('honors the byte limit across encodings', async () => {
                    expect.assertions(1);
                    const source = /* GraphQL */ `
                        query testQuery {
                            accountA: account(address: "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr") {
                                dataBase58WithinByteLimit: data(encoding: BASE_58, dataSlice: { offset: 0, length: 4 })
                                dataBase58BeyondByteLimit: data(
                                    encoding: BASE_58
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64WithinByteLimit: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataBase64BeyondByteLimit: data(
                                    encoding: BASE_64
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64ZstdWithinByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 4 }
                                )
                                dataBase64ZstdBeyondByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                            }
                            accountB: account(address: "2KAARoNUYTddAChEdWb21bdKH6dWu51AAPFjSjRmzsbb") {
                                dataBase58WithinByteLimit: data(encoding: BASE_58, dataSlice: { offset: 0, length: 4 })
                                dataBase58BeyondByteLimit: data(
                                    encoding: BASE_58
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64WithinByteLimit: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataBase64BeyondByteLimit: data(
                                    encoding: BASE_64
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64ZstdWithinByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 4 }
                                )
                                dataBase64ZstdBeyondByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                            }
                            accountC: account(address: "4rFV8bvFpacLkvxTFuVN4pqe5s7CTyEkmYvPpu45779u") {
                                dataBase58WithinByteLimit: data(encoding: BASE_58, dataSlice: { offset: 0, length: 4 })
                                dataBase58BeyondByteLimit: data(
                                    encoding: BASE_58
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64WithinByteLimit: data(encoding: BASE_64, dataSlice: { offset: 0, length: 4 })
                                dataBase64BeyondByteLimit: data(
                                    encoding: BASE_64
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                                dataBase64ZstdWithinByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 0, length: 4 }
                                )
                                dataBase64ZstdBeyondByteLimit: data(
                                    encoding: BASE_64_ZSTD
                                    dataSlice: { offset: 2000, length: 4 }
                                )
                            }
                        }
                    `;
                    rpcGraphQL.query(source);
                    await jest.runAllTimersAsync();
                    jest.runAllTicks();
                    expect(fetchMock).toHaveBeenCalledTimes(6);
                });
            });
        });
    });
});

import { Address } from '@solana/addresses';
import { getBase58Codec, getBase64Codec } from '@solana/codecs-strings';
import { GetAccountInfoApi, GetMultipleAccountsApi } from '@solana/rpc-core';
import { Rpc } from '@solana/rpc-types';
import DataLoader from 'dataloader';

import {
    AccountLoader,
    AccountLoaderArgs,
    AccountLoaderArgsBase,
    AccountLoaderValue,
    BatchLoadPromiseCallback,
    cacheKeyFn,
    MultipleAccountsLoaderArgs,
} from './loader';

type AccountBatchLoadPromiseCallback = BatchLoadPromiseCallback<AccountLoaderValue>;
type AccountBatchLoadCallbackItem = {
    callback: AccountBatchLoadPromiseCallback;
    dataSlice: AccountLoaderArgsBase['dataSlice'] | null;
};

function argsHashSansDataSlice(args: AccountLoaderArgsBase) {
    const { commitment, encoding, minContextSlot } = args;
    return cacheKeyFn({ commitment, encoding, minContextSlot });
}

function getCodec(encoding: 'base58' | 'base64' | 'base64+zstd') {
    switch (encoding) {
        case 'base58':
            return getBase58Codec();
        case 'base64':
        case 'base64+zstd':
            // TODO: Handle 'base64+zstd' compression appropriately
            return getBase64Codec();
    }
}

function sliceData(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    account: any,
    dataSlice: AccountLoaderArgsBase['dataSlice'] | null,
    masterDataSlice: AccountLoaderArgsBase['dataSlice'],
) {
    if (dataSlice) {
        const masterOffset = masterDataSlice ? masterDataSlice.offset : 0;

        const slicedData = (data: string, encoding: 'base58' | 'base64' | 'base64+zstd'): string => {
            const { offset, length } = dataSlice;
            const codec = getCodec(encoding);
            const bytes = codec.encode(data);
            const trueOffset = offset - masterOffset;
            const slicedBytes = bytes.slice(trueOffset, trueOffset + length);
            return codec.decode(slicedBytes);
        };

        if (Array.isArray(account.data)) {
            const data = account.data[0];
            const encoding = account.data[1];
            if (data) {
                return {
                    ...account,
                    data: [slicedData(data, encoding), encoding],
                };
            }
        } else if (typeof account.data === 'string') {
            const data = account.data;
            if (data) {
                return {
                    ...account,
                    data: slicedData(data, 'base58'),
                };
            }
        }
    }
    return account;
}

async function loadAccount(rpc: Rpc<GetAccountInfoApi>, { address, ...config }: AccountLoaderArgs) {
    return await rpc
        .getAccountInfo(address, config)
        .send()
        .then(res => res.value);
}

async function loadMultipleAccounts(
    rpc: Rpc<GetMultipleAccountsApi>,
    { addresses, ...config }: MultipleAccountsLoaderArgs,
) {
    return await rpc
        .getMultipleAccounts(addresses, config)
        .send()
        .then(res => res.value);
}

function createAccountBatchLoadFn(rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>) {
    const resolveAccountUsingRpc = loadAccount.bind(null, rpc);
    const resolveMultipleAccountsUsingRpc = loadMultipleAccounts.bind(null, rpc);
    return async (accountQueryArgs: readonly AccountLoaderArgs[]): Promise<Promise<AccountLoaderValue>[]> => {
        const accountsToFetch: {
            [address: string]: Readonly<{
                args: AccountLoaderArgsBase;
                promiseCallback: AccountBatchLoadPromiseCallback;
            }>[];
        } = {};
        try {
            /**
             * Gather all the accounts that need to be fetched, grouped by address.
             */
            return accountQueryArgs.map(
                ({ address, ...args }) =>
                    new Promise((resolve, reject) => {
                        const accountRecords = (accountsToFetch[address] ||= []);
                        accountRecords.push({ args, promiseCallback: { reject, resolve } });
                    }),
            );
        } finally {
            /**
             * Group together accounts that are fetched with identical args.
             */
            const accountFetchesByArgsHash: {
                [argsHash: string]: {
                    args: AccountLoaderArgsBase;
                    addresses: {
                        [address: string]: {
                            callbacks: AccountBatchLoadCallbackItem[];
                        };
                    };
                };
            } = {};

            // Maximum number of acceptable bytes to waste before splitting two
            // `dataSlice` requests into two requests
            const maxByteRange = 200;

            Object.entries(accountsToFetch).forEach(([address, fetches]) => {
                // Keep track of any fetches that don't specify an encoding, to be
                // wrapped into another fetch that does
                const orphanedFetches: typeof fetches = [];
                const addedHashes: string[] = [];

                const addFetchByArgsHash = (
                    args: AccountLoaderArgsBase,
                    callbackItem: AccountBatchLoadCallbackItem,
                ) => {
                    const argsHash = cacheKeyFn(args);
                    const accountFetches = (accountFetchesByArgsHash[argsHash] ||= {
                        addresses: {},
                        args,
                    });
                    const { callbacks: promiseCallbacksForAddress } = (accountFetches.addresses[address] ||= {
                        callbacks: [],
                    });
                    promiseCallbacksForAddress.push(callbackItem);
                    addedHashes.push(argsHash);
                };

                fetches.forEach(({ args, promiseCallback }) => {
                    if (!args.encoding) {
                        // No encoding specified, it's an orphan for now
                        orphanedFetches.push({ args, promiseCallback });
                        return;
                    }
                    // As per the schema, `dataSlice` cannot be provided without
                    // encoding
                    if (args.dataSlice) {
                        // If the entry does have data slice provided, try to combine
                        // it with another request
                        const r = args.dataSlice;
                        for (const { addresses: addedAddresses, args: addedArgs } of Object.values(
                            accountFetchesByArgsHash,
                        )) {
                            const addCallbackWithDataSlice = (updateDataSlice?: AccountLoaderArgsBase['dataSlice']) => {
                                const { callbacks: promiseCallbacksForAddress } = (addedAddresses[address] ||= {
                                    callbacks: [],
                                });
                                promiseCallbacksForAddress.push({
                                    callback: promiseCallback,
                                    dataSlice: args.dataSlice ?? null,
                                });
                                if (updateDataSlice) {
                                    addedArgs.dataSlice = updateDataSlice;
                                }
                            };

                            if (argsHashSansDataSlice(args) === argsHashSansDataSlice(addedArgs)) {
                                if (addedArgs.dataSlice) {
                                    // A matching arg set - sans `DataSlice` - has its own
                                    // defined `DataSlice` argument.
                                    // Try to merge the two account fetches.
                                    const g = addedArgs.dataSlice;

                                    if (r.offset <= g.offset && g.offset - r.offset + r.length <= maxByteRange) {
                                        const length = Math.max(r.length, g.offset + g.length - r.offset);
                                        const offset = r.offset;
                                        addCallbackWithDataSlice({ length, offset });
                                        return;
                                    }
                                    if (r.offset >= g.offset && r.offset - g.offset + g.length <= maxByteRange) {
                                        const length = Math.max(g.length, r.offset + r.length - g.offset);
                                        const offset = g.offset;
                                        addCallbackWithDataSlice({ length, offset });
                                        return;
                                    }
                                } else {
                                    // A matching arg set - sans `DataSlice` - does _not_
                                    // have a data slice argument, meaning the entire
                                    // data buffer has been requested.
                                    // Merge the two account fetches.
                                    const { length, offset } = r;
                                    addCallbackWithDataSlice({ length, offset });
                                    return;
                                }
                            }
                        }
                    }
                    // If the entry has no data slice, or if the data slice was
                    // beyond the byte limit, add it to the list. Another request
                    // can possibly be combined with it.
                    addFetchByArgsHash(args, { callback: promiseCallback, dataSlice: args.dataSlice ?? null });
                });

                // Now place the orphans by searching for the best fetch with
                // encoding provided
                if (
                    addedHashes.length !== 0 &&
                    addedHashes.some(
                        hash =>
                            accountFetchesByArgsHash[hash].args.encoding &&
                            accountFetchesByArgsHash[hash].args.encoding !== 'base58',
                    )
                ) {
                    // At least one account fetch specified encoding, so use that encoding for all
                    // orphaned fetches
                    for (const hash of addedHashes) {
                        const entry = accountFetchesByArgsHash[hash];
                        const encoding = entry.args.encoding;
                        // `base58` should be avoided if possible, since it will cause errors
                        // from the RPC for larger accounts
                        if (encoding && encoding !== 'base58') {
                            orphanedFetches.forEach(({ promiseCallback }) => {
                                entry.addresses[address].callbacks.push({
                                    callback: promiseCallback,
                                    dataSlice: entry.args.dataSlice ?? null,
                                });
                            });
                            return;
                        }
                    }
                } else {
                    // No account fetches specified encoding, so use `base64`
                    orphanedFetches.forEach(({ args: orphanedArgs, promiseCallback: orphanPromiseCallback }) => {
                        const { commitment, dataSlice, minContextSlot } = orphanedArgs;
                        const defaultOrphanArgs: AccountLoaderArgsBase = {
                            commitment,
                            dataSlice,
                            encoding: 'base64',
                            minContextSlot,
                        };
                        addFetchByArgsHash(defaultOrphanArgs, {
                            callback: orphanPromiseCallback,
                            dataSlice: defaultOrphanArgs.dataSlice ?? null,
                        });
                    });
                }
            });

            /**
             * For each set of accounts related to some common args, fetch them in the fewest number
             * of network requests.
             */
            Object.values(accountFetchesByArgsHash).forEach(async ({ args, addresses: addressCallbacks }) => {
                const addresses = Object.keys(addressCallbacks) as Address[];
                if (addresses.length === 1) {
                    const address = addresses[0];
                    try {
                        const result = await resolveAccountUsingRpc({ address, ...args });
                        addressCallbacks[address].callbacks.forEach(({ callback, dataSlice }) => {
                            callback.resolve(sliceData(result, dataSlice, args.dataSlice));
                        });
                    } catch (e) {
                        addressCallbacks[address].callbacks.forEach(({ callback }) => {
                            callback.reject(e);
                        });
                    }
                } else {
                    // Maximum number of addresses per batch
                    // See https://docs.solana.com/api/http#getmultipleaccounts
                    const chunkSize = 100;
                    for (let i = 0; i < addresses.length; i += chunkSize) {
                        const chunk = addresses.slice(i, i + chunkSize);
                        try {
                            const results = await resolveMultipleAccountsUsingRpc({ addresses: chunk, ...args });
                            chunk.forEach((address, ii) => {
                                const result = results[ii];
                                addressCallbacks[address].callbacks.forEach(({ callback, dataSlice }) => {
                                    callback.resolve(sliceData(result, dataSlice, args.dataSlice));
                                });
                            });
                        } catch (e) {
                            chunk.forEach(address => {
                                addressCallbacks[address].callbacks.forEach(({ callback }) => {
                                    callback.reject(e);
                                });
                            });
                        }
                    }
                }
            });
        }
    };
}

export function createAccountLoader(rpc: Rpc<GetAccountInfoApi & GetMultipleAccountsApi>): AccountLoader {
    const loader = new DataLoader(createAccountBatchLoadFn(rpc), { cacheKeyFn });
    return {
        load: async args => loader.load(args),
    };
}

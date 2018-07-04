import { abi, ConfirmedTransaction, Contract, ReadSmartContract, RegisterTransaction } from '@neo-one/client';
import { Monitor } from '@neo-one/monitor';
import BigNumber from 'bignumber.js';
import * as _ from 'lodash';
import {
  Asset as AssetModel,
  Contract as ContractModel,
  NEP5_CONTRACT_TYPE,
  UNKNOWN_CONTRACT_TYPE,
} from 'neotracker-server-db';
import { utils } from 'neotracker-shared-utils';
import { Context } from '../types';
import { add0x } from './add0x';

const getAsset = (transaction: ConfirmedTransaction, blockTime: number): Partial<AssetModel> | undefined => {
  let asset: RegisterTransaction['asset'] | undefined;
  if (transaction.type === 'RegisterTransaction') {
    asset = transaction.asset;
  }

  if (transaction.type === 'InvocationTransaction') {
    asset = transaction.invocationData.asset;
  }

  if (asset !== undefined) {
    return {
      id: transaction.txid,
      transaction_id: transaction.data.globalIndex.toString(),
      transaction_hash: transaction.txid,
      type: asset.type,
      name_raw: JSON.stringify(asset.name),
      symbol: JSON.stringify(asset.name),
      amount: asset.amount.toString(),
      precision: asset.precision,
      owner: asset.owner,
      // tslint:disable-next-line no-null-keyword
      admin_address_id: asset.admin,
      block_time: blockTime,
      issued: '0',
      address_count: '0',
      transfer_count: '0',
      transaction_count: '0',
      aggregate_block_id: -1,
    };
  }

  return undefined;
};

const NEP5_ATTRIBUTES = ['totalSupply', 'name', 'symbol', 'decimals', 'balanceOf', 'transfer'].map((attribute) =>
  Buffer.from(attribute, 'utf8').toString('hex'),
);

const checkIsNEP5 = async (context: Context, contract: Contract) => {
  if (context.blacklistNEP5Hashes.has(contract.hash)) {
    return false;
  }

  return NEP5_ATTRIBUTES.every((attribute) => contract.script.includes(attribute));
};

const getContractAndAsset = async ({
  monitor,
  context,
  transaction,
  contract,
  blockIndex,
  blockTime,
}: {
  readonly monitor: Monitor;
  readonly context: Context;
  readonly transaction: ConfirmedTransaction;
  readonly contract: Contract;
  readonly blockIndex: number;
  readonly blockTime: number;
}): Promise<{
  readonly asset: Partial<AssetModel> | undefined;
  readonly contract: Partial<ContractModel> & { readonly id: string };
  readonly nep5Contract: ReadSmartContract | undefined;
}> => {
  const isNEP5 = await checkIsNEP5(context, contract);

  const contractModel = {
    id: contract.hash,
    script: contract.script,
    parameters_raw: JSON.stringify(contract.parameters),
    return_type: contract.returnType,
    needs_storage: contract.properties.storage,
    name: contract.name,
    version: contract.codeVersion,
    author: contract.author,
    email: contract.email,
    description: contract.description,
    transaction_id: transaction.data.globalIndex.toString(),
    transaction_hash: transaction.txid,
    block_time: blockTime,
    block_id: blockIndex,
    type: isNEP5 ? NEP5_CONTRACT_TYPE : UNKNOWN_CONTRACT_TYPE,
  };
  let asset: Partial<AssetModel> | undefined;
  let nep5Contract: ReadSmartContract | undefined;
  if (isNEP5) {
    const contractABI = await abi.NEP5({
      client: context.client,
      hash: add0x(contractModel.id),
    });

    nep5Contract = context.client.smartContract({
      hash: add0x(contractModel.id),
      abi: contractABI,
    });

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      nep5Contract.name(monitor),
      nep5Contract.symbol(monitor),
      nep5Contract.decimals(monitor),
      nep5Contract.totalSupply(monitor).catch(() => new BigNumber(0)),
    ]);

    asset = {
      id: contractModel.id,
      transaction_id: transaction.data.globalIndex.toString(),
      transaction_hash: transaction.txid,
      type: 'NEP5',
      name_raw: JSON.stringify(name),
      symbol,
      amount: totalSupply.toString(),
      precision: decimals.toNumber(),
      // tslint:disable-next-line no-null-keyword
      owner: null,
      // tslint:disable-next-line no-null-keyword
      admin_address_id: null,
      block_time: blockTime,
      issued: '0',
      address_count: '0',
      transfer_count: '0',
      transaction_count: '0',
      aggregate_block_id: -1,
    };
  }

  return { asset, contract: contractModel, nep5Contract };
};

const getContracts = async ({
  monitor,
  context,
  transaction,
  blockIndex,
  blockTime,
}: {
  readonly monitor: Monitor;
  readonly context: Context;
  readonly transaction: ConfirmedTransaction;
  readonly blockIndex: number;
  readonly blockTime: number;
}): Promise<{
  readonly assets: ReadonlyArray<Partial<AssetModel>>;
  readonly contracts: ReadonlyArray<Partial<ContractModel>>;
  readonly nep5Contracts: ReadonlyArray<{ readonly contractID: string; readonly nep5Contract: ReadSmartContract }>;
}> => {
  let contracts: ReadonlyArray<Contract> = [];
  if (transaction.type === 'InvocationTransaction') {
    contracts = transaction.invocationData.contracts;
  }

  if (transaction.type === 'PublishTransaction') {
    contracts = [transaction.contract];
  }

  const results = await Promise.all(
    contracts.map(async (contract) =>
      getContractAndAsset({ monitor, context, transaction, contract, blockIndex, blockTime }),
    ),
  );

  return {
    assets: results.map(({ asset }) => asset).filter(utils.notNull),
    contracts: results.map(({ contract }) => contract),
    nep5Contracts: results
      .map(
        ({ contract, nep5Contract }) =>
          nep5Contract === undefined ? undefined : { contractID: contract.id, nep5Contract },
      )
      .filter(utils.notNull),
  };
};

export const getAssetsAndContractsForClient = async ({
  monitor,
  context,
  transactions,
  blockIndex,
  blockTime,
}: {
  readonly monitor: Monitor;
  readonly context: Context;
  readonly transactions: ReadonlyArray<{
    readonly transaction: ConfirmedTransaction;
    readonly transactionIndex: number;
  }>;
  readonly blockIndex: number;
  readonly blockTime: number;
}): Promise<{
  readonly assets: ReadonlyArray<Partial<AssetModel>>;
  readonly contracts: ReadonlyArray<Partial<ContractModel>>;
  readonly context: Context;
}> => {
  const assets = transactions.map(({ transaction }) => getAsset(transaction, blockTime)).filter(utils.notNull);
  const results = await Promise.all(
    transactions.map(async ({ transaction }) => getContracts({ monitor, context, transaction, blockIndex, blockTime })),
  );

  return {
    assets: assets.concat(_.flatMap(results.map(({ assets: contractAssets }) => contractAssets))),
    contracts: _.flatMap(results.map(({ contracts }) => contracts)),
    context: {
      ...context,
      nep5Contracts: _.flatMap(results.map(({ nep5Contracts }) => nep5Contracts)).reduce(
        (acc, { contractID, nep5Contract }) => ({
          ...acc,
          [contractID]: nep5Contract,
        }),
        context.nep5Contracts,
      ),
    },
  };
};

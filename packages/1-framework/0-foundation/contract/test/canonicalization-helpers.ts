import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import {
  type CanonicalizeContractOptions,
  canonicalizeContract as canonicalizeContractRaw,
  canonicalizeContractToObject as canonicalizeContractToObjectRaw,
} from '../src/canonicalization';
import { createPreserveEmptyPredicate, type PathPattern } from '../src/canonicalization-path-match';
import { createStorageSort, type NamedArraySortTarget } from '../src/canonicalization-storage-sort';
import type { Contract } from '../src/contract-types';
import type { ContractModelBase, ContractValueObject } from '../src/domain-types';
import { asNamespaceId } from '../src/namespace-id';
import { coreHash, profileHash } from '../src/types';
import { applicationDomainOf } from './support/application-domain-of';

export function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

// Tests author JSON-clean contracts directly, so the canonicalisation
// hook trivially passes through.
const identityOptions = {
  serializeContract: (c: Contract): JsonObject => c as unknown as JsonObject,
} satisfies CanonicalizeContractOptions;

export function canonicalizeContractToObject(
  contract: Contract,
  options?: Omit<CanonicalizeContractOptions, 'serializeContract'>,
): Record<string, unknown> {
  return canonicalizeContractToObjectRaw(contract, { ...identityOptions, ...options });
}

export function canonicalizeContract(
  contract: Contract,
  options?: Omit<CanonicalizeContractOptions, 'serializeContract'>,
): string {
  return canonicalizeContractRaw(contract, { ...identityOptions, ...options });
}

// `constraint`/`index` below are illustrative boolean fields exercising the
// generic empty-value preservation mechanism — not a claim about the real
// SQL contract's `ForeignKey` shape, which (post FK1) never carries them.
const sqlPreserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'foreignKeys', ['constraint', 'index']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*', 'default', 'value'],
] as const satisfies readonly PathPattern[];

const sqlSortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

export const sqlPreserveEmpty = createPreserveEmptyPredicate(sqlPreserveEmptyPatterns);
export const sqlSortStorage = createStorageSort(sqlSortTargets);

export function minimal(overrides?: Record<string, unknown>): Contract {
  const models = (overrides?.['models'] as Record<string, unknown> | undefined) ?? {};
  const valueObjects = overrides?.['valueObjects'] as Record<string, unknown> | undefined;
  const domainOverride = overrides?.['domain'];
  const {
    models: _models,
    valueObjects: _valueObjects,
    domain: _domain,
    ...rest
  } = overrides ?? {};
  return {
    targetFamily: 'sql',
    target: 'postgres',
    roots: {},
    domain:
      domainOverride !== undefined
        ? (domainOverride as Contract['domain'])
        : applicationDomainOf({
            models: models as Record<string, ContractModelBase>,
            ...ifDefined(
              'valueObjects',
              valueObjects !== undefined
                ? blindCast<Record<string, ContractValueObject>, 'canonicalization test fixtures'>(
                    valueObjects,
                  )
                : undefined,
            ),
          }),
    storage: { storageHash: coreHash('stub'), namespaces: {} },
    extensions: {},
    capabilities: {},
    meta: {},
    profileHash: profileHash('stub'),
    ...rest,
  };
}

export const UNBOUND = '__unbound__';

export function unboundStorage(tables: Record<string, unknown>): Record<string, unknown> {
  return {
    storageHash: 'stub',
    namespaces: {
      [UNBOUND]: { id: UNBOUND, entries: { table: tables } },
    },
  };
}

export function drill(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  let current: unknown = obj;
  for (const key of keys) {
    current = (current as Record<string, unknown>)[key];
  }
  return current as Record<string, unknown>;
}

export function unboundTables(result: Record<string, unknown>): Record<string, unknown> {
  return drill(result, 'storage', 'namespaces', UNBOUND, 'entries', 'table');
}

export function drillDomainModel(
  result: Record<string, unknown>,
  modelName: string,
  ...path: string[]
): Record<string, unknown> {
  return drill(result, 'domain', 'namespaces', UNBOUND, 'models', modelName, ...path);
}

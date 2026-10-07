import type { Contract } from '@internal/contract/types';
import {
  type CallSubjects,
  type SubjectTarget,
  storageNameOfOperation,
} from '@internal/family-sql/control';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { resolveNamespaceIdForDdlSchema } from './control-policy';
import {
  AlterColumnTypeCall,
  CreatePostgresRlsPolicyCall,
  DisableRowLevelSecurityCall,
  DropColumnCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  RawSqlCall,
} from './op-factory-call';

interface Locator {
  /** The contract that names the namespaces: the origin contract when the plan has one. */
  readonly contract: Contract<SqlStorage>;
}

function storageNamespaceId(locator: Locator, schemaName: string): string {
  return schemaName === UNBOUND_NAMESPACE_ID
    ? UNBOUND_NAMESPACE_ID
    : resolveNamespaceIdForDdlSchema(locator.contract, schemaName);
}

function qualified(schemaName: string, name: string): string {
  return schemaName === UNBOUND_NAMESPACE_ID ? name : `${schemaName}.${name}`;
}

function target(
  locator: Locator,
  schemaName: string,
  table: string,
  column: string | undefined,
): SubjectTarget {
  return {
    storageName: qualified(schemaName, column === undefined ? table : `${table}.${column}`),
    table: { namespaceId: storageNamespaceId(locator, schemaName), table, column },
  };
}

function rawSqlTarget(locator: Locator, call: RawSqlCall): SubjectTarget {
  const details = call.op.target.details;
  if (details === undefined) return { storageName: call.op.id, table: undefined };
  if (details.objectType === 'table')
    return target(locator, details.schema, details.name, undefined);
  if (details.objectType === 'column' && details.table !== undefined) {
    return target(locator, details.schema, details.table, details.name);
  }
  return { storageName: storageNameOfOperation(call.op), table: undefined };
}

function dataLossOf(locator: Locator, call: OpFactoryCall): readonly SubjectTarget[] {
  if (call.operationClass !== 'destructive') return [];
  if (call instanceof DropTableCall) {
    return [target(locator, call.schemaName, call.tableName, undefined)];
  }
  if (call instanceof DropColumnCall || call instanceof AlterColumnTypeCall) {
    return [target(locator, call.schemaName, call.tableName, call.columnName)];
  }
  if (call instanceof RawSqlCall) return [rawSqlTarget(locator, call)];
  return [{ storageName: call.factoryName, table: undefined }];
}

function policyKey(schemaName: string, tableName: string, policyName: string): string {
  return JSON.stringify([schemaName, tableName, policyName]);
}

/**
 * The policies the plan creates. A drop of one of them is the first half of a replacement, which
 * leaves the policy in place, so it widens no access.
 */
function createdPolicies(calls: readonly OpFactoryCall[]): ReadonlySet<string> {
  return new Set(
    calls.flatMap((call) =>
      call instanceof CreatePostgresRlsPolicyCall
        ? [policyKey(call.schemaName, call.tableName, call.policy.name)]
        : [],
    ),
  );
}

function accessWideningOf(
  locator: Locator,
  call: OpFactoryCall,
  replaced: ReadonlySet<string>,
): readonly SubjectTarget[] {
  if (call instanceof DisableRowLevelSecurityCall) {
    return [target(locator, call.schemaName, call.tableName, undefined)];
  }
  if (
    call instanceof DropPostgresRlsPolicyCall &&
    !replaced.has(policyKey(call.schemaName, call.tableName, call.policyName))
  ) {
    return [target(locator, call.schemaName, call.tableName, undefined)];
  }
  return [];
}

function operationCountOf(call: OpFactoryCall): number {
  return 'companions' in call && Array.isArray(call.companions) ? 1 + call.companions.length : 1;
}

/** What each call of a Postgres plan loses, and whose access it widens. */
export function postgresCallSubjects(
  calls: readonly OpFactoryCall[],
  locator: Locator,
): readonly CallSubjects[] {
  const replaced = createdPolicies(calls);
  return calls.map((call) => ({
    operationCount: operationCountOf(call),
    dataLoss: dataLossOf(locator, call),
    accessWidening: accessWideningOf(locator, call, replaced),
  }));
}

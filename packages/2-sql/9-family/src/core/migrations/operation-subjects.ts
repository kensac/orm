import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type {
  MigrationOperationSubject,
  MigrationStatementSubject,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import {
  fieldRenameStorageEffect,
  isSqlModelStorage,
  modelRenameStorageEffect,
} from './statement-planning';

/**
 * What an operation is about, as the plan names it after its rename statements: a table, or a
 * column of one, in a storage namespace, or neither, such as a type. `storageName` names the
 * subject when no model of the origin contract stores it.
 */
export interface SubjectTarget {
  readonly storageName: string;
  readonly table:
    | {
        readonly namespaceId: string;
        readonly table: string;
        readonly column: string | undefined;
      }
    | undefined;
}

/** A call of a plan: how many operations it lowers to, and what the first of them is about. */
export interface CallSubjects {
  readonly operationCount: number;
  /** What the call's operation loses, one entry per model, field or storage name. */
  readonly dataLoss: readonly SubjectTarget[];
  /** What the call's operation widens access to. */
  readonly accessWidening: readonly SubjectTarget[];
}

export interface PlanSubjects {
  readonly dataLoss: readonly MigrationOperationSubject[];
  readonly accessWidening: readonly MigrationOperationSubject[];
}

interface SubjectContext {
  readonly fromContract: ContractWithDomain | null;
  readonly contract: ContractWithDomain;
  /** The rename statements the plan applied, whose renames a target names the new way. */
  readonly statements: readonly ResolvedMigrationStatement[];
}

function originTable(
  context: SubjectContext & { readonly fromContract: ContractWithDomain },
  namespaceId: string,
  table: string,
): string {
  for (const statement of context.statements) {
    if (statement.entity !== 'model') continue;
    const effect = modelRenameStorageEffect(statement, context.fromContract, context.contract);
    if (!effect.ok || effect.value.kind !== 'renameTable') continue;
    const { rename } = effect.value;
    if (rename.namespaceId === namespaceId && rename.to === table) return rename.from;
  }
  return table;
}

function originColumn(
  context: SubjectContext & { readonly fromContract: ContractWithDomain },
  namespaceId: string,
  table: string,
  column: string,
): string {
  for (const statement of context.statements) {
    if (statement.entity !== 'field') continue;
    const effect = fieldRenameStorageEffect(statement, context.fromContract, context.contract);
    if (!effect.ok || effect.value.kind !== 'renameColumn') continue;
    const rename = effect.value;
    if (
      rename.table.namespaceId === namespaceId &&
      rename.table.table === table &&
      rename.to === column
    ) {
      return rename.from;
    }
  }
  return column;
}

function subjectOf(target: SubjectTarget, context: SubjectContext): MigrationStatementSubject {
  const storage: MigrationStatementSubject = { kind: 'storage', name: target.storageName };
  const { fromContract } = context;
  if (target.table === undefined || fromContract === null) return storage;
  const withOrigin = { ...context, fromContract };
  const { namespaceId } = target.table;
  const table = originTable(withOrigin, namespaceId, target.table.table);
  for (const [modelNamespace, namespace] of Object.entries(fromContract.domain.namespaces)) {
    for (const [model, { storage: modelStorage }] of Object.entries(namespace.models)) {
      if (!isSqlModelStorage(modelStorage)) continue;
      if (modelStorage.namespaceId !== namespaceId || modelStorage.table !== table) continue;
      const coordinate = { namespaceId: asNamespaceId(modelNamespace), model };
      if (target.table.column === undefined) return { kind: 'model', ...coordinate };
      const column = originColumn(withOrigin, namespaceId, table, target.table.column);
      const field = Object.entries(modelStorage.fields).find(
        ([, stored]) => stored.column === column,
      )?.[0];
      return field === undefined ? storage : { kind: 'field', ...coordinate, field };
    }
  }
  return storage;
}

/**
 * The subject of each operation that loses data and each that widens access, at its position in
 * the plan. A subject is a model or a field of the origin contract when one stores it, found under
 * its origin name when a rename statement renamed its table or column earlier in the plan.
 */
export function planSubjects(
  calls: readonly CallSubjects[],
  context: SubjectContext,
): PlanSubjects {
  const dataLoss: MigrationOperationSubject[] = [];
  const accessWidening: MigrationOperationSubject[] = [];
  let operationIndex = 0;
  for (const call of calls) {
    for (const target of call.dataLoss) {
      dataLoss.push({ operationIndex, subject: subjectOf(target, context) });
    }
    for (const target of call.accessWidening) {
      accessWidening.push({ operationIndex, subject: subjectOf(target, context) });
    }
    operationIndex += call.operationCount;
  }
  return { dataLoss, accessWidening };
}

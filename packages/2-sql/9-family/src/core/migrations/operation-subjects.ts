import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import type {
  MigrationOperationSubject,
  MigrationStatementSubject,
  ModelCoordinate,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import type { SqlModelStorage } from '@internal/sql-contract/types';
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

interface StoringModel {
  readonly coordinate: ModelCoordinate;
  readonly isRoot: boolean;
  readonly fields: SqlModelStorage['fields'];
}

/** The models of `contract` that store `table`: a model and its variants share one. */
function modelsStoring(
  contract: ContractWithDomain,
  namespaceId: string,
  table: string,
): readonly StoringModel[] {
  return Object.entries(contract.domain.namespaces).flatMap(([modelNamespace, namespace]) =>
    Object.entries(namespace.models).flatMap(([model, definition]) => {
      const { storage } = definition;
      if (!isSqlModelStorage(storage)) return [];
      if (storage.namespaceId !== namespaceId || storage.table !== table) return [];
      return [
        {
          coordinate: { namespaceId: asNamespaceId(modelNamespace), model },
          isRoot: definition.base === undefined,
          fields: storage.fields,
        },
      ];
    }),
  );
}

function subjectOf(target: SubjectTarget, context: SubjectContext): MigrationStatementSubject {
  const storage: MigrationStatementSubject = { kind: 'storage', name: target.storageName };
  const { fromContract } = context;
  if (target.table === undefined || fromContract === null) return storage;
  const withOrigin = { ...context, fromContract };
  const { namespaceId } = target.table;
  const table = originTable(withOrigin, namespaceId, target.table.table);
  const models = modelsStoring(fromContract, namespaceId, table);
  if (target.table.column === undefined) {
    const model = models.find(({ isRoot }) => isRoot) ?? models[0];
    return model === undefined ? storage : { kind: 'model', ...model.coordinate };
  }
  const column = originColumn(withOrigin, namespaceId, table, target.table.column);
  for (const model of [...models].sort((a, b) => Number(b.isRoot) - Number(a.isRoot))) {
    const field = Object.entries(model.fields).find(([, stored]) => stored.column === column)?.[0];
    if (field !== undefined) return { kind: 'field', ...model.coordinate, field };
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

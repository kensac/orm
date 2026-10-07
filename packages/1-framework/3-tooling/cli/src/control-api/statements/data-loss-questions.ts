import type { ContractWithDomain } from '@internal/contract/types';
import {
  type MigrationStatementSubject,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { resolveStatements } from './resolve-statements';
import type { StatementText } from './statement-text';

/** A verb a data-loss question accepts. */
export type DataLossVerb = 'rename' | 'delete';

/**
 * What a command asks about one operation that would lose data: the question, its subject written
 * as the statement names it, and the verbs that answer it. A command hands it to its prompt.
 */
export interface DataLossQuestion {
  readonly question: string;
  readonly subject: string;
  readonly verbs: readonly DataLossVerb[];
  readonly forms: { readonly rename?: string };
  readonly validate: (verb: DataLossVerb, text: string) => string | undefined;
}

export interface DataLossAnswer {
  readonly verb: DataLossVerb;
  readonly text: string;
}

/** Asks every question at once and returns the answers in question order. */
export type AnswerDataLoss = (
  questions: readonly DataLossQuestion[],
) => Promise<readonly DataLossAnswer[]>;

/**
 * An operation of a plan that would lose data, with the label of that operation. `operationIndex`
 * is its position among the operations the result lists; `undefined` when the plan could not
 * resolve it.
 */
export interface PlannedDataLoss {
  readonly operationIndex: number | undefined;
  readonly label: string;
  readonly subject: MigrationStatementSubject;
}

function modelText(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? modelDisplayName(coordinate)
    : coordinate.model;
}

/** The contracts a statement names things in, and the renames the plan applies so far. */
export interface StatementContracts {
  readonly origin: ContractWithDomain;
  /** The destination contract; needed only to name a field of a renamed model. */
  readonly destination?: ContractWithDomain;
  readonly renames: readonly StatementText[];
}

/** The model a rename statement of `contracts` gives `coordinate` in the destination, if any. */
function renamedModel(
  coordinate: ModelCoordinate,
  contracts: StatementContracts,
): ModelCoordinate | undefined {
  if (contracts.destination === undefined || contracts.renames.length === 0) return undefined;
  const resolved = resolveStatements({
    statements: contracts.renames,
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  if (!resolved.ok) return undefined;
  return resolved.value.find(
    (statement) =>
      statement.entity === 'model' &&
      statement.from.namespaceId === coordinate.namespaceId &&
      statement.from.model === coordinate.model,
  )?.to;
}

/**
 * The subject as a statement names it: `Model` or `Model.field`, with the namespace when its
 * contract has several, or the storage name when no model stores what the operation loses. A
 * field of a model the plan renames is named through the model's new name, as a rename of the
 * field is written.
 */
export function subjectText(
  subject: MigrationStatementSubject,
  contracts: StatementContracts,
): string {
  switch (subject.kind) {
    case 'model':
      return modelText(contracts.origin, subject);
    case 'field': {
      const renamed = renamedModel(subject, contracts);
      const model =
        renamed === undefined || contracts.destination === undefined
          ? modelText(contracts.origin, subject)
          : modelText(contracts.destination, renamed);
      return `${model}.${subject.field}`;
    }
    case 'storage':
      return subject.name;
  }
}

function lossText(subject: MigrationStatementSubject, text: string): string {
  switch (subject.kind) {
    case 'model':
      return `would lose the data of model "${text}"`;
    case 'field':
      return `would lose the values of field "${text}"`;
    case 'storage':
      return `would lose the data in "${text}", which no model of the origin contract stores`;
  }
}

function sameCoordinate(
  statement: ResolvedMigrationStatement,
  subject: MigrationStatementSubject,
): boolean {
  if (subject.kind === 'storage') return false;
  const { from } = statement;
  if (from.namespaceId !== subject.namespaceId || from.model !== subject.model) return false;
  return subject.kind === 'field'
    ? statement.entity === 'field' && statement.from.field === subject.field
    : statement.entity === 'model';
}

/**
 * The question for one operation that would lose data. A model or field may be renamed instead of
 * deleted; a rename is resolved against the two contracts after the plan's other renames, and its
 * old name must be the subject. Data no model stores can only be deleted.
 */
export function dataLossQuestion(
  loss: PlannedDataLoss,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): DataLossQuestion {
  const subject = subjectText(loss.subject, contracts);
  const renamable = loss.subject.kind !== 'storage';
  return {
    question: `${loss.label} ${lossText(loss.subject, subject)}.`,
    subject,
    verbs: renamable ? ['rename', 'delete'] : ['delete'],
    forms: renamable ? { rename: `${subject}:<new name>` } : {},
    validate: (verb, text) => {
      if (verb === 'delete') {
        return text === subject ? undefined : `Delete names "${subject}": --delete ${subject}.`;
      }
      const resolved = resolveStatements({
        statements: [...contracts.renames, { verb: 'rename', text }],
        origin: { kind: 'contract', contract: contracts.origin },
        destination: contracts.destination,
      });
      if (!resolved.ok) return `${resolved.failure.message}. ${resolved.failure.why ?? ''}`.trim();
      const statement = resolved.value.at(-1);
      return statement !== undefined && sameCoordinate(statement, loss.subject)
        ? undefined
        : `The rename's old name is not "${subject}". Write it as ${subject}:<new name>.`;
    },
  };
}

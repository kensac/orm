import type { ContractWithDomain } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
  type MigrationStatementJson,
  type MigrationStatementSubject,
  type MigrationStatementSubjectJson,
  migrationStatementJson,
  migrationStatementSubjectJson,
} from '@internal/framework-components/control';

/** A delete statement in JSON output: the subject whose data it consents to lose. */
export interface DeleteStatementJson {
  readonly kind: 'delete';
  readonly subject: MigrationStatementSubjectJson;
}

/**
 * A statement a plan applied, as the CLI reports it: its verb, the statement as JSON output writes
 * it, the positions of its operations in the result's `operations`, and its description.
 */
export type AppliedStatementReport =
  | {
      readonly verb: 'rename';
      readonly statement: MigrationStatementJson;
      readonly operationIndexes: readonly number[];
      /** The statement in domain names, for example `rename model "Profile" to "User"`. */
      readonly description: string;
    }
  | {
      readonly verb: 'delete';
      readonly statement: DeleteStatementJson;
      readonly operationIndexes: readonly number[];
      /** The statement in domain names, for example `delete model "Legacy"`. */
      readonly description: string;
    };

/**
 * `operationOffset` is the number of operations the result lists before the plan that applied the
 * statements, so that each position indexes the result's `operations`.
 */
export function reportAppliedStatements(
  applied: readonly AppliedMigrationStatement[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
  operationOffset: number,
): readonly AppliedStatementReport[] {
  return applied.map((entry) => ({
    verb: 'rename',
    statement: migrationStatementJson(entry.statement),
    operationIndexes: entry.operationIndexes.map((index) => operationOffset + index),
    description: describeMigrationStatement(entry.statement, fromContract ?? contract, contract),
  }));
}

/** A delete statement a plan applied: the subject it consents to lose, and that loss's operations. */
export function reportDeleteStatement(
  subject: MigrationStatementSubject,
  operationIndexes: readonly number[],
  fromContract: ContractWithDomain,
): AppliedStatementReport {
  return {
    verb: 'delete',
    statement: { kind: 'delete', subject: migrationStatementSubjectJson(subject) },
    operationIndexes,
    description: describeMigrationStatement(
      { kind: 'delete', subject },
      fromContract,
      fromContract,
    ),
  };
}

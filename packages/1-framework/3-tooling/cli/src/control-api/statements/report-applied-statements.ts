import type { ContractWithDomain } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
  type MigrationStatementJson,
  migrationStatementJson,
} from '@internal/framework-components/control';

/**
 * A statement a plan applied, as the CLI reports it: the statement as JSON output writes it, the
 * positions of its operations in the result's `operations`, and its description.
 */
export interface AppliedStatementReport {
  readonly statement: MigrationStatementJson;
  readonly operationIndexes: readonly number[];
  /** The statement in domain names, for example `rename model "Profile" to "User"`. */
  readonly description: string;
}

export function reportAppliedStatements(
  applied: readonly AppliedMigrationStatement[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
): readonly AppliedStatementReport[] {
  return applied.map((entry) => ({
    statement: migrationStatementJson(entry.statement),
    operationIndexes: entry.operationIndexes,
    description: describeMigrationStatement(entry.statement, fromContract ?? contract, contract),
  }));
}

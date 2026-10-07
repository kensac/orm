import type { ContractWithDomain } from '@internal/contract/types';
import {
  type AppliedMigrationStatement,
  describeMigrationStatement,
} from '@internal/framework-components/control';

/** A statement a plan applied, as the CLI reports it: the planner's entry and its description. */
export interface AppliedStatementReport extends AppliedMigrationStatement {
  /** The statement in domain names, for example `rename model "Profile" to "User"`. */
  readonly description: string;
}

export function reportAppliedStatements(
  applied: readonly AppliedMigrationStatement[],
  fromContract: ContractWithDomain | null,
  contract: ContractWithDomain,
): readonly AppliedStatementReport[] {
  return applied.map((entry) => ({
    ...entry,
    description: describeMigrationStatement(entry.statement, fromContract ?? contract, contract),
  }));
}

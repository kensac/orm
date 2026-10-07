import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ReferentialAction } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { OperationClass, PostgresPlanTargetDetails } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Literal-args shape for a foreign key definition. `references.schema`
 * carries the target table's namespace (schema) coordinate so the rendered
 * DDL qualifies the REFERENCES clause correctly for cross-schema FKs.
 */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: {
    readonly schema: string;
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

/**
 * The name an operation id uses for a table or type: `schema.name`, or `name` alone in the unbound
 * namespace. Every Postgres id that names a table or type uses it, so ids are unique within a plan
 * even when two schemas hold objects of the same name.
 */
export function qualifiedIdName(schemaName: string, name: string): string {
  return schemaName === UNBOUND_NAMESPACE_ID ? name : `${schemaName}.${name}`;
}

export function step(description: string, sql: string, params?: readonly unknown[]) {
  return { description, sql, ...ifDefined('params', params) };
}

export function targetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): { readonly id: 'postgres'; readonly details: PostgresPlanTargetDetails } {
  return {
    id: 'postgres',
    details: { schema, objectType, name, ...ifDefined('table', table) },
  };
}

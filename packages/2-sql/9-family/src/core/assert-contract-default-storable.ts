import type { ColumnDefault } from '@internal/contract/types';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import { contractDefaultRefusal } from '@internal/sql-schema-ir/types';
import { sqlFamilyError } from './errors';

/**
 * Refuses to plan a column whose contract default its data type does not store, which a contract
 * emitted by an earlier version can hold.
 */
export function assertContractDefaultStorable(
  column: string,
  columnDefault: ColumnDefault | undefined,
  toCanonicalForm: ToCanonicalForm | undefined,
  many: boolean,
): void {
  const refusal = contractDefaultRefusal(columnDefault, toCanonicalForm, many);
  if (refusal === undefined) return;
  throw sqlFamilyError('CONTRACT.DEFAULT_INVALID', `Column "${column}": ${refusal}`, {
    meta: { reason: 'default-not-canonical', column },
  });
}

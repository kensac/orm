import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { getCollectionFieldColumns, resolveFieldColumn } from './collection-contract';

export function mapFieldsToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
  fieldNames: readonly string[],
): string[] {
  const fieldColumns = getCollectionFieldColumns(contract, namespaceId, modelName, variantName);
  return fieldNames.map((fieldName) => resolveFieldColumn(fieldColumns, modelName, fieldName));
}

export function mapCursorValuesToColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
  cursorValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fieldColumns = getCollectionFieldColumns(contract, namespaceId, modelName, variantName);
  const mappedCursor: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(cursorValues)) {
    if (value === undefined) {
      continue;
    }

    mappedCursor[resolveFieldColumn(fieldColumns, modelName, fieldName)] = value;
  }

  return mappedCursor;
}

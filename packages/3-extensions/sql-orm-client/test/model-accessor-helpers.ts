import { dataTypeId } from '@internal/framework-components/codec';
import type { CodecTrait } from '@internal/sql-relational-core/ast';
import { BinaryExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { expect } from 'vitest';
import { getTestContext } from './helpers';
import { unboundTables } from './unbound-tables';

export const context = getTestContext();

export function paramRef(table: string, column: string, value: unknown): ParamRef {
  const tables = unboundTables(context.contract.storage) as Record<
    string,
    { columns: Record<string, { codecId?: string }> } | undefined
  >;
  const codecId = tables[table]?.columns[column]?.codecId;
  return codecId ? ParamRef.of(value, { codec: { codecId } }) : ParamRef.of(value);
}

export function expectBinaryParam(
  actual: unknown,
  table: string,
  column: string,
  op: BinaryExpr['op'],
  value: unknown,
) {
  expect(actual).toEqual(
    new BinaryExpr(op, ColumnRef.of(table, column), paramRef(table, column, value)),
  );
}

export function makeDescriptors(
  entries: Record<string, readonly CodecTrait[]>,
): typeof context.codecDescriptors {
  const map = new Map(
    Object.entries(entries).map(([codecId, traits]) => [
      codecId,
      {
        codecId,
        traits,
        paramsSchema: {
          '~standard': {
            version: 1 as const,
            vendor: 'test',
            validate: (_value: unknown) => ({ value: undefined }),
          },
        },
        isParameterized: false,
        dataType: dataTypeId('demo/fixture'),
        // The trait-gating tests don't materialize codecs; the factory is shape-only and never invoked.
        factory: () => () => {
          throw new Error('test descriptor factory not exercised');
        },
      },
    ]),
  );
  return {
    descriptorFor: (id) => map.get(id),
    codecRefForColumn: () => undefined,
    values: function* () {
      yield* map.values();
    },
  };
}

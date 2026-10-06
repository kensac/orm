import { type ColumnDefault, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { FunctionColumnDefault, opaqueSql } from '@internal/sql-relational-core/ast';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { parseSqliteDefault } from '../src/core/default-normalizer';
import { columnSpecFromNode, ddlColumnFromNode } from '../src/core/migrations/column-ddl-rendering';
import { buildSqlitePlanDiff } from '../src/core/migrations/diff-database-schema';
import { sqliteCreateNamespace } from '../src/core/sqlite-unbound-database';
import {
  EXTENSION_DATETIME_CODEC_ID,
  ExtensionDatetimeDescriptor,
} from './extension-datetime-codec';
import { sqliteTestComponents, sqliteTestTypes } from './sqlite-test-types';

function liveSchema(rawDefault: string): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      event: new SqlTableIR({
        name: 'event',
        columns: {
          at: {
            name: 'at',
            nativeType: 'text',
            nullable: false,
            default: rawDefault,
            resolvedNativeType: 'text',
            ...ifDefined('resolvedDefault', parseSqliteDefault(rawDefault, 'text')),
          },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
    },
  });
}

function contractWithDefault(
  columnDefault: ColumnDefault,
  column: Partial<StorageColumn> = {},
): Contract<SqlStorage> {
  const event: StorageTable = {
    columns: {
      at: {
        many: false,
        dataType: 'sqlite/text',
        nullable: false,
        codecId: 'sqlite/text@1',
        default: columnDefault,
        ...column,
      },
    },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  };
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('c'.repeat(64)),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { event } },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('buildSqlitePlanDiff derives the expected default like verify does', () => {
  it('sees no change for sql`CURRENT_TIMESTAMP` against a live column that stores CURRENT_TIMESTAMP', () => {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault({ kind: 'function', expression: 'CURRENT_TIMESTAMP' }),
      actualSchema: liveSchema('CURRENT_TIMESTAMP'),
      frameworkComponents: sqliteTestComponents,
    });
    expect(diff.issues).toEqual([]);
  });

  it.each([["strftime('%Y-%m-%dT%H:%M:%fZ','now')"], ["datetime('now')"], ['CURRENT_TIMESTAMP']])(
    'sees no change for now() against a live column that stores %s',
    (stored) => {
      const diff = buildSqlitePlanDiff({
        contract: contractWithDefault({ kind: 'function', expression: 'now()' }),
        actualSchema: liveSchema(stored),
        frameworkComponents: sqliteTestComponents,
      });
      expect(diff.issues).toEqual([]);
    },
  );

  it('renders now() as the expression that stores the datetime codec text', () => {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault({ kind: 'function', expression: 'now()' }),
      actualSchema: new SqlSchemaIR({ tables: {} }),
      frameworkComponents: sqliteTestComponents,
    });
    expect(diff.expected.tables['event']?.columns['at']?.default).toBe(
      "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    );
  });

  it("sees no change for a literal-shaped body sql`'x'` against the literal the database stores", () => {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault({ kind: 'function', expression: "'x'" }),
      actualSchema: liveSchema("'x'"),
      frameworkComponents: sqliteTestComponents,
    });
    expect(diff.issues).toEqual([]);
  });

  it.each(['CURRENT_TIMESTAMP', "'x'", 'now()'])(
    'hands DDL the authored expression %s, never the resolved default',
    (expression) => {
      const diff = buildSqlitePlanDiff({
        contract: contractWithDefault({ kind: 'function', expression }),
        actualSchema: new SqlSchemaIR({ tables: {} }),
        frameworkComponents: sqliteTestComponents,
      });
      const column = diff.expected.tables['event']?.columns['at'];
      if (column === undefined) throw new Error('expected column derived');
      expect({
        spec: columnSpecFromNode(column, false, sqliteTestTypes).default,
        ddl: ddlColumnFromNode(column, false, sqliteTestTypes).default,
      }).toEqual({
        spec: { kind: 'function', expression },
        ddl: new FunctionColumnDefault(opaqueSql(expression)),
      });
    },
  );
});

describe('buildSqlitePlanDiff writes a literal default as the text its data type stores', () => {
  const withExtensionDatetime = [
    ...sqliteTestComponents,
    {
      kind: 'extension',
      familyId: 'sql',
      targetId: 'sqlite',
      id: 'sqlite-extension-datetime',
      version: '0.0.0',
      types: {
        codecTypes: {
          codecDescriptors: [new ExtensionDatetimeDescriptor((value) => value.toISOString())],
        },
      },
    },
  ] as const;

  function expectedDefault(
    columnDefault: ColumnDefault,
    column: Partial<StorageColumn>,
  ): string | undefined {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault(columnDefault, column),
      actualSchema: new SqlSchemaIR({ tables: {} }),
      frameworkComponents: withExtensionDatetime,
    });
    return diff.expected.tables['event']?.columns['at']?.default;
  }

  it.each([['sqlite/datetime@1'], [EXTENSION_DATETIME_CODEC_ID]])(
    'writes a %s default as the datetime text every row holds',
    (codecId) => {
      expect(expectedDefault({ kind: 'literal', value: '2024-01-01T00:00:00Z' }, { codecId })).toBe(
        "'2024-01-01T00:00:00.000Z'",
      );
    },
  );

  it('writes each element of a datetime list default as the datetime text every row holds', () => {
    expect(
      expectedDefault(
        { kind: 'literal', value: ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.5Z'] },
        { codecId: 'sqlite/datetime@1', many: { elementNullable: false } },
      ),
    ).toBe('\'["2024-01-01T00:00:00.000Z","2024-01-01T00:00:00.500Z"]\'');
  });

  it.each([
    [
      '2024-01-01T25:00:00Z',
      '"2024-01-01T25:00:00Z" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "2024-01-01T12:34:56Z".',
    ],
    [
      'not a date',
      'sqlite/datetime@1 cannot read "not a date". Write a date and time with a UTC offset, as in "2024-01-01T12:34:56Z".',
    ],
  ])(
    'refuses a datetime default %s that its data type cannot read, naming the column',
    (value, refusal) => {
      const diff = buildSqlitePlanDiff({
        contract: contractWithDefault({ kind: 'literal', value }, { codecId: 'sqlite/datetime@1' }),
        actualSchema: new SqlSchemaIR({ tables: {} }),
        frameworkComponents: withExtensionDatetime,
      });
      const column = diff.expected.tables['event']?.columns['at'];
      if (column === undefined) throw new Error('expected column derived');
      expect(column.default).toBe(`'${value}'`);
      expect(() => columnSpecFromNode(column, false, sqliteTestTypes)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DEFAULT_INVALID',
          message: `Column "at": The contract holds this default in a form its data type does not store: ${refusal} Re-emit the contract, then try again.`,
          meta: { reason: 'default-not-canonical', column: 'at' },
        }),
      );
    },
  );

  it('writes a text default as it is', () => {
    expect(expectedDefault({ kind: 'literal', value: '2024-01-01T00:00:00Z' }, {})).toBe(
      "'2024-01-01T00:00:00Z'",
    );
  });
});

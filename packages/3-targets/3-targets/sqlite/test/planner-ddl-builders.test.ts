import type { JsonValue } from '@internal/contract/types';
import type { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildColumnTypeSql,
  buildCreateIndexSql,
  buildDropIndexSql,
  isInlineAutoincrementPrimaryKey,
  renderDefaultLiteral,
} from '../src/core/migrations/planner-ddl-builders';
import { sqliteTestTypes } from './sqlite-test-types';

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    many: false,
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

describe('buildColumnTypeSql', () => {
  it('writes the name of the codec data type in upper case', () => {
    expect(buildColumnTypeSql(makeColumn({ codecId: 'sqlite/text@1' }), sqliteTestTypes)).toBe(
      'TEXT',
    );
    expect(buildColumnTypeSql(makeColumn({ codecId: 'sqlite/integer@1' }), sqliteTestTypes)).toBe(
      'INTEGER',
    );
    expect(buildColumnTypeSql(makeColumn({ codecId: 'sqlite/real@1' }), sqliteTestTypes)).toBe(
      'REAL',
    );
    expect(buildColumnTypeSql(makeColumn({ codecId: 'sqlite/blob@1' }), sqliteTestTypes)).toBe(
      'BLOB',
    );
  });

  it('resolves typeRef against storageTypes', () => {
    const column = makeColumn({
      nativeType: 'unused',
      codecId: 'unused/codec@1',
      typeRef: 'my_type',
    });
    const sql = buildColumnTypeSql(column, sqliteTestTypes, {
      my_type: {
        kind: 'codec-instance',
        codecId: 'sqlite/text@1',
        nativeType: 'text',
        typeParams: {},
      },
    });
    expect(sql).toBe('TEXT');
  });
});

describe('renderDefaultLiteral', () => {
  it('renders JSON objects', () => {
    expect(renderDefaultLiteral({ key: 'val' })).toBe('\'{"key":"val"}\'');
  });

  const databaseText = (value: JsonValue) => `${String(value)}#database`;

  it('writes a string as the text its data type declares the database holds', () => {
    expect(renderDefaultLiteral('a', databaseText)).toBe("'a#database'");
  });

  it('writes each string element of a list as the text its data type declares the database holds', () => {
    expect(renderDefaultLiteral(['a', 'b'], databaseText)).toBe('\'["a#database","b#database"]\'');
  });

  it('writes a string as it is when its data type declares no stored text', () => {
    expect(renderDefaultLiteral('2024-01-01T00:00:00Z')).toBe("'2024-01-01T00:00:00Z'");
  });
});

describe('buildCreateIndexSql', () => {
  it('generates CREATE INDEX', () => {
    expect(buildCreateIndexSql('users', 'idx_users_email', ['email'])).toBe(
      'CREATE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('generates CREATE UNIQUE INDEX', () => {
    expect(buildCreateIndexSql('users', 'idx_users_email', ['email'], true)).toBe(
      'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('handles multi-column index', () => {
    expect(buildCreateIndexSql('t', 'idx_t_a_b', ['a', 'b'])).toBe(
      'CREATE INDEX "idx_t_a_b" ON "t" ("a", "b")',
    );
  });
});

describe('buildDropIndexSql', () => {
  it('generates DROP INDEX IF EXISTS', () => {
    expect(buildDropIndexSql('idx_users_email')).toBe('DROP INDEX IF EXISTS "idx_users_email"');
  });
});

describe('isInlineAutoincrementPrimaryKey', () => {
  it('is true for sole-column PK with autoincrement() default', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
      },
      primaryKey: { columns: ['id'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'id')).toBe(true);
  });

  it('is false when the column is not in the primary key', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
        seq: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
      },
      primaryKey: { columns: ['id'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'seq')).toBe(false);
  });

  it('is false for composite primary keys', () => {
    const table = makeTable({
      columns: {
        a: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
        b: makeColumn({ nativeType: 'integer', nullable: false }),
      },
      primaryKey: { columns: ['a', 'b'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'a')).toBe(false);
  });

  it('is false when default is not autoincrement()', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
      },
      primaryKey: { columns: ['id'] },
    });
    expect(isInlineAutoincrementPrimaryKey(table, 'id')).toBe(false);
  });
});

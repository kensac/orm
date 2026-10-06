import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn } from '@internal/sql-contract/types';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import {
  createSqliteCodecRegistryWithBuiltins,
  sqliteCodecDescriptorRegistry,
} from '@internal/target-sqlite/codecs';
import sqliteControlTargetDescriptor, {
  sqliteCreateNamespace,
} from '@internal/target-sqlite/control';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_DATETIME_CODEC_ID,
  ExtensionDatetimeDescriptor,
} from '../../../3-targets/sqlite/test/extension-datetime-codec';
import { SqliteControlAdapter } from '../src/core/control-adapter';

const extensionDatetime = new ExtensionDatetimeDescriptor((value) => value.toISOString());

const components: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'sqlite'>> = [
  {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'sqlite',
    id: 'sqlite-literal-default-agreement',
    version: '0.0.0',
    dataTypes: sqliteDataTypes,
    types: {
      codecTypes: {
        codecDescriptors: [...sqliteCodecDescriptorRegistry.values(), extensionDatetime],
      },
    },
  },
];

const adapter = new SqliteControlAdapter(
  createSqliteCodecRegistryWithBuiltins([extensionDatetime]),
);

function contractWith(column: StorageColumn): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('c'.repeat(64)),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              event: { columns: { at: column }, foreignKeys: [], uniques: [], indexes: [] },
            },
          },
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

function plannerDefault(column: StorageColumn): string | undefined {
  const schema = sqliteControlTargetDescriptor.migrations?.contractToSchema(
    contractWith(column),
    components,
  );
  if (!(schema instanceof SqlSchemaIR)) throw new Error('expected a flat SQLite schema');
  return schema.tables['event']?.columns['at']?.default;
}

describe('a literal datetime default', () => {
  it.each([['sqlite/datetime@1'], [EXTENSION_DATETIME_CODEC_ID]])(
    'is the same text from the planner and from the adapter for %s',
    async (codecId) => {
      const value = '2024-01-01T00:00:00Z';
      const fromAdapter = await adapter.renderColumnDefault(
        col('at', 'TEXT', { default: lit(value), codecRef: { codecId } }),
        'event',
      );
      const fromPlanner = plannerDefault({
        nativeType: 'text',
        codecId,
        nullable: false,
        many: false,
        default: { kind: 'literal', value },
      });
      expect({ fromAdapter, fromPlanner: `DEFAULT ${fromPlanner}` }).toEqual({
        fromAdapter: "DEFAULT '2024-01-01T00:00:00.000Z'",
        fromPlanner: "DEFAULT '2024-01-01T00:00:00.000Z'",
      });
    },
  );
});

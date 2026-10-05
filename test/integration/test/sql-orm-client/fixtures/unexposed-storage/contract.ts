import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import {
  buildSqlContractFromDefinition,
  type FieldNode,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

// Storage the ORM must never see, built from contract definition nodes with
// the internal `unexposed` flag, as the Prisma 7 and Prisma 8 PSL sources will
// build it: `user.legacy_key` and `post.internal_note` (which has a database
// default) are columns no field maps, `post.reviewer_id` carries a foreign key
// no relation travels, and `_prisma_migrations` is a table no model maps.

function column(
  fieldName: string,
  columnName: string,
  descriptor: FieldNode['descriptor'],
  options: Partial<Pick<FieldNode, 'nullable' | 'unexposed' | 'default'>> = {},
): FieldNode {
  return { fieldName, columnName, descriptor, nullable: false, many: false, ...options };
}

export const contract = buildSqlContractFromDefinition(
  {
    warnings: undefined,
    target: postgresPack,
    createNamespace: postgresCreateNamespace,
    models: [
      {
        modelName: 'User',
        tableName: 'user',
        fields: [
          column('id', 'id', int4Column),
          column('email', 'email', textColumn),
          column('legacyKey', 'legacy_key', textColumn, { nullable: true, unexposed: true }),
        ],
        id: { columns: ['id'] },
        relations: [
          {
            fieldName: 'posts',
            toModel: 'Post',
            toTable: 'post',
            cardinality: '1:N',
            on: {
              parentTable: 'user',
              parentColumns: ['id'],
              childTable: 'post',
              childColumns: ['user_id'],
            },
          },
        ],
      },
      {
        modelName: 'Post',
        tableName: 'post',
        fields: [
          column('id', 'id', int4Column),
          column('title', 'title', textColumn),
          column('userId', 'user_id', int4Column),
          column('internalNote', 'internal_note', textColumn, {
            unexposed: true,
            default: { kind: 'literal', value: 'not reviewed' },
          }),
          column('reviewerId', 'reviewer_id', int4Column, { nullable: true, unexposed: true }),
        ],
        id: { columns: ['id'] },
        foreignKeys: [
          { columns: ['user_id'], references: { model: 'User', table: 'user', columns: ['id'] } },
          {
            columns: ['reviewer_id'],
            references: { model: 'User', table: 'user', columns: ['id'] },
          },
        ],
        relations: [
          {
            fieldName: 'author',
            toModel: 'User',
            toTable: 'user',
            cardinality: 'N:1',
            nullable: false,
            on: {
              parentTable: 'post',
              parentColumns: ['user_id'],
              childTable: 'user',
              childColumns: ['id'],
            },
          },
        ],
      },
      {
        modelName: 'PrismaMigration',
        tableName: '_prisma_migrations',
        unexposed: true,
        fields: [
          column('id', 'id', textColumn),
          column('migrationName', 'migration_name', textColumn),
          column('appliedStepsCount', 'applied_steps_count', int4Column, {
            default: { kind: 'literal', value: 0 },
          }),
        ],
        id: { columns: ['id'] },
      },
    ],
  },
  assemblePostgresCodecRegistryWithBuiltins([]),
);

import { crossRef } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { extractCodecTypeImports } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import { type TestDescriptor, testHashes } from './emitter-hook-generation-helpers';

describe('sql-target-family-hook', () => {
  it('generates contract types with model relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            userId: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'pg/int4@1' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('relations: {');
    expect(types).toContain(
      'readonly posts: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }; readonly cardinality: "1:N"; readonly on: { readonly localFields: readonly ["id"]; readonly targetFields: readonly ["userId"] } }',
    );
  });

  it('generates contract types when models is an empty object', () => {
    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('export type TypeMaps');
    expect(types).not.toContain('"__@internal/sql-contract/codecTypes@__"');
    expect(types).not.toContain('"__@internal/sql-contract/operationTypes@__"');
  });

  it('generates contract types with explicitly empty models and codecTypes', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
    ];

    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const types = generateContractDts(ir, sqlEmission, codecTypeImports, testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('CodecTypes');
    expect(types).toContain('export type TypeMaps');
  });

  it('generates contract types with default models and codecTypes from descriptors', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
    ];

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const types = generateContractDts(ir, sqlEmission, codecTypeImports, testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('CodecTypes');
    expect(types).toContain('export type TypeMaps');
  });

  it('emits model relations on each model in Contract', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
            comments: {
              to: crossRef('Comment'),
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['authorId'],
              },
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            userId: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'pg/int4@1' },
            },
          },
          relations: {},
        },
        Comment: {
          storage: {
            table: 'comment',
            fields: {
              id: { column: 'id' },
              authorId: { column: 'authorId' },
            },
          },
          fields: {
            id: { many: false, nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            authorId: {
              many: false,
              nullable: false,
              type: { kind: 'scalar', codecId: 'pg/int4@1' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          comment: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              authorId: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('export type Relations');
    expect(types).toContain(
      'readonly posts: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }; readonly cardinality: "1:N"; readonly on: { readonly localFields: readonly ["id"]; readonly targetFields: readonly ["userId"] } }',
    );
    expect(types).toContain(
      'readonly comments: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Comment" }; readonly cardinality: "1:N"; readonly on: { readonly localFields: readonly ["id"]; readonly targetFields: readonly ["authorId"] } }',
    );
  });

  it('generates models with empty relations object when no relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly relations: {};');
    expect(types).not.toContain('readonly relations: Record<string, never>');
  });
});

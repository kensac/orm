import type { ContractRelation } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import { testHashes } from './emitter-hook-generation-helpers';

describe('sql-target-family-hook', () => {
  it('generates models type from models and storage', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
              name: { column: 'name' },
            },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            email: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            name: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              email: { many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
              name: { many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
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
    expect(types).toContain('export type Contract');
    expect(types).toContain('readonly User: {');
    expect(types).toContain('storage: { readonly table: "user"');
    expect(types).toContain(
      'readonly id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/int4@1" } }',
    );
    expect(types).toContain(
      'readonly email: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
    expect(types).toContain(
      'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
    expect(types).not.toContain('modelToTable');
    expect(types).not.toContain('fieldToColumn');
  });

  it('generates models type with multiple models', () => {
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
    expect(types).toContain('readonly User: {');
    expect(types).toContain('readonly Post: {');
    expect(types).toContain('readonly table: "user"');
    expect(types).toContain('readonly table: "post"');
    expect(types).not.toContain('modelToTable');
  });

  it('uses Record<string, never> for models when IR has no models', () => {
    const ir = createContract({
      models: undefined,
      targetFamily: 'sql',
      target: 'test-db',
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
    expect(types).toContain('storageHash: StorageHash');
  });

  it('generates models type with relation missing on property', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {},
          },
          fields: {},
          relations: {
            partialRel: { to: crossRef('Post') } as unknown as ContractRelation,
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {},
          },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      'readonly partialRel: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" } }',
    );
  });

  it('generates models with empty fields object when model has no fields', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {},
          },
          fields: {},
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
    expect(types).toContain('readonly User: {');
    expect(types).toContain('storage: { readonly table: "user"');
    expect(types).toContain('readonly fields: {}');
    expect(types).not.toContain('fieldToColumn');
    expect(types).not.toContain('columnToField');
  });

  it('generates model storage type via generateModelStorageType', () => {
    const model = {
      storage: {
        table: 'user',
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
      fields: {},
      relations: {},
    };

    const result = sqlEmission.generateModelStorageType('User', model);
    expect(result).toContain('readonly table: "user"');
    expect(result).toContain('readonly id: { readonly column: "id" }');
    expect(result).toContain('readonly email: { readonly column: "email" }');
  });

  it('includes owner field in model type when present', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: { id: { column: 'id' } },
          },
          fields: {
            id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
          owner: 'system',
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { many: false, codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
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
    expect(types).toContain('readonly owner: "system"');
  });
});

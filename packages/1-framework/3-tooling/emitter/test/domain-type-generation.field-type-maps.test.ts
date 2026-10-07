import type { ContractField, ContractModel } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  generateBothFieldTypesMaps,
  generateFieldInputTypesMap,
  generateFieldOutputTypesMap,
  generateFieldTypesMapsByNamespace,
  resolveFieldType,
} from '../src/domain-type-generation';
import { stubCodec, stubCodecLookup } from './domain-type-generation-helpers';

describe('generateFieldOutputTypesMap', () => {
  it('generates map entries with codec-dispatched rendering', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          id: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
            many: false,
          },
          name: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: false,
          },
        },
        relations: {},
        storage: { fields: {}, table: 'user' },
      },
    };
    const result = generateFieldOutputTypesMap(models, lookup);
    expect(result).toContain('Char<36>');
    expect(result).toContain('CodecTypes["pg/text@1"]["output"]');
  });

  it('returns Record<string, never> for empty models', () => {
    expect(generateFieldOutputTypesMap(undefined)).toBe('Record<string, never>');
    expect(generateFieldOutputTypesMap({})).toBe('Record<string, never>');
  });

  it('references {Name}Output for value object fields', () => {
    const models: Record<string, ContractModel> = {
      Product: {
        fields: {
          price: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Price' },
            many: false,
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateFieldOutputTypesMap(models);
    expect(result).toContain('readonly price: PriceOutput');
  });
});

describe('generateFieldInputTypesMap', () => {
  it('generates input-side codec lookups', () => {
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          name: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
            many: false,
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateFieldInputTypesMap(models);
    expect(result).toContain('CodecTypes["mongo/string@1"]["input"]');
  });

  it('references {Name}Input for value object fields', () => {
    const models: Record<string, ContractModel> = {
      Product: {
        fields: {
          price: {
            nullable: false,
            type: { kind: 'valueObject', name: 'Price' },
            many: false,
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateFieldInputTypesMap(models);
    expect(result).toContain('readonly price: PriceInput');
  });

  it('returns Record<string, never> for empty models', () => {
    expect(generateFieldInputTypesMap(undefined)).toBe('Record<string, never>');
    expect(generateFieldInputTypesMap({})).toBe('Record<string, never>');
  });
});

describe('generateBothFieldTypesMaps', () => {
  it('generates both output and input maps in a single pass', () => {
    const models: Record<string, ContractModel> = {
      User: {
        fields: {
          _id: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            many: false,
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateBothFieldTypesMaps(models);
    expect(result.output).toContain('CodecTypes["mongo/objectId@1"]["output"]');
    expect(result.input).toContain('CodecTypes["mongo/objectId@1"]["input"]');
  });

  it('returns Record<string, never> for empty models on both sides', () => {
    const result = generateBothFieldTypesMaps(undefined);
    expect(result.output).toBe('Record<string, never>');
    expect(result.input).toBe('Record<string, never>');
  });
});

describe('resolveFieldType', () => {
  it('returns both input and output for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      many: false,
    };
    const result = resolveFieldType(field);
    expect(result.output).toBe('CodecTypes["mongo/string@1"]["output"]');
    expect(result.input).toBe('CodecTypes["mongo/string@1"]["input"]');
  });

  it('returns suffixed types for value object fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Price' },
      many: false,
    };
    const result = resolveFieldType(field);
    expect(result.output).toBe('PriceOutput');
    expect(result.input).toBe('PriceInput');
  });

  it('uses renderOutputType only for output side of parameterized codecs', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: (p) => `Char<${p['length']}>`,
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: { length: 36 } },
      many: false,
    };
    const result = resolveFieldType(field, lookup);
    expect(result.output).toBe('Char<36>');
    expect(result.input).toBe('CodecTypes["pg/char@1"]["input"]');
  });

  it('uses renderInputType for the input side when the codec renders one (enum literal union)', () => {
    const union = "'a' | 'b'";
    const lookup: CodecLookup = {
      get: () => undefined,
      renderOutputTypeFor: () => union,
      renderInputTypeFor: () => union,
    };
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/enum@1', typeParams: { values: ['a', 'b'] } },
      many: false,
    };
    const result = resolveFieldType(field, lookup);
    expect(result.output).toBe(union);
    expect(result.input).toBe(union);
  });

  it('falls back to the codec input type when the lookup renders no custom input', () => {
    const lookup: CodecLookup = {
      get: () => undefined,
      renderOutputTypeFor: () => '"a" | "b"',
    };
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/enum@1', typeParams: { values: ['a', 'b'] } },
      many: false,
    };
    const result = resolveFieldType(field, lookup);
    expect(result.output).toBe('"a" | "b"');
    expect(result.input).toBe('CodecTypes["pg/enum@1"]["input"]');
  });
});

describe('generateFieldTypesMapsByNamespace edge cases', () => {
  it('returns Record<string, never> when no namespaces are supplied', () => {
    const result = generateFieldTypesMapsByNamespace([]);
    expect(result.output).toBe('Record<string, never>');
    expect(result.input).toBe('Record<string, never>');
  });

  it('skips falsy entries in the models map', () => {
    // The map's value type allows `ContractModelBase`, but a contract that
    // arrives through JSON deserialization could have a falsy value at a
    // model slot (corruption / partial parse). The emitter silently skips
    // those rather than throwing — the `if (!model) continue` guard.
    const models = blindCast<
      Record<string, ContractModel>,
      'test fixture: deliberately constructs a falsy slot to exercise the skip branch'
    >({
      Skipped: undefined,
      Real: {
        fields: {
          name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: false },
        },
        relations: {},
        storage: {},
      },
    });
    const result = generateBothFieldTypesMaps(models);
    expect(result.output).not.toContain('Skipped');
    expect(result.output).toContain('readonly Real:');
  });
});

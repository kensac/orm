import type { ContractField } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  generateContractFieldDescriptor,
  generateFieldResolvedType,
} from '../src/domain-type-generation';
import { stubCodec, stubCodecLookup } from './domain-type-generation-helpers';

describe('generateFieldResolvedType', () => {
  it('generates CodecTypes lookup for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      many: false,
    };
    expect(generateFieldResolvedType(field)).toBe('CodecTypes["mongo/string@1"]["output"]');
  });

  it('generates suffixed type reference for value object fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: false,
    };
    expect(generateFieldResolvedType(field)).toBe('AddressOutput');
  });

  it('wraps in ReadonlyArray for a list descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: false },
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<AddressOutput>');
  });

  it('adds null to nullable list elements on output', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: true },
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<AddressOutput | null>');
  });

  it('wraps in Readonly<Record> for dict: true', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
      many: false,
    };
    expect(generateFieldResolvedType(field)).toBe(
      'Readonly<Record<string, CodecTypes["mongo/string@1"]["output"]>>',
    );
  });

  it('appends | null for nullable: true', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
      many: false,
    };
    expect(generateFieldResolvedType(field)).toBe('AddressOutput | null');
  });

  it('combines many and nullable', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: false },
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<AddressOutput> | null');
  });

  it('combines nullable elements and a nullable list on output', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: true },
    };
    expect(generateFieldResolvedType(field)).toBe('ReadonlyArray<AddressOutput | null> | null');
  });

  it('handles union types with output side', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'mongo/string@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
      many: false,
    };
    expect(generateFieldResolvedType(field)).toBe(
      'CodecTypes["mongo/string@1"]["output"] | AddressOutput',
    );
  });

  it('generates nullable list elements on input', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      many: { elementNullable: true },
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe(
      'ReadonlyArray<CodecTypes["mongo/string@1"]["input"] | null>',
    );
  });

  it('generates input side for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      many: false,
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe(
      'CodecTypes["mongo/string@1"]["input"]',
    );
  });

  it('generates input-suffixed type for value object fields on input side', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Price' },
      many: false,
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe('PriceInput');
  });

  it('generates input side for union types', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'mongo/string@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
      many: false,
    };
    expect(generateFieldResolvedType(field, undefined, 'input')).toBe(
      'CodecTypes["mongo/string@1"]["input"] | AddressInput',
    );
  });
});

describe('generateContractFieldDescriptor', () => {
  it('omits explicit scalar cardinality from field descriptors', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      many: false,
    };
    const result = generateContractFieldDescriptor('name', field);
    expect(result).toBe(
      'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
  });

  it('generates value object field descriptor', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'valueObject', name: 'Address' },
      many: false,
    };
    const result = generateContractFieldDescriptor('homeAddress', field);
    expect(result).toBe(
      'readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: "valueObject"; readonly name: "Address" } }',
    );
  });

  it('includes the non-nullable list descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: false },
    };
    const result = generateContractFieldDescriptor('addresses', field);
    expect(result).toContain('; readonly many: { readonly elementNullable: false }');
  });

  it('includes element nullability inside the list descriptor', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      many: { elementNullable: true },
    };
    expect(generateContractFieldDescriptor('addresses', field)).toBe(
      'readonly addresses: { readonly nullable: false; readonly type: { readonly kind: "valueObject"; readonly name: "Address" }; readonly many: { readonly elementNullable: true } }',
    );
  });

  it('includes dict modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'mongo/string@1' },
      dict: true,
      many: false,
    };
    const result = generateContractFieldDescriptor('labels', field);
    expect(result).toContain('; readonly dict: true');
  });

  it('includes typeParams for scalar fields', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 1536 } },
      many: false,
    };
    const result = generateContractFieldDescriptor('embedding', field);
    expect(result).toContain('readonly typeParams: { readonly length: 1536 }');
  });
});

describe('generateFieldResolvedType', () => {
  it('uses codec renderOutputType when typeParams are present', () => {
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
    expect(generateFieldResolvedType(field, lookup)).toBe('Char<36>');
  });

  it('falls back to CodecTypes lookup when no codecLookup provided', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1' },
      many: false,
    };
    expect(generateFieldResolvedType(field)).toBe('CodecTypes["pg/int4@1"]["output"]');
  });

  it('falls back to CodecTypes when renderOutputType returns unsafe expression', () => {
    const lookup = stubCodecLookup({
      'test@1': stubCodec({
        id: 'test@1',
        renderOutputType: () => 'import("fs")',
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'test@1', typeParams: { x: 1 } },
      many: false,
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('CodecTypes["test@1"]["output"]');
  });

  it('falls back to CodecTypes when codec has no renderOutputType', () => {
    const lookup = stubCodecLookup({
      'pg/int4@1': stubCodec({ id: 'pg/int4@1' }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1', typeParams: { x: 1 } },
      many: false,
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('CodecTypes["pg/int4@1"]["output"]');
  });

  it('falls back to CodecTypes when typeParams is empty', () => {
    const lookup = stubCodecLookup({
      'pg/char@1': stubCodec({
        id: 'pg/char@1',
        renderOutputType: () => 'Char<36>',
      }),
    });
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/char@1', typeParams: {} },
      many: false,
    };
    expect(generateFieldResolvedType(field, lookup)).toBe('CodecTypes["pg/char@1"]["output"]');
  });
});

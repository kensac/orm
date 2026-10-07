import type { ContractValueObject } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  generateValueObjectsDescriptorType,
  generateValueObjectType,
  generateValueObjectTypeAliases,
} from '../src/domain-type-generation';
import { stubCodec, stubCodecLookup } from './domain-type-generation-helpers';

describe('generateValueObjectType', () => {
  const addressVo: ContractValueObject = {
    fields: {
      street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' }, many: false },
      city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' }, many: false },
      zip: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' }, many: false },
    },
  };
  const valueObjects: Record<string, ContractValueObject> = { Address: addressVo };

  it('generates object type with all fields', () => {
    const result = generateValueObjectType('Address', addressVo, valueObjects);
    expect(result).toContain('readonly street: CodecTypes["mongo/string@1"]["output"]');
    expect(result).toContain('readonly city: CodecTypes["mongo/string@1"]["output"]');
    expect(result).toContain('readonly zip: CodecTypes["mongo/string@1"]["output"]');
  });

  it('handles value object field referencing another value object (output)', () => {
    const companyVo: ContractValueObject = {
      fields: {
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' }, many: false },
        address: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: false },
      },
    };
    const vos = { ...valueObjects, Company: companyVo };
    const result = generateValueObjectType('Company', companyVo, vos);
    expect(result).toContain('readonly address: AddressOutput');
  });

  it('handles value object field referencing another value object (input)', () => {
    const companyVo: ContractValueObject = {
      fields: {
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' }, many: false },
        address: { nullable: false, type: { kind: 'valueObject', name: 'Address' }, many: false },
      },
    };
    const vos = { ...valueObjects, Company: companyVo };
    const result = generateValueObjectType('Company', companyVo, vos, 'input');
    expect(result).toContain('readonly address: AddressInput');
  });

  it('handles self-referencing value object (no infinite recursion)', () => {
    const navItemVo: ContractValueObject = {
      fields: {
        label: {
          nullable: false,
          type: { kind: 'scalar', codecId: 'mongo/string@1' },
          many: false,
        },
        children: {
          nullable: false,
          type: { kind: 'valueObject', name: 'NavItem' },
          many: { elementNullable: false },
        },
      },
    };
    const vos = { NavItem: navItemVo };
    const result = generateValueObjectType('NavItem', navItemVo, vos);
    expect(result).toContain('readonly children: ReadonlyArray<NavItemOutput>');
  });

  it('types a member with type parameters by the parameterized output type, and keeps the codec input type', () => {
    const lookup = stubCodecLookup({
      'sql/varchar@1': stubCodec({
        id: 'sql/varchar@1',
        renderOutputType: (p) => `Varchar<${p['length']}>`,
      }),
    });
    const labelVo: ContractValueObject = {
      fields: {
        code: {
          nullable: false,
          type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 10 } },
        },
        codes: {
          nullable: false,
          many: { elementNullable: false },
          type: { kind: 'scalar', codecId: 'sql/varchar@1', typeParams: { length: 10 } },
        },
      },
    };
    expect({
      output: generateValueObjectType('Label', labelVo, {}, 'output', lookup),
      input: generateValueObjectType('Label', labelVo, {}, 'input', lookup),
    }).toEqual({
      output: '{ readonly code: Varchar<10>; readonly codes: ReadonlyArray<Varchar<10>> }',
      input:
        '{ readonly code: CodecTypes["sql/varchar@1"]["input"]; readonly codes: ReadonlyArray<CodecTypes["sql/varchar@1"]["input"]> }',
    });
  });

  it('returns Record<string, never> for empty value object', () => {
    const emptyVo: ContractValueObject = { fields: {} };
    expect(generateValueObjectType('Empty', emptyVo, {})).toBe('Record<string, never>');
  });
});

describe('generateValueObjectsDescriptorType', () => {
  it('returns Record<string, never> for undefined', () => {
    expect(generateValueObjectsDescriptorType(undefined)).toBe('Record<string, never>');
  });

  it('returns Record<string, never> for empty', () => {
    expect(generateValueObjectsDescriptorType({})).toBe('Record<string, never>');
  });

  it('generates descriptor with fields for each value object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
            many: false,
          },
        },
      },
    };
    const result = generateValueObjectsDescriptorType(valueObjects);
    expect(result).toContain('readonly Address: { readonly fields:');
    expect(result).toContain('readonly kind: "scalar"');
    expect(result).toContain('readonly codecId: "mongo/string@1"');
  });
});

describe('generateValueObjectTypeAliases', () => {
  it('returns empty string for undefined', () => {
    expect(generateValueObjectTypeAliases(undefined)).toBe('');
  });

  it('returns empty string for empty', () => {
    expect(generateValueObjectTypeAliases({})).toBe('');
  });

  it('generates output and input type alias pairs for each value object', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
            many: false,
          },
        },
      },
    };
    const result = generateValueObjectTypeAliases(valueObjects);
    expect(result).toContain('export type AddressOutput =');
    expect(result).toContain('export type AddressInput =');
    expect(result).toContain('readonly street: CodecTypes["mongo/string@1"]["output"]');
    expect(result).toContain('readonly street: CodecTypes["mongo/string@1"]["input"]');
    expect(result).not.toMatch(/export type Address =/);
  });

  it('generates multiple type alias pairs', () => {
    const valueObjects: Record<string, ContractValueObject> = {
      Address: {
        fields: {
          street: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/string@1' },
            many: false,
          },
        },
      },
      GeoPoint: {
        fields: {
          lat: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/double@1' },
            many: false,
          },
          lng: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'mongo/double@1' },
            many: false,
          },
        },
      },
    };
    const result = generateValueObjectTypeAliases(valueObjects);
    expect(result).toContain('export type AddressOutput =');
    expect(result).toContain('export type AddressInput =');
    expect(result).toContain('export type GeoPointOutput =');
    expect(result).toContain('export type GeoPointInput =');
  });
});

describe('generateValueObjectsDescriptorType empty-field branch', () => {
  it("renders a value object with no fields as 'Record<string, never>'", () => {
    const result = generateValueObjectsDescriptorType({
      EmptyVO: { fields: {} },
    });
    expect(result).toContain('readonly EmptyVO: { readonly fields: Record<string, never> }');
  });
});

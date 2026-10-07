import type { ContractModel } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { generateBothFieldTypesMaps, generateModelFieldsType } from '../src/domain-type-generation';

describe('generateModelFieldsType', () => {
  it('types an empty field map as an object with no keys, not a string index', () => {
    expect(generateModelFieldsType({})).toBe('{}');
  });

  it.each([{}, { many: false as const }])('omits scalar cardinality for %j', (cardinality) => {
    const result = generateModelFieldsType({
      name: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: false, ...cardinality },
    });
    expect(result).toBe(
      '{ readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/text@1" } } }',
    );
  });

  it('generates multiple fields', () => {
    const result = generateModelFieldsType({
      id: { type: { kind: 'scalar', codecId: 'sql/int4@1' }, nullable: false, many: false },
      email: { type: { kind: 'scalar', codecId: 'sql/text@1' }, nullable: true, many: false },
    });
    expect(result).toContain(
      'readonly id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/int4@1" } }',
    );
    expect(result).toContain(
      'readonly email: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "sql/text@1" } }',
    );
  });

  it('quotes keys with special characters', () => {
    const result = generateModelFieldsType({
      'field-name': {
        type: { kind: 'scalar', codecId: 'sql/text@1' },
        nullable: false,
        many: false,
      },
    });
    expect(result).toContain('readonly "field-name":');
  });
});

describe('generateBothFieldTypesMaps for a model with no fields', () => {
  it('types its output and input fields as an object with no keys', () => {
    const models: Record<string, ContractModel> = {
      Chore: { fields: {}, relations: {}, storage: {} },
    };
    expect(generateBothFieldTypesMaps(models)).toEqual({
      output: '{ readonly Chore: {} }',
      input: '{ readonly Chore: {} }',
    });
  });
});

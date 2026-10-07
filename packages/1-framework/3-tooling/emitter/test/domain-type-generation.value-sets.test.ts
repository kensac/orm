import type { ContractField, ContractModel } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  type FieldValueSetResolver,
  generateBothFieldTypesMaps,
  renderValueSetType,
  resolveFieldType,
  serializeValue,
} from '../src/domain-type-generation';

/**
 * Mirrors the real primitive codecs' `renderValueLiteral`: identity codecs render the encoded value
 * directly as a literal. Tests pass this so the value-set field emit produces literal unions.
 */
function literalCodecLookup(): CodecLookup {
  const renderPrimitiveLiteral = (value: unknown): string | undefined => {
    if (typeof value === 'string') return serializeValue(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
  };
  return {
    get: () => undefined,
    renderOutputTypeFor: () => undefined,
    renderValueLiteralFor: (_id, value) => renderPrimitiveLiteral(value),
  };
}

describe('generateBothFieldTypesMaps with resolveFieldValueSet', () => {
  it('narrows a scalar enum field to its value-set members on both sides', () => {
    const models: Record<string, ContractModel> = {
      Post: {
        fields: {
          priority: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            valueSet: {
              plane: 'domain',
              entityKind: 'enum',
              namespaceId: 'public',
              entityName: 'Priority',
            },
            many: false,
          },
          title: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: false,
          },
        },
        relations: {},
        storage: {},
      },
    };
    const resolveFieldValueSet: FieldValueSetResolver = (_modelName, fieldName) =>
      fieldName === 'priority'
        ? { encodedValues: ['low', 'high', 'urgent'], codecId: 'pg/text@1' }
        : undefined;
    const result = generateBothFieldTypesMaps(models, literalCodecLookup(), resolveFieldValueSet);
    expect(result.output).toContain('readonly priority: "low" | "high" | "urgent"');
    expect(result.input).toContain('readonly priority: "low" | "high" | "urgent"');
    expect(result.output).toContain('readonly title: CodecTypes["pg/text@1"]["output"]');
  });

  it('falls through to the codec channel for non-enum scalar fields', () => {
    const models: Record<string, ContractModel> = {
      Post: {
        fields: {
          title: {
            nullable: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            many: false,
          },
        },
        relations: {},
        storage: {},
      },
    };
    const result = generateBothFieldTypesMaps(models, literalCodecLookup(), () => undefined);
    expect(result.output).toContain('readonly title: CodecTypes["pg/text@1"]["output"]');
  });
});

describe('resolveFieldType value-set narrowing edge cases', () => {
  const priorityRef = {
    plane: 'domain' as const,
    namespaceId: 'public',
    entityKind: 'enum' as const,
    entityName: 'Priority',
  };

  it('renders numeric value-set members as plain literals', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/int4@1' },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), {
      encodedValues: [1, 10],
      codecId: 'pg/int4@1',
    });
    expect(result.output).toBe('1 | 10');
    expect(result.input).toBe('1 | 10');
  });

  it('renders boolean value-set members as plain literals', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/bool@1' },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), {
      encodedValues: [true, false],
      codecId: 'pg/bool@1',
    });
    expect(result.output).toBe('true | false');
  });

  it('applies nullability on top of the narrowed union', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), {
      encodedValues: ['low'],
      codecId: 'pg/text@1',
    });
    expect(result.output).toBe('"low" | null');
    expect(result.input).toBe('"low" | null');
  });

  it('falls through to the codec channel when no resolved value-set is supplied', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), undefined);
    expect(result.output).toBe('CodecTypes["pg/text@1"]["output"]');
  });

  it('falls through to the codec channel when the value set is empty', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), {
      encodedValues: [],
      codecId: 'pg/text@1',
    });
    expect(result.output).toBe('CodecTypes["pg/text@1"]["output"]');
  });

  it('falls through to the codec channel when a value is non-literal-expressible', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/jsonb@1' },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), {
      encodedValues: [{ nested: 1 }],
      codecId: 'pg/jsonb@1',
    });
    expect(result.output).toBe('CodecTypes["pg/jsonb@1"]["output"]');
  });

  it('does not narrow non-scalar (union) fields even with a resolved value-set present', () => {
    const field: ContractField = {
      nullable: false,
      type: {
        kind: 'union',
        members: [
          { kind: 'scalar', codecId: 'pg/text@1' },
          { kind: 'valueObject', name: 'Address' },
        ],
      },
      valueSet: priorityRef,
      many: false,
    };
    const result = resolveFieldType(field, literalCodecLookup(), {
      encodedValues: ['low', 'high'],
      codecId: 'pg/text@1',
    });
    expect(result.output).toBe('CodecTypes["pg/text@1"]["output"] | AddressOutput');
    expect(result.input).toBe('CodecTypes["pg/text@1"]["input"] | AddressInput');
    expect(result.output).not.toContain('"low"');
  });
});

describe('renderValueSetType', () => {
  it('renders a literal union via the codec renderValueLiteral', () => {
    expect(renderValueSetType(['low', 'high'], 'pg/text@1', 'output', literalCodecLookup())).toBe(
      '"low" | "high"',
    );
  });

  it('returns undefined for an empty value set', () => {
    expect(renderValueSetType([], 'pg/text@1', 'output', literalCodecLookup())).toBeUndefined();
  });

  it('returns undefined when the lookup has no renderValueLiteralFor', () => {
    const lookup: CodecLookup = {
      get: () => undefined,
      renderOutputTypeFor: () => undefined,
    };
    expect(renderValueSetType(['low'], 'pg/text@1', 'output', lookup)).toBeUndefined();
  });

  it('returns undefined when any value is not literal-expressible', () => {
    expect(
      renderValueSetType([{ nested: 1 }], 'pg/jsonb@1', 'output', literalCodecLookup()),
    ).toBeUndefined();
  });
});

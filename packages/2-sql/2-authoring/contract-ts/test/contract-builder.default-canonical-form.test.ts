import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type Codec,
  type CodecLookupWithDescriptors,
  createDataTypeLookup,
} from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/contract-builder';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

/** An instant type whose canonical form drops a zero fraction and which holds only UTC text. */
const instant = sqlDataType('test/instant', {
  texts: [{ text: 'timestamptz', written: true }],
  toCanonicalForm: (value) => {
    if (typeof value !== 'string' || !value.endsWith('Z')) {
      throw structuredError('CONTRACT.CAST_REFUSED', `${JSON.stringify(value)} has no UTC offset.`);
    }
    return value.replace('.000Z', 'Z');
  },
});
const int4 = sqlDataType('test/int4', { texts: [{ text: 'int4', written: true }] });

function codecOf(id: string, encodeJson: (value: unknown) => JsonValue): Codec {
  return {
    id,
    encode: async (value: unknown) => value,
    decode: async (wire: unknown) => wire,
    encodeJson,
    decodeJson: (json: JsonValue) => json,
  } as unknown as Codec;
}

function lookupOf(codecs: Record<string, { dataType: string; codec: Codec }>) {
  const codecLookup: CodecLookupWithDescriptors = {
    get: (id) => codecs[id]?.codec,
    renderOutputTypeFor: () => undefined,
    descriptorFor: (id) => {
      const entry = codecs[id];
      return entry === undefined
        ? undefined
        : ({
            codecId: id,
            dataType: entry.dataType,
            paramsSchema: undefined,
            factory: () => () => entry.codec,
          } as unknown as AnyCodecDescriptor);
    },
  };
  return [codecLookup, createDataTypeLookup([instant, int4])] as const;
}

const id = { dataType: int4.id, codec: codecOf('test/int4@1', (value) => value as JsonValue) };

/** Writes a `Date` as `toISOString()` does, with a zero fraction the type's canonical form drops. */
const isoInstant = {
  dataType: instant.id,
  codec: codecOf('test/instant@1', (value) =>
    value instanceof Date ? value.toISOString() : (value as JsonValue),
  ),
};

/** Writes a `Date` in the type's canonical form. */
const canonicalInstant = {
  dataType: instant.id,
  codec: codecOf('test/instant@1', (value) =>
    value instanceof Date ? value.toISOString().replace('.000Z', 'Z') : (value as JsonValue),
  ),
};

function buildWithDefault(
  instantCodec: { dataType: string; codec: Codec },
  value: unknown,
  many = false,
) {
  return buildSqlContractFromDefinition(
    {
      warnings: undefined,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: [
        {
          modelName: 'Event',
          tableName: 'event',
          fields: [
            {
              many: false,
              fieldName: 'id',
              columnName: 'id',
              descriptor: { codecId: 'test/int4@1', nativeType: 'int4' },
              nullable: false,
            },
            {
              many: false,
              fieldName: 'at',
              columnName: 'at',
              descriptor: { codecId: 'test/instant@1', nativeType: 'timestamptz' },
              nullable: false,
              default: { kind: 'literal', value },
              ...(many ? { many: true, elementNullable: false } : {}),
            },
          ],
          id: { columns: ['id'] },
        },
      ],
    },
    ...lookupOf({ 'test/int4@1': id, 'test/instant@1': instantCodec }),
  );
}

function storedDefault(contract: ReturnType<typeof buildWithDefault>): unknown {
  return Object.values(contract.storage.namespaces)[0]?.entries.table?.['event']?.columns['at']
    ?.default;
}

describe('a literal default in a TypeScript contract', () => {
  it("is stored in the canonical form of the column's data type, whatever form the codec writes", () => {
    expect(storedDefault(buildWithDefault(isoInstant, new Date('2024-01-01T00:00:00Z')))).toEqual({
      kind: 'literal',
      value: '2024-01-01T00:00:00Z',
    });
  });

  it('gives the contract the storage hash a codec writing the canonical form gives it', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    expect(buildWithDefault(isoInstant, date).storage.storageHash).toBe(
      buildWithDefault(canonicalInstant, date).storage.storageHash,
    );
  });

  it('is stored in canonical form element by element on a list column', () => {
    expect(
      storedDefault(
        buildWithDefault(
          isoInstant,
          [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00.5Z')],
          true,
        ),
      ),
    ).toEqual({ kind: 'literal', value: ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.500Z'] });
  });

  it("is refused with the data type's message when the type does not hold it", () => {
    expect(() => buildWithDefault(isoInstant, '2024-01-01T00:00:00')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.at" has a default that its data type test/instant does not hold: "2024-01-01T00:00:00" has no UTC offset.',
        meta: {
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'test/instant@1',
          dataType: 'test/instant',
          reason: 'default-not-canonical',
        },
      }),
    );
  });

  it("is refused with the data type's message when one element of a list default is not held", () => {
    expect(() =>
      buildWithDefault(isoInstant, [new Date('2024-01-01T00:00:00Z'), '2024-01-01T00:00:00'], true),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.at" has a default that its data type test/instant does not hold: "2024-01-01T00:00:00" has no UTC offset.',
        meta: {
          modelName: 'Event',
          fieldName: 'at',
          codecId: 'test/instant@1',
          dataType: 'test/instant',
          reason: 'default-not-canonical',
        },
      }),
    );
  });
});

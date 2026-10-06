import { int4Column, timestamptzJsDateColumn } from '@internal/adapter-postgres/column-types';
import type { JsonValue } from '@internal/contract/types';
import sqlFamilyPack from '@internal/family-sql/pack';
import type {
  AnyCodecDescriptor,
  Codec,
  CodecLookupWithDescriptors,
} from '@internal/framework-components/codec';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { postgresTypeLookups } from '../postgres-type-lookups';
import { authorSqlContractFromPsl, findStorageColumn } from '../scalar-lists/psl-list-authoring';

/** The target's codecs, except that the JS `Date` codec of `pg/timestamptz` writes `toISOString()` to the contract. */
function withIsoStringEncodeJson(lookup: CodecLookupWithDescriptors): CodecLookupWithDescriptors {
  const codecId = timestamptzJsDateColumn.codecId;
  const isoString = (codec: Codec): Codec =>
    Object.assign(Object.create(codec) as Codec, {
      encodeJson: (value: unknown): JsonValue => (value as Date).toISOString(),
    });
  return {
    ...lookup,
    get: (id) => {
      const codec = lookup.get(id);
      return id === codecId && codec !== undefined ? isoString(codec) : codec;
    },
    descriptorFor: (id) => {
      const descriptor = lookup.descriptorFor(id);
      if (id !== codecId || descriptor === undefined) return descriptor;
      return Object.assign(Object.create(descriptor) as AnyCodecDescriptor, {
        factory:
          (params: unknown) =>
          (...args: Parameters<ReturnType<AnyCodecDescriptor['factory']>>) =>
            isoString(descriptor.factory(params as never)(...args)),
      });
    },
  };
}

describe('a pg/timestamptz default authored in TypeScript and in PSL', () => {
  it('gives the same storage hash when the codec writes toISOString() to the contract', async () => {
    const psl = await authorSqlContractFromPsl(`model Event {
  id Int               @id
  at TimestamptzJsDate @default("2024-01-01T00:00:00Z")
}`);
    if (psl.contract === undefined) throw new Error(JSON.stringify(psl.diagnostics));

    const typescript = defineContract({
      codecLookup: withIsoStringEncodeJson(postgresTypeLookups.codecLookup),
      dataTypeLookup: postgresTypeLookups.dataTypeLookup,
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(int4Column).id(),
            at: field.column(timestamptzJsDateColumn).default(new Date('2024-01-01T00:00:00Z')),
          },
        }).sql({ table: 'Event' }),
      },
    });

    expect({
      defaults: [
        findStorageColumn(psl.contract, 'at')?.['default'],
        findStorageColumn(typescript, 'at')?.['default'],
      ],
      sameStorageHash: typescript.storage.storageHash === psl.contract.storage.storageHash,
    }).toEqual({
      defaults: [
        { kind: 'literal', value: '2024-01-01T00:00:00Z' },
        { kind: 'literal', value: '2024-01-01T00:00:00Z' },
      ],
      sameStorageHash: true,
    });
  });
});

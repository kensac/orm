import { type Codec, createDataTypeLookup } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { AnySqliteCodecDescriptor } from '../src/core/codec-descriptor';
import { sqliteDataTypes, sqliteDatetime } from '../src/core/data-types';
import { sqliteCodecDescriptorRegistry } from '../src/core/registry';
import { ExtensionDatetimeDescriptor } from './extension-datetime-codec';

const dataTypes = createDataTypeLookup(sqliteDataTypes);

/** Canonical values of each type that declares stored text. */
const canonicalValues: Readonly<Record<string, readonly string[]>> = {
  'sqlite/datetime': [
    '2024-01-01T00:00:00Z',
    '2024-01-01T00:00:00.5Z',
    '2024-01-01T00:00:00.123Z',
    '-000043-03-15T00:00:00Z',
    '+012026-01-02T03:04:05Z',
  ],
};

function codecOf(descriptor: AnySqliteCodecDescriptor): Codec {
  return descriptor.factory(undefined)({ name: '<test>' });
}

/** The canonical values for which the codec writes other text than the data type declares. */
async function storedTextDisagreements(descriptor: AnySqliteCodecDescriptor) {
  const toStoredText = dataTypes.get(descriptor.dataType)?.toStoredText;
  if (toStoredText === undefined) return [];
  const codec = codecOf(descriptor);
  const disagreements = [];
  for (const canonical of canonicalValues[descriptor.dataType] ?? []) {
    const written = await codec.encode(codec.decodeJson(canonical), {});
    const declared = toStoredText(canonical);
    if (written !== declared) disagreements.push({ canonical, written, declared });
  }
  return disagreements;
}

const codecsWithStoredText = [...sqliteCodecDescriptorRegistry.values()].filter(
  (descriptor) => dataTypes.get(descriptor.dataType)?.toStoredText !== undefined,
);

describe('the text a SQLite data type declares it stores', () => {
  it('is declared by sqlite/datetime alone', () => {
    expect(codecsWithStoredText.map((descriptor) => descriptor.codecId)).toEqual([
      'sqlite/datetime@1',
    ]);
  });

  it.each([
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01T00:00:00.5Z', '2024-01-01T00:00:00.500Z'],
    ['-000043-03-15T00:00:00Z', '-000043-03-15T00:00:00.000Z'],
  ])('is %s for sqlite/datetime as %s', (canonical, stored) => {
    expect(sqliteDatetime.toStoredText?.(canonical)).toBe(stored);
  });

  it.each(codecsWithStoredText.map((descriptor) => [descriptor.codecId, descriptor] as const))(
    'is what %s writes for every row',
    async (_codecId, descriptor) => {
      expect(await storedTextDisagreements(descriptor)).toEqual([]);
    },
  );

  it('is not what a codec of the type writes when it writes other text', async () => {
    const disagreements = await storedTextDisagreements(
      new ExtensionDatetimeDescriptor((value) => String(value.getTime())),
    );
    expect(disagreements).toContainEqual({
      canonical: '2024-01-01T00:00:00Z',
      written: '1704067200000',
      declared: '2024-01-01T00:00:00.000Z',
    });
  });
});

import type { Codec } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import type { AnySqliteCodecDescriptor } from '../src/core/codec-descriptor';
import { sqliteDatetimeDescriptor } from '../src/core/codecs';
import { sqliteCodecDescriptorRegistry } from '../src/core/registry';
import { ExtensionDatetimeDescriptor } from './extension-datetime-codec';

/** Canonical values of each codec that declares the text the database holds. */
const canonicalValues: readonly string[] = [
  '2024-01-01T00:00:00Z',
  '2024-01-01T00:00:00.5Z',
  '2024-01-01T00:00:00.123Z',
  '-000043-03-15T00:00:00Z',
  '+012026-01-02T03:04:05Z',
];

function codecOf(descriptor: AnySqliteCodecDescriptor): Codec {
  return descriptor.factory(undefined)({ name: '<test>' });
}

/** The canonical values for which the codec writes other text than its descriptor declares. */
async function databaseTextDisagreements(descriptor: AnySqliteCodecDescriptor) {
  const toDatabaseText = descriptor.toDatabaseText;
  if (toDatabaseText === undefined) return [];
  const codec = codecOf(descriptor);
  const disagreements = [];
  for (const canonical of canonicalValues) {
    const written = await codec.encode(codec.decodeJson(canonical), {});
    const declared = toDatabaseText(canonical);
    if (written !== declared) disagreements.push({ canonical, written, declared });
  }
  return disagreements;
}

const codecsWithDatabaseText = [...sqliteCodecDescriptorRegistry.values()].filter(
  (descriptor) => descriptor.toDatabaseText !== undefined,
);

describe('the text a SQLite codec declares the database holds', () => {
  it('is declared by sqlite/datetime@1 alone', () => {
    expect(codecsWithDatabaseText.map((descriptor) => descriptor.codecId)).toEqual([
      'sqlite/datetime@1',
    ]);
  });

  it.each([
    ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00.000Z'],
    ['2024-01-01T00:00:00.5Z', '2024-01-01T00:00:00.500Z'],
    ['-000043-03-15T00:00:00Z', '-000043-03-15T00:00:00.000Z'],
  ])('is %s for sqlite/datetime@1 as %s', (canonical, databaseText) => {
    expect(sqliteDatetimeDescriptor.toDatabaseText(canonical)).toBe(databaseText);
  });

  it.each(codecsWithDatabaseText.map((descriptor) => [descriptor.codecId, descriptor] as const))(
    'is what %s writes for every row',
    async (_codecId, descriptor) => {
      expect(await databaseTextDisagreements(descriptor)).toEqual([]);
    },
  );

  it('is not what a codec writes when it writes other text for a row', async () => {
    const disagreements = await databaseTextDisagreements(
      new ExtensionDatetimeDescriptor((value) => String(value.getTime())),
    );
    expect(disagreements).toContainEqual({
      canonical: '2024-01-01T00:00:00Z',
      written: '1704067200000',
      declared: '2024-01-01T00:00:00.000Z',
    });
  });
});

import postgresDriver from '@internal/driver-postgres/runtime';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { type Type, type } from 'arktype';
import { afterEach, describe, expect, it } from 'vitest';
import { arktypeJsonColumn } from '../src/core/arktype-json-codec';

const SYNTH_CTX: CodecInstanceContext = { name: '<arktype-json-driver-test>' };

describe('arktype-json decoding of values read through the Postgres runtime driver', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  async function storeAndDecode(schema: Type<unknown>, values: readonly unknown[]) {
    const database = await createDevDatabase();
    const driver = postgresDriver.create();
    cleanups.push(async () => {
      await driver.close();
      await database.close();
    });
    await driver.connect({ kind: 'url', url: database.connectionString });
    await driver.execute({ sql: 'create table payloads (id int primary key, v jsonb)' });
    for (const [id, value] of values.entries()) {
      await driver.execute({
        sql: 'insert into payloads values ($1, $2::jsonb)',
        params: [id, JSON.stringify(value)],
      });
    }

    const codec = arktypeJsonColumn(schema).codecFactory(SYNTH_CTX);
    const decoded: unknown[] = [];
    for await (const row of driver.query<{ v: string }>({
      sql: 'select v from payloads order by id',
      params: [],
    })) {
      decoded.push(await codec.decode(row.v, {}));
    }
    return decoded;
  }

  it(
    'decodes stored strings to the exact strings under a string schema',
    async () => {
      const values = ['plain', '123', '{"not":"a document"}'];

      expect(await storeAndDecode(type('string'), values)).toEqual(values);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'decodes stored documents to objects under an object schema',
    async () => {
      const values = [{ name: 'Widget' }];

      expect(await storeAndDecode(type({ name: 'string' }), values)).toEqual(values);
    },
    timeouts.spinUpPpgDev,
  );
});

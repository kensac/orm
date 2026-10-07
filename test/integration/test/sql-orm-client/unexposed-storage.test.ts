/**
 * Storage the domain does not expose stays out of every ORM read and write: `user.legacy_key` and `post.internal_note` are columns no field maps, `post.reviewer_id` carries a foreign key no relation travels, and `_prisma_migrations` is a table no model maps. Rows never carry those columns under a field or a column name, writes leave them to their database defaults, and the types do not list them.
 */
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/unexposed-storage/generated/contract';
import contractJson from './fixtures/unexposed-storage/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

function unexposedContract(): Contract {
  return new PostgresContractSerializer().deserializeContract(
    JSON.parse(JSON.stringify(contractJson)),
  ) as Contract;
}

function ormFor(runtime: PgIntegrationRuntime, contract: Contract) {
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  });
  return orm({ runtime, context });
}

async function seed(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query(
    `INSERT INTO "user" (id, email, legacy_key) VALUES (1, 'alice@example.com', 'secret'), (2, 'bob@example.com', NULL)`,
  );
  await runtime.query(
    `INSERT INTO post (id, title, user_id, internal_note, reviewer_id) VALUES (10, 'Hello', 1, 'flagged', 2)`,
  );
}

describe('integration/unexposed-storage', () => {
  it(
    'reads and writes leave out every column no field maps',
    async () => {
      const contract = unexposedContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);
        await seed(runtime);

        const users = await db.public.User.orderBy((user) => user.id.asc()).all();
        expect(users).toEqual([
          { id: 1, email: 'alice@example.com' },
          { id: 2, email: 'bob@example.com' },
        ]);

        const posts = await db.public.Post.include('author').all();
        expect(posts).toEqual([
          { id: 10, title: 'Hello', userId: 1, author: { id: 1, email: 'alice@example.com' } },
        ]);

        const withPosts = await db.public.User.where({ id: 1 }).include('posts').all();
        expect(withPosts).toEqual([
          {
            id: 1,
            email: 'alice@example.com',
            posts: [{ id: 10, title: 'Hello', userId: 1 }],
          },
        ]);

        const created = await db.public.Post.create({ id: 11, title: 'Second', userId: 2 });
        expect(created).toEqual({ id: 11, title: 'Second', userId: 2 });

        const updated = await db.public.Post.where({ id: 10 }).update({ title: 'Renamed' });
        expect(updated).toEqual({ id: 10, title: 'Renamed', userId: 1 });

        const deleted = await db.public.Post.where({ id: 11 }).delete();
        expect(deleted).toEqual({ id: 11, title: 'Second', userId: 2 });

        const stored = await runtime.query<{
          id: number;
          internal_note: string;
          reviewer_id: number | null;
        }>('SELECT id, internal_note, reviewer_id FROM post ORDER BY id');
        expect(stored).toEqual([{ id: 10, internal_note: 'flagged', reviewer_id: 2 }]);
        const secret = await runtime.query<{ legacy_key: string | null }>(
          'SELECT legacy_key FROM "user" WHERE id = 1',
        );
        expect(secret).toEqual([{ legacy_key: 'secret' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'leaves a column no field maps at its database default on create',
    async () => {
      const contract = unexposedContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);
        await seed(runtime);

        await db.public.Post.create({ id: 12, title: 'Third', userId: 1 });

        expect(
          await runtime.query<{ internal_note: string; reviewer_id: number | null }>(
            'SELECT internal_note, reviewer_id FROM post WHERE id = 12',
          ),
        ).toEqual([{ internal_note: 'not reviewed', reviewer_id: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'refuses a name that is not a field, so an untyped caller cannot reach a column no field maps',
    async () => {
      const contract = unexposedContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);
        await seed(runtime);
        const unknownField = (field: string) =>
          expect.objectContaining({
            code: 'ORM.FIELD_UNKNOWN',
            meta: expect.objectContaining({ field }),
          });

        await expect(
          (async () =>
            db.public.Post.create({
              id: 13,
              title: 'Leak',
              userId: 1,
              internal_note: 'written',
            } as never))(),
        ).rejects.toEqual(unknownField('internal_note'));
        await expect(
          (async () => db.public.User.where({ legacy_key: 'secret' } as never).all())(),
        ).rejects.toEqual(unknownField('legacy_key'));
        await expect(
          (async () => db.public.User.select('legacy_key' as never).all())(),
        ).rejects.toEqual(unknownField('legacy_key'));

        expect(
          await runtime.query<{ internal_note: string }>(
            'SELECT internal_note FROM post ORDER BY id',
          ),
        ).toEqual([{ internal_note: 'flagged' }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it('types no row field and no model for storage the domain does not expose', () => {
    type Db = ReturnType<typeof ormFor>;
    type UserRow = Awaited<ReturnType<Db['public']['User']['all']>>[number];
    type PostRow = Awaited<ReturnType<Db['public']['Post']['all']>>[number];

    expectTypeOf<keyof UserRow>().toEqualTypeOf<'id' | 'email'>();
    expectTypeOf<keyof PostRow>().toEqualTypeOf<'id' | 'title' | 'userId'>();
    expectTypeOf<keyof Db['public']>().toEqualTypeOf<'User' | 'Post'>();
  });
});

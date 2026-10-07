import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import {
  buildTestContextFromContract,
  buildUnexposedColumnContract,
  getTestContract,
  withPatchedDomainModels,
} from './helpers';
import { context, expectBinaryParam, paramRef } from './model-accessor-helpers';

describe('createModelAccessor', () => {
  it('creates scalar comparison operators and maps fields to columns', () => {
    const user = createModelAccessor(context, 'public', 'User');
    const post = createModelAccessor(context, 'public', 'Post');

    expectBinaryParam(user['name']!.eq('Alice'), 'users', 'name', 'eq', 'Alice');
    expectBinaryParam(
      user['email']!.neq('test@example.com'),
      'users',
      'email',
      'neq',
      'test@example.com',
    );
    expectBinaryParam(post['views']!.gt(1000), 'posts', 'views', 'gt', 1000);
    expectBinaryParam(post['views']!.lt(100), 'posts', 'views', 'lt', 100);
    expectBinaryParam(post['id']!.gte(5), 'posts', 'id', 'gte', 5);
    expectBinaryParam(post['id']!.lte(10), 'posts', 'id', 'lte', 10);
    expectBinaryParam(post['userId']!.eq(42), 'posts', 'user_id', 'eq', 42);
    expectBinaryParam(user['name']!.like('%Ali%'), 'users', 'name', 'like', '%Ali%');
  });

  it('creates ilike as trait-matched extension operation returning predicate', () => {
    const user = createModelAccessor(context, 'public', 'User');
    const ilike = user['name']!.ilike;
    const result = ilike('%ali%');
    expect(result).toBeInstanceOf(OperationExpr);
    const op = result as OperationExpr;
    expect(op.method).toBe('ilike');
    expect(op.self).toEqual(ColumnRef.of('users', 'name'));
  });

  it('does not expose ilike on non-textual fields', () => {
    const post = createModelAccessor(context, 'public', 'Post');
    const field = post['views'] as unknown as Record<string, unknown>;
    expect(field['ilike']).toBeUndefined();
  });

  it('creates list literal, null check, and order directive helpers', () => {
    const accessor = createModelAccessor(context, 'public', 'Post');

    expect(accessor['id']!.in([1, 2, 3])).toEqual(
      BinaryExpr.in(
        ColumnRef.of('posts', 'id'),
        ListExpression.of([
          paramRef('posts', 'id', 1),
          paramRef('posts', 'id', 2),
          paramRef('posts', 'id', 3),
        ]),
      ),
    );
    expect(accessor['id']!.notIn([4, 5])).toEqual(
      BinaryExpr.notIn(
        ColumnRef.of('posts', 'id'),
        ListExpression.of([paramRef('posts', 'id', 4), paramRef('posts', 'id', 5)]),
      ),
    );
    expect(accessor['id']!.asc()).toEqual(OrderByItem.asc(ColumnRef.of('posts', 'id')));
    expect(accessor['id']!.desc()).toEqual(OrderByItem.desc(ColumnRef.of('posts', 'id')));

    const user = createModelAccessor(context, 'public', 'User');
    expect(user['email']!.isNull()).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'email')));
    expect(user['email']!.isNotNull()).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('users', 'email')),
    );
  });

  it('creates some() relation filters as EXISTS subqueries', () => {
    const accessor = createModelAccessor(context, 'public', 'User');

    expect(accessor['posts']!.some()).toEqual(
      ExistsExpr.exists(
        SelectAst.from(TableSource.named('posts', undefined, 'public'))
          .withProjection([ProjectionItem.of('_exists', ColumnRef.of('posts', 'user_id'))])
          .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'))),
      ),
    );
  });

  it('creates none() and every() relation filters with NOT EXISTS semantics', () => {
    const accessor = createModelAccessor(context, 'public', 'User');

    const noneExpr = accessor['posts']!.none({ views: 10 }) as ExistsExpr;
    expect(noneExpr.notExists).toBe(true);
    expect(noneExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.eq(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 10)),
      ]),
    );

    const everyExpr = accessor['posts']!.every((post) => post['views']!.gt(10)) as ExistsExpr;
    expect(everyExpr.notExists).toBe(true);
    expect(everyExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        new NotExpr(BinaryExpr.gt(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 10))),
      ]),
    );
  });

  it('treats every({}) as vacuously true and none() as a plain anti-exists join', () => {
    const accessor = createModelAccessor(context, 'public', 'User');

    expect(accessor['posts']!.every({})).toEqual(AndExpr.true());

    const expr = accessor['posts']!.none() as ExistsExpr;
    expect(expr.notExists).toBe(true);
    expect(expr.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );
  });

  it('supports nested relation filters', () => {
    const accessor = createModelAccessor(context, 'public', 'User');
    const expr = accessor['posts']!.some((post) =>
      post['comments']!.some((comment) => comment['body']!.like('%urgent%')),
    ) as ExistsExpr;

    expect(expr.subquery.where!.kind).toBe('and');
    const where = expr.subquery.where! as AndExpr;
    expect(where.exprs[1]!.kind).toBe('exists');
  });

  it('aliases both directions of ordinary self-relation predicates', () => {
    const children = createModelAccessor(context, 'public', 'User')['invitedUsers']!.some(
      (invitee) => invitee['name']!.eq('Bob'),
    ) as ExistsExpr;
    const inviter = createModelAccessor(context, 'public', 'User')['invitedBy']!.some((invitedBy) =>
      invitedBy['name']!.eq('Alice'),
    ) as ExistsExpr;

    expect(children.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(children.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'invited_by_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'name'), paramRef('users', 'name', 'Bob')),
      ]),
    );
    expect(inviter.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(inviter.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'id'), ColumnRef.of('users', 'invited_by_id')),
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'name'), paramRef('users', 'name', 'Alice')),
      ]),
    );
  });

  it('allocates distinct aliases for sibling predicates from one accessor', () => {
    const accessor = createModelAccessor(context, 'public', 'User');
    const children = accessor['invitedUsers']!.some((invitee) =>
      invitee['name']!.eq('Bob'),
    ) as ExistsExpr;
    const inviter = accessor['invitedBy']!.some((invitedBy) =>
      invitedBy['name']!.eq('Alice'),
    ) as ExistsExpr;

    expect(children.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(inviter.subquery.from).toEqual(TableSource.named('users', '__orm_rel_2', 'public'));
  });

  it('correlates repeated self-relation predicates to the immediate parent alias', () => {
    const expr = createModelAccessor(context, 'public', 'User')['invitedUsers']!.some((child) =>
      child['invitedUsers']!.some((grandchild) => grandchild['name']!.eq('Dan')),
    ) as ExistsExpr;
    const outerWhere = expr.subquery.where as AndExpr;
    const nested = outerWhere.exprs[1] as ExistsExpr;

    expect(expr.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(outerWhere.exprs[0]).toEqual(
      BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'invited_by_id'), ColumnRef.of('users', 'id')),
    );
    expect(nested.subquery.from).toEqual(TableSource.named('users', '__orm_rel_2', 'public'));
    expect(nested.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('__orm_rel_2', 'invited_by_id'),
          ColumnRef.of('__orm_rel_1', 'id'),
        ),
        BinaryExpr.eq(ColumnRef.of('__orm_rel_2', 'name'), paramRef('users', 'name', 'Dan')),
      ]),
    );
  });

  it('keeps proxy symbol access undefined and relation shorthand maps null and undefined', () => {
    const user = createModelAccessor(context, 'public', 'User');
    expect((user as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined();

    // Unknown fields in a shorthand predicate are surfaced loudly — silent skip would drop user intent (a typo'd filter would match every row).
    expect(() => user['posts']!.some({ unknown: 'value' })).toThrow(
      /Shorthand filter on "Post\.unknown": field is not defined on the model/,
    );

    // Undefined values are skipped before the field lookup, so a shorthand with an unknown field and undefined value is a no-op.
    const someUndefined = user['posts']!.some({ unknown: undefined }) as ExistsExpr;
    expect(someUndefined.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );

    const post = createModelAccessor(context, 'public', 'Post');
    const nullExpr = post['comments']!.some({ body: null }) as ExistsExpr;
    expect(nullExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('comments', 'post_id'), ColumnRef.of('posts', 'id')),
        NullCheckExpr.isNull(ColumnRef.of('comments', 'body')),
      ]),
    );
  });

  it('throws when relation metadata is incomplete', () => {
    const base = getTestContract();
    const brokenJoinContract = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: 'public' },
            cardinality: '1:N',
            on: {
              localFields: [],
              targetFields: [],
            },
          },
        },
      },
    }));

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: brokenJoinContract } as never,
          'public',
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });

  it('supports composite relation joins and first-target fallback projection', () => {
    const base = getTestContract();
    const compositeContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as {
        storage: Record<string, unknown>;
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_alt',
          },
          relations: {
            ...user.relations,
            posts: {
              to: { model: 'Post', namespace: 'public' },
              cardinality: '1:N',
              on: {
                localFields: ['id', 'email'],
                targetFields: ['userId', 'title'],
              },
            },
          },
        },
      };
    });

    const compositeExpr = (
      createModelAccessor(
        { ...context, contract: compositeContract } as never,
        'public',
        'User',
      ) as unknown as Record<string, { some: () => unknown }>
    )['posts']!.some() as ExistsExpr;
    expect(compositeExpr.subquery.projection).toEqual([
      ProjectionItem.of('_exists', ColumnRef.of('posts', 'user_id')),
    ]);
    expect(compositeExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users_alt', 'id')),
        BinaryExpr.eq(ColumnRef.of('posts', 'title'), ColumnRef.of('users_alt', 'email')),
      ]),
    );

    const noTargetFieldsContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as {
        storage: Record<string, unknown>;
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_alt',
          },
          relations: {
            ...user.relations,
            posts: {
              to: { model: 'Post', namespace: 'public' },
              cardinality: '1:N',
              on: {
                localFields: ['id', 'name'],
                targetFields: [undefined, 'title'],
              },
            },
          },
        },
      };
    });

    const fallbackExpr = (
      createModelAccessor(
        { ...context, contract: noTargetFieldsContract } as never,
        'public',
        'User',
      ) as unknown as Record<string, { some: () => unknown }>
    )['posts']!.some() as ExistsExpr;
    expect(fallbackExpr.subquery.projection).toEqual([
      ProjectionItem.of('_exists', ColumnRef.of('posts', 'id')),
    ]);
  });

  it('returns undefined for fields whose storage table is not declared', () => {
    const base = getTestContract();
    const storageFallbackContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as { storage: Record<string, unknown> };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_storage',
          },
        },
      };
    });

    // Contract claims the User model lives in `users_storage`, but storage.tables has no entry for it. The Proxy returns undefined for fields whose column cannot be resolved, matching plain JS object semantics. Downstream consumers (or TypeScript at compile time) are responsible for noticing the missing column.
    const accessor = createModelAccessor(
      { ...context, contract: storageFallbackContract } as never,
      'public',
      'User',
    );
    expect(accessor['name']).toBeUndefined();
  });

  it('has no accessor for a column no field maps, under its column or its field name', () => {
    const contract = buildUnexposedColumnContract();
    const accessor = createModelAccessor(buildTestContextFromContract(contract), 'public', 'User');

    expect({
      column: accessor['legacy_key'],
      field: accessor['legacyKey'],
      exposed: accessor['email'] === undefined,
    }).toEqual({ column: undefined, field: undefined, exposed: false });
  });

  it('combines relation shorthand fields with and() and rejects missing join arrays', () => {
    const accessor = createModelAccessor(context, 'public', 'User');
    const predicate = accessor['posts']!.some({ title: 'A', views: 1 }) as ExistsExpr;

    expect(predicate.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'title'), paramRef('posts', 'title', 'A')),
          BinaryExpr.eq(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 1)),
        ]),
      ]),
    );

    const base = getTestContract();
    const contractWithoutJoinArrays = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: 'public' },
            cardinality: '1:N',
            on: { localFields: [], targetFields: [] },
          },
        },
      },
    }));

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: contractWithoutJoinArrays } as never,
          'public',
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });
});

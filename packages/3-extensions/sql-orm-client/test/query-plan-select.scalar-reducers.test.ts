import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  CastExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonObjectExpr,
  LiteralExpr,
  OrderByItem,
  ProjectionItem,
  type SelectAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileSelectWithIncludes } from '../src/query-plan-select';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollection } from './collection-fixtures';
import { getTestAggregates } from './helpers';
import {
  expectDerivedTableSource,
  expectSelectAst,
  expectSubqueryExpr,
} from './query-plan-select-helpers';

describe('compileSelectWithIncludes', () => {
  // Each scalar reducer lowers to a correlated subquery whose
  // projection is the `json_build_object('value', AGG(...))` envelope.
  // The JSON wrapper lets the value travel through the existing
  // include-payload decoder (which JSON.parse'es the column and pulls
  // `.value` out) — no codec wiring needed on the outer projection.
  describe('correlated scalar reducers', () => {
    function extractScalarCorrelatedSubquery(
      plan: { ast: unknown },
      relationName: string,
    ): SelectAst {
      expectSelectAst(plan.ast);
      const projection = plan.ast.projection.find((item) => item.alias === relationName);
      expectSubqueryExpr(projection?.expr);
      return projection.expr.query;
    }

    /**
     * A reducer's value enters the JSON envelope under the codec the target
     * declares for it, so the expectation names that codec: `count` and `sum`
     * read through `pg/int8number@1`, `avg` through `pg/float8@1` — its
     * lowering casting the mean once — and `min`/`max` keep the column's own
     * codec, `pg/int4@1` here.
     */
    function expectAggregateProjection(
      subquerySelect: SelectAst,
      relationName: string,
      expectedAggregate: AnyExpression,
      resultCodecId: string,
    ): void {
      expect(subquerySelect.projection).toEqual([
        ProjectionItem.of(
          relationName,
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(expectedAggregate, { codecId: resultCodecId }),
            ),
          ]),
        ),
      ]);
    }

    it('emits correlated COUNT(*) for a bare count() include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.count()).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
        'User',
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count(), 'pg/int8number@1');
      expect(subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
      );
      // This aggregate has no pagination / orderBy to carry.
      expect(subquery.limit).toBeUndefined();
      expect(subquery.offset).toBeUndefined();
      expect(subquery.orderBy).toBeUndefined();
    });

    it('emits correlated COUNT(*) over the where-filtered relation', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gte(100)).count(),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
        'User',
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count(), 'pg/int8number@1');
      expect(subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // `orderBy` on a scalar refine is meaningless for an aggregate.
    // Silently drop it at SQL level — matches existing behaviour for
    // other irrelevant clauses (e.g. ignoring select() in scalar context).
    it('silently drops orderBy() applied to a scalar refine', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.orderBy((post) => post.id.asc()).count(),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
        'User',
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
      expect(subquery.orderBy).toBeUndefined();
    });

    // Pagination on a scalar refine composes through to the aggregate
    // scope: `limit(N)` / `offset(M)` shape the row set the aggregate sees.
    it('pagination composes through to the correlated COUNT scope', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .where((post) => post.views.gte(100))
          .offset(5)
          .limit(10)
          .count(),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
        'User',
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count(), 'pg/int8number@1');
      expect(subquery.limit).toBeUndefined();
      expect(subquery.offset).toBeUndefined();
      expect(subquery.where).toBeUndefined();
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__scalar');

      const innerSelect = subquery.from.query;
      expect(innerSelect.limit).toBe(10);
      expect(innerSelect.offset).toBe(5);
      expect(innerSelect.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // `distinct(cols).orderBy(c).limit(N).sum(...)` must aggregate the
    // ordered top-N deduped rows. The ROW_NUMBER dedup wrap strips
    // ordering from its output, so the orderBy is reapplied on the
    // wrapped alias before LIMIT slices the deduped rows.
    it('reapplies orderBy after the ROW_NUMBER dedup wrap', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .distinct('title')
          .orderBy((post) => post.views.desc())
          .limit(2)
          .sum('views'),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
        'User',
      );
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(
        subquery,
        'posts',
        AggregateExpr.sum(ColumnRef.of('posts__scalar', 'views')),
        'pg/int8number@1',
      );
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__scalar');

      const innerSelect = subquery.from.query;
      expect(innerSelect.limit).toBe(2);
      expectDerivedTableSource(innerSelect.from);
      expect(innerSelect.from.alias).toBe('posts__scalar_distinct');
      expect(innerSelect.orderBy).toEqual([
        new OrderByItem(
          ColumnRef.of('posts__scalar_distinct', 'posts__order_0'),
          'desc',
          undefined,
        ),
      ]);
    });

    it('emits correlated SUM / AVG / MIN / MAX over the column reference', () => {
      const reducers: ReadonlyArray<['sum' | 'avg' | 'min' | 'max', AnyExpression, string]> = [
        ['sum', AggregateExpr.sum(ColumnRef.of('posts', 'views')), 'pg/int8number@1'],
        [
          'avg',
          CastExpr.as(AggregateExpr.avg(ColumnRef.of('posts', 'views')), 'float8'),
          'pg/float8@1',
        ],
        ['min', AggregateExpr.min(ColumnRef.of('posts', 'views')), 'pg/int4@1'],
        ['max', AggregateExpr.max(ColumnRef.of('posts', 'views')), 'pg/int4@1'],
      ];
      for (const [fn, expected, resultCodecId] of reducers) {
        const { collection } = createCollection();
        const state = collection.include('posts', (posts) => {
          switch (fn) {
            case 'sum':
              return posts.sum('views');
            case 'avg':
              return posts.avg('views');
            case 'min':
              return posts.min('views');
            case 'max':
              return posts.max('views');
          }
        }).state;
        const plan = compileSelectWithIncludes(
          baseContract,
          getTestAggregates(),
          'public',
          'users',
          state,
          'User',
        );
        const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
        expectAggregateProjection(subquery, 'posts', expected, resultCodecId);
      }
    });

    // Recursive: scalar nested inside a row include emits a nested
    // correlated subquery inside the parent row's child SELECT.
    it('emits a nested correlated subquery for count() inside a row include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.include('comments', (comments) => comments.count()),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'users',
        state,
        'User',
      );
      const postsSubquery = extractScalarCorrelatedSubquery(plan, 'posts');
      // The posts subquery's FROM is the child-rows derived table; its
      // inner SELECT carries the nested comments correlated subquery as
      // a projection item.
      expectDerivedTableSource(postsSubquery.from);
      const postsRows = postsSubquery.from.query;
      const commentsProjection = postsRows.projection.find((item) => item.alias === 'comments');
      expectSubqueryExpr(commentsProjection?.expr);
      expect(commentsProjection.expr.query.projection).toEqual([
        ProjectionItem.of(
          'comments',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(AggregateExpr.count(), {
                codecId: 'pg/int8number@1',
              }),
            ),
          ]),
        ),
      ]);
    });
  });
});

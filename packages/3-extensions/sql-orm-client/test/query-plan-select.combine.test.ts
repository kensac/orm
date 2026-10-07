import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  CodecJsonValueProjection,
  ColumnRef,
  JsonDocumentProjection,
  JsonObjectExpr,
  LiteralExpr,
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
  // combine() packs into a single correlated subquery whose FROM
  // cross-joins per-branch derived tables and whose projection is the
  // `json_build_object`
  // over those branches.
  describe('correlated combine() packing', () => {
    function extractCombineCorrelatedSubquery(
      plan: { ast: unknown },
      relationName: string,
    ): SelectAst {
      expectSelectAst(plan.ast);
      const projection = plan.ast.projection.find((item) => item.alias === relationName);
      expectSubqueryExpr(projection?.expr);
      return projection.expr.query;
    }

    it('packs row + scalar combine into one correlated subquery', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((p) => p.id.desc()).limit(3),
          total: posts.count(),
        }),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'User',
        'users',
        state,
      );
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      // Outer projection is json_build_object referencing per-branch
      // derived-table aliases.
      expect(subquery.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'recent',
              new JsonDocumentProjection(ColumnRef.of('posts__combine__recent', 'posts')),
            ),
            JsonObjectExpr.entry(
              'total',
              new JsonDocumentProjection(ColumnRef.of('posts__combine__total', 'posts')),
            ),
          ]),
        ),
      ]);

      // FROM <recent_branch>, INNER JOIN <total_branch> ON TRUE.
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__combine__recent');
      const totalJoin = subquery.joins?.[0];
      expect(totalJoin?.joinType).toBe('inner');
      expect(totalJoin?.lateral).toBe(false);
      expect(totalJoin?.on).toEqual(AndExpr.true());
      expectDerivedTableSource(totalJoin?.source);
      expect(totalJoin.source.alias).toBe('posts__combine__total');
    });

    it('packs two scalar branches (count + sum) under correlated', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          a: posts.count(),
          b: posts.sum('views'),
        }),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'User',
        'users',
        state,
      );
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      expectDerivedTableSource(subquery.from);
      const aSelect = subquery.from.query;
      expect(aSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
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
      const bJoin = subquery.joins?.[0];
      expectDerivedTableSource(bJoin?.source);
      const bSelect = bJoin.source.query;
      expect(bSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry(
              'value',
              new CodecJsonValueProjection(AggregateExpr.sum(ColumnRef.of('posts', 'views')), {
                codecId: 'pg/int8number@1',
              }),
            ),
          ]),
        ),
      ]);
    });

    it('keeps each branch independently scoped under divergent where filters (correlated)', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          popular: posts.where((p) => p.views.gte(200)).count(),
          mediocre: posts.where((p) => p.views.lt(200)).count(),
        }),
      ).state;

      const plan = compileSelectWithIncludes(
        baseContract,
        getTestAggregates(),
        'public',
        'User',
        'users',
        state,
      );
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      const fkExpr = BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'));
      const popularWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );
      const mediocreWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.lt(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );

      expectDerivedTableSource(subquery.from);
      const popularSelect = subquery.from.query;
      expect(popularSelect.where).toEqual(AndExpr.of([fkExpr, popularWhere]));
      const mediocreJoin = subquery.joins?.[0];
      expectDerivedTableSource(mediocreJoin?.source);
      const mediocreSelect = mediocreJoin.source.query;
      expect(mediocreSelect.where).toEqual(AndExpr.of([fkExpr, mediocreWhere]));
    });
  });
});

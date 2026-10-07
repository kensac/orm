import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  type ExistsExpr,
  JoinAst,
  NotExpr,
  ProjectionItem,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContract, withPatchedDomainModels } from './helpers';
import { context, paramRef } from './model-accessor-helpers';

describe('createModelAccessor', () => {
  describe('M:N relation filters via junction', () => {
    it('some() emits EXISTS through junction (single-key)', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { some: (pred?: unknown) => unknown }
      >;

      const expr = accessor['tags']!.some() as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.from).toEqual(TableSource.named('tags', undefined, 'public'));
      expect(expr.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('user_tags', undefined, 'public'),
          BinaryExpr.eq(ColumnRef.of('user_tags', 'tag_id'), ColumnRef.of('tags', 'id')),
        ),
      ]);
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
      );
    });

    it('some(pred) AND-s junction correlation with predicate', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { some: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['tags']!.some((c: unknown) =>
        (c as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Rust'),
      ) as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
          BinaryExpr.eq(ColumnRef.of('tags', 'name'), paramRef('tags', 'name', 'Rust')),
        ]),
      );
    });

    it('none() emits NOT EXISTS through junction', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { none: (pred?: unknown) => unknown }
      >;

      const expr = accessor['tags']!.none() as ExistsExpr;
      expect(expr.notExists).toBe(true);
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
      );
    });

    it('every(pred) emits NOT EXISTS(… AND NOT(pred)) through junction', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { every: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['tags']!.every((c: unknown) =>
        (c as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Rust'),
      ) as ExistsExpr;

      expect(expr.notExists).toBe(true);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
          new NotExpr(
            BinaryExpr.eq(ColumnRef.of('tags', 'name'), paramRef('tags', 'name', 'Rust')),
          ),
        ]),
      );
    });

    it('every({}) is vacuously true for M:N relations', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { every: (pred: unknown) => unknown }
      >;

      expect(accessor['tags']!.every({})).toEqual(AndExpr.true());
    });

    it('some() emits EXISTS with composite-key AND-ed junction join', () => {
      const accessor = createModelAccessor(context, 'public', 'Project') as unknown as Record<
        string,
        { some: () => unknown }
      >;

      const expr = accessor['related']!.some() as ExistsExpr;

      expect(expr.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('project_links', undefined, 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_tenant_id'),
              ColumnRef.of('__orm_rel_1', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_id'),
              ColumnRef.of('__orm_rel_1', 'id'),
            ),
          ]),
        ),
      ]);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('project_links', 'src_tenant_id'),
            ColumnRef.of('projects', 'tenant_id'),
          ),
          BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of('projects', 'id')),
        ]),
      );
    });

    it('aliases the related table for self-referential M:N predicates', () => {
      const accessor = createModelAccessor(context, 'public', 'Project') as unknown as Record<
        string,
        { some: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['related']!.some((c: unknown) =>
        (c as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Apollo'),
      ) as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('projects', '__orm_rel_1', 'public'));
      expect(expr.subquery.projection).toEqual([
        ProjectionItem.of('_exists', ColumnRef.of('__orm_rel_1', 'tenant_id')),
      ]);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'src_tenant_id'),
              ColumnRef.of('projects', 'tenant_id'),
            ),
            BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of('projects', 'id')),
          ]),
          BinaryExpr.eq(
            ColumnRef.of('__orm_rel_1', 'name'),
            paramRef('projects', 'name', 'Apollo'),
          ),
        ]),
      );
    });

    it('uses distinct child and junction aliases for repeated self-referential M:N predicates', () => {
      const accessor = createModelAccessor(context, 'public', 'Project') as unknown as Record<
        string,
        { some: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['related']!.some((related: unknown) =>
        (related as Record<string, { some: (pred: (c: unknown) => unknown) => unknown }>)[
          'related'
        ]!.some((nested: unknown) =>
          (nested as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Gamma'),
        ),
      ) as ExistsExpr;
      const outerWhere = expr.subquery.where as AndExpr;
      const nested = outerWhere.exprs[1] as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('projects', '__orm_rel_1', 'public'));
      expect(expr.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('project_links', undefined, 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_tenant_id'),
              ColumnRef.of('__orm_rel_1', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_id'),
              ColumnRef.of('__orm_rel_1', 'id'),
            ),
          ]),
        ),
      ]);
      expect(nested.subquery.from).toEqual(TableSource.named('projects', '__orm_rel_2', 'public'));
      expect(nested.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('project_links', '__orm_junction_3', 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'dst_tenant_id'),
              ColumnRef.of('__orm_rel_2', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'dst_id'),
              ColumnRef.of('__orm_rel_2', 'id'),
            ),
          ]),
        ),
      ]);
      expect(nested.subquery.where).toEqual(
        AndExpr.of([
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'src_tenant_id'),
              ColumnRef.of('__orm_rel_1', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'src_id'),
              ColumnRef.of('__orm_rel_1', 'id'),
            ),
          ]),
          BinaryExpr.eq(ColumnRef.of('__orm_rel_2', 'name'), paramRef('projects', 'name', 'Gamma')),
        ]),
      );
    });

    it('throws when M:N join metadata column counts differ', () => {
      const malformedContract = withPatchedDomainModels(getTestContract(), (models) => {
        const project = models['Project'] as { relations: Record<string, unknown> };
        const related = project.relations['related'] as { through: Record<string, unknown> };
        return {
          ...models,
          Project: {
            ...project,
            relations: {
              ...project.relations,
              related: {
                ...related,
                through: { ...related.through, targetColumns: ['tenant_id'] },
              },
            },
          },
        };
      });
      const accessor = createModelAccessor(
        { ...context, contract: malformedContract } as never,
        'public',
        'Project',
      ) as unknown as Record<string, { some: () => unknown }>;

      expect(() => accessor['related']!.some()).toThrow(
        /Relation metadata has mismatched join column counts/,
      );
    });

    it('throws when M:N join metadata omits a paired column', () => {
      const malformedContract = withPatchedDomainModels(getTestContract(), (models) => {
        const project = models['Project'] as { relations: Record<string, unknown> };
        const related = project.relations['related'] as { through: Record<string, unknown> };
        return {
          ...models,
          Project: {
            ...project,
            relations: {
              ...project.relations,
              related: {
                ...related,
                through: { ...related.through, childColumns: ['dst_tenant_id', ''] },
              },
            },
          },
        };
      });
      const accessor = createModelAccessor(
        { ...context, contract: malformedContract } as never,
        'public',
        'Project',
      ) as unknown as Record<string, { some: () => unknown }>;

      expect(() => accessor['related']!.some()).toThrow(
        /Relation metadata is missing a join column pair/,
      );
    });
  });
});

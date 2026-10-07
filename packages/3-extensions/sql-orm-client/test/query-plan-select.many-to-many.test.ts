import {
  AndExpr,
  BinaryExpr,
  CodecJsonValueProjection,
  type CodecRef,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  LiteralExpr,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { compileSelectWithIncludes } from '../src/query-plan-select';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import { getTestAggregates } from './helpers';
import {
  codecRefFor,
  expectDerivedTableSource,
  expectSelectAst,
  expectSubqueryExpr,
} from './query-plan-select-helpers';
import { unboundTables } from './unbound-tables';

describe('M:N include correlated subquery', () => {
  // Codec ref for a real fixture column, matching what the planner attaches to
  // projection items (codecId plus any storage typeParams).
  function codecRef(table: string, column: string): CodecRef {
    const meta = (
      unboundTables(baseContract.storage) as Record<string, { columns: Record<string, CodecRef> }>
    )[table]!.columns[column]!;
    return meta.typeParams !== undefined
      ? { codecId: meta.codecId, typeParams: meta.typeParams }
      : { codecId: meta.codecId };
  }

  // `ref` is the AST table/alias the column is read from; `storageTable`
  // (defaulting to `ref`) is the real fixture table the codec is resolved from
  // — they differ when the planner aliases a self-referential child table.
  function proj(alias: string, ref: string, column: string, storageTable = ref): ProjectionItem {
    return ProjectionItem.of(alias, ColumnRef.of(ref, column), codecRef(storageTable, column));
  }

  it('compiles a single-column M:N include to one correlated subquery through the junction', () => {
    // User.tags -[M:N via user_tags]-> Tag (real emitted fixture):
    //   user_tags.user_id -> users.id (correlation), user_tags.tag_id -> tags.id (join).
    const { collection } = createCollectionFor('User');
    const state = collection.include('tags').state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
      'User',
    );

    const tagRows = SelectAst.from(TableSource.named('tags', undefined, 'public'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('user_tags', undefined, 'public'),
          BinaryExpr.eq(ColumnRef.of('user_tags', 'tag_id'), ColumnRef.of('tags', 'id')),
        ),
      ])
      .withProjection([proj('id', 'tags', 'id'), proj('name', 'tags', 'name')])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')));

    const tagsAggregate = SelectAst.from(
      DerivedTableSource.as('tags__rows', tagRows),
    ).withProjection([
      ProjectionItem.of(
        'tags',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('tags__rows', 'id'),
                  codecRefFor('tags', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('tags__rows', 'name'),
                  codecRefFor('tags', 'name'),
                ),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('users', undefined, 'public'))
        .withProjection([
          proj('address', 'users', 'address'),
          proj('email', 'users', 'email'),
          proj('id', 'users', 'id'),
          proj('invited_by_id', 'users', 'invited_by_id'),
          proj('name', 'users', 'name'),
          ProjectionItem.of('tags', SubqueryExpr.of(tagsAggregate)),
        ])
        .withSelectAllIntent({ table: 'users' }),
    );
  });

  it('AND-s across all column pairs for a composite-key M:N junction', () => {
    // Project.related -[M:N via project_links]-> Project (composite key on
    // (tenant_id, id)). The child table is aliased `related__child` because the
    // relation is self-referential. Correlation: project_links.src_* -> projects.*;
    // join: project_links.dst_* -> related__child.*.
    const { collection } = createCollectionFor('Project');
    const state = collection.include('related').state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'projects',
      state,
      'Project',
    );

    const relatedRows = SelectAst.from(TableSource.named('projects', 'related__child', 'public'))
      .withJoins([
        JoinAst.inner(
          TableSource.named('project_links', undefined, 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_tenant_id'),
              ColumnRef.of('related__child', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_id'),
              ColumnRef.of('related__child', 'id'),
            ),
          ]),
        ),
      ])
      .withProjection([
        proj('id', 'related__child', 'id', 'projects'),
        proj('name', 'related__child', 'name', 'projects'),
        proj('tenant_id', 'related__child', 'tenant_id', 'projects'),
      ])
      .withWhere(
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('project_links', 'src_tenant_id'),
            ColumnRef.of('projects', 'tenant_id'),
          ),
          BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of('projects', 'id')),
        ]),
      );

    const relatedAggregate = SelectAst.from(
      DerivedTableSource.as('related__rows', relatedRows),
    ).withProjection([
      ProjectionItem.of(
        'related',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'id'),
                  codecRefFor('projects', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'name'),
                  codecRefFor('projects', 'name'),
                ),
              ),
              JsonObjectExpr.entry(
                'tenant_id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'tenant_id'),
                  codecRefFor('projects', 'tenant_id'),
                ),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('projects', undefined, 'public'))
        .withProjection([
          proj('id', 'projects', 'id'),
          proj('name', 'projects', 'name'),
          proj('tenant_id', 'projects', 'tenant_id'),
          ProjectionItem.of('related', SubqueryExpr.of(relatedAggregate)),
        ])
        .withSelectAllIntent({ table: 'projects' }),
    );
  });

  // Control case for the M:N lowering above: an ordinary 1:N FK include
  // (users → posts, joined by posts.user_id = users.id) must still lower to a
  // correlated subquery whose child SELECT has NO junction JOIN and correlates
  // with a plain WHERE on the child's FK column. This pins that the
  // junction-join branch fires only for N:M relations and never leaks into the
  // FK include path.
  it('1:N FK include lowers to a child-FK WHERE with no junction join', () => {
    const { collection } = createCollection();
    const state = collection.include('posts').state;

    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'users',
      state,
      'User',
    );
    expectSelectAst(plan.ast);

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSelect = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSelect);
    const childSelect = childRowsSelect.query;

    expect(childSelect.joins ?? []).toHaveLength(0);
    expect(childSelect.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );
  });

  // M:N + distinct(cols) + a nested non-leaf include exercises
  // `buildDistinctNonLeafChildRowsSelect`, which applies the junction join to
  // the innermost scalar SELECT inside the ROW_NUMBER dedup wrap (the
  // `*__ranked` layer) — never the dedup wrapper or the outer distinct SELECT.
  // Driven off the real fixture's self-referential Project.related M:N: the
  // outer include distinct('name') with a nested .include('related') reaches
  // the distinct-non-leaf lowering. The whole-AST `toEqual` pins the layering:
  // `related__rows` (json_agg) → `related__distinct` (rn = 1 filter) →
  // `related__ranked` (junction join + ROW_NUMBER) → `projects AS related__child`.
  it('lowers M:N + distinct + nested non-leaf to a ranked dedup with the junction join on the ranked layer', () => {
    const { collection } = createCollectionFor('Project');
    const state = collection.include('related', (related) =>
      related.distinct('name').include('related'),
    ).state;
    const plan = compileSelectWithIncludes(
      baseContract,
      getTestAggregates(),
      'public',
      'projects',
      state,
      'Project',
    );

    const junctionJoinOnto = (childRef: string): JoinAst =>
      JoinAst.inner(
        TableSource.named('project_links', undefined, 'public'),
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('project_links', 'dst_tenant_id'),
            ColumnRef.of(childRef, 'tenant_id'),
          ),
          BinaryExpr.eq(ColumnRef.of('project_links', 'dst_id'), ColumnRef.of(childRef, 'id')),
        ]),
      );

    const correlateOnto = (parentRef: string): AndExpr =>
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('project_links', 'src_tenant_id'),
          ColumnRef.of(parentRef, 'tenant_id'),
        ),
        BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of(parentRef, 'id')),
      ]);

    // Innermost scalar SELECT (FROM projects AS related__child) carrying the
    // junction join, correlated WHERE, and the ROW_NUMBER ranking column.
    const ranked = SelectAst.from(TableSource.named('projects', 'related__child', 'public'))
      .withJoins([junctionJoinOnto('related__child')])
      .withProjection([
        proj('id', 'related__child', 'id', 'projects'),
        proj('name', 'related__child', 'name', 'projects'),
        proj('tenant_id', 'related__child', 'tenant_id', 'projects'),
        ProjectionItem.of(
          '__prisma_distinct_rn',
          WindowFuncExpr.rowNumber({
            partitionBy: [ColumnRef.of('related__child', 'name')],
            orderBy: [OrderByItem.asc(ColumnRef.of('related__child', 'name'))],
          }),
        ),
      ])
      .withWhere(correlateOnto('projects'));

    // Nested related aggregate, correlated to the deduped distinct row.
    const nestedRelatedRows = SelectAst.from(TableSource.named('projects', undefined, 'public'))
      .withJoins([junctionJoinOnto('projects')])
      .withProjection([
        proj('id', 'projects', 'id'),
        proj('name', 'projects', 'name'),
        proj('tenant_id', 'projects', 'tenant_id'),
      ])
      .withWhere(correlateOnto('related__distinct'));

    const nestedRelatedAggregate = SelectAst.from(
      DerivedTableSource.as('related__rows', nestedRelatedRows),
    ).withProjection([
      ProjectionItem.of(
        'related',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'id'),
                  codecRefFor('projects', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'name'),
                  codecRefFor('projects', 'name'),
                ),
              ),
              JsonObjectExpr.entry(
                'tenant_id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'tenant_id'),
                  codecRefFor('projects', 'tenant_id'),
                ),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    // Dedup filter SELECT: keep rn = 1, forwarding scalar columns and their
    // codecs from the ranked layer.
    const dedupFilter = SelectAst.from(DerivedTableSource.as('related__ranked', ranked))
      .withProjection([
        proj('id', 'related__ranked', 'id', 'projects'),
        proj('name', 'related__ranked', 'name', 'projects'),
        proj('tenant_id', 'related__ranked', 'tenant_id', 'projects'),
      ])
      .withWhere(
        BinaryExpr.eq(ColumnRef.of('related__ranked', '__prisma_distinct_rn'), LiteralExpr.of(1)),
      );

    // Distinct SELECT over the deduped rows: re-attach codecs and the nested
    // related aggregate, correlating it back to these rows.
    const distinct = SelectAst.from(
      DerivedTableSource.as('related__distinct', dedupFilter),
    ).withProjection([
      proj('id', 'related__distinct', 'id', 'projects'),
      proj('name', 'related__distinct', 'name', 'projects'),
      proj('tenant_id', 'related__distinct', 'tenant_id', 'projects'),
      ProjectionItem.of('related', SubqueryExpr.of(nestedRelatedAggregate)),
    ]);

    // Outer aggregate over the deduped rows.
    const aggregate = SelectAst.from(
      DerivedTableSource.as('related__rows', distinct),
    ).withProjection([
      ProjectionItem.of(
        'related',
        JsonArrayAggExpr.of(
          new JsonDocumentProjection(
            JsonObjectExpr.fromEntries([
              JsonObjectExpr.entry(
                'id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'id'),
                  codecRefFor('projects', 'id'),
                ),
              ),
              JsonObjectExpr.entry(
                'name',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'name'),
                  codecRefFor('projects', 'name'),
                ),
              ),
              JsonObjectExpr.entry(
                'tenant_id',
                new CodecJsonValueProjection(
                  ColumnRef.of('related__rows', 'tenant_id'),
                  codecRefFor('projects', 'tenant_id'),
                ),
              ),
              JsonObjectExpr.entry(
                'related',
                new JsonDocumentProjection(ColumnRef.of('related__rows', 'related')),
              ),
            ]),
          ),
          'emptyArray',
        ),
      ),
    ]);

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('projects', undefined, 'public'))
        .withProjection([
          proj('id', 'projects', 'id'),
          proj('name', 'projects', 'name'),
          proj('tenant_id', 'projects', 'tenant_id'),
          ProjectionItem.of('related', SubqueryExpr.of(aggregate)),
        ])
        .withSelectAllIntent({ table: 'projects' }),
    );
  });
});

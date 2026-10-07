import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  ColumnRef,
  EqColJoinOn,
  JoinAst,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { resolveIncludeRelation } from '../src/collection-contract';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import { type CollectionState, emptyState, type IncludeExpr } from '../src/types';
import { baseContract } from './collection-fixtures';
import { buildMixedPolyContract, buildStiPolyContract, getTestAggregates } from './helpers';
import {
  expectDerivedTableSource,
  expectSelectAst,
  expectSubqueryExpr,
} from './query-plan-select-helpers';
import { unboundTables } from './unbound-tables';

describe('compileSelect MTI JOINs', () => {
  type AnyContract = {
    storage: {
      namespaces: Record<
        string,
        {
          entries: {
            table: Record<string, { columns: Record<string, { codecId: string }> }>;
          };
        }
      >;
    };
  };
  function codecRefForColumn(
    contract: AnyContract,
    table: string,
    column: string,
  ): { codecId: string } | undefined {
    const tables = unboundTables(contract.storage) as Record<
      string,
      { columns: Record<string, { codecId: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? { codecId } : undefined;
  }
  function projectionFor(
    contract: AnyContract,
    table: string,
    columns: readonly string[],
  ): ProjectionItem[] {
    return columns.map((column) =>
      ProjectionItem.of(
        column,
        ColumnRef.of(table, column),
        codecRefForColumn(contract, table, column),
      ),
    );
  }
  const featuresJoinOn = EqColJoinOn.of(
    ColumnRef.of('tasks', 'id'),
    ColumnRef.of('features', 'id'),
  );

  it('explicit selection controls MTI projections while implicit selection retains them', () => {
    const contract = buildMixedPolyContract();
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
      ProjectionItem.of(
        'features__assignee_id',
        ColumnRef.of('features', 'assignee_id'),
        codecRefForColumn(contract, 'features', 'assignee_id'),
      ),
    ];

    const implicitPlan = compileSelect(contract, 'public', 'tasks', emptyState(), 'Task');
    const omittedMtiPlan = compileSelect(
      contract,
      'public',
      'tasks',
      { ...emptyState(), selectedFields: ['id', 'title'] },
      'Task',
    );
    const selectedMtiPlan = compileSelect(
      contract,
      'public',
      'tasks',
      { ...emptyState(), selectedFields: ['id', 'priority'] },
      'Task',
    );

    expect(implicitPlan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([
          JoinAst.left(TableSource.named('features', undefined, 'public'), featuresJoinOn),
        ]),
    );

    expectSelectAst(omittedMtiPlan.ast);
    expect(
      omittedMtiPlan.ast.projection
        .map((item) => item.alias)
        .filter((alias) => alias.startsWith('features__')),
    ).toEqual([]);

    expectSelectAst(selectedMtiPlan.ast);
    const selectedAliases = selectedMtiPlan.ast.projection.map((item) => item.alias);
    expect(selectedAliases.filter((alias) => alias.startsWith('features__'))).toEqual([
      'features__priority',
    ]);
    expect(selectedAliases).not.toContain('priority');
  });

  it('variant query INNER JOINs the specific MTI variant table', () => {
    const contract = buildMixedPolyContract();
    const state = { ...emptyState(), variantName: 'Feature' };
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
      ProjectionItem.of(
        'features__assignee_id',
        ColumnRef.of('features', 'assignee_id'),
        codecRefForColumn(contract, 'features', 'assignee_id'),
      ),
    ];

    const plan = compileSelect(contract, 'public', 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([
          JoinAst.inner(TableSource.named('features', undefined, 'public'), featuresJoinOn),
        ]),
    );
  });

  it('STI-only variant query produces no JOINs', () => {
    const contract = buildMixedPolyContract();
    const state = { ...emptyState(), variantName: 'Bug' };
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
    ]);

    const plan = compileSelect(contract, 'public', 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection(tasksBaseProjection)
        .withSelectAllIntent({ table: 'tasks' }),
    );
  });

  it('non-polymorphic model produces no JOINs', () => {
    const plan = compileSelect(baseContract, 'public', 'users', emptyState(), 'User');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('users', undefined, 'public'))
        .withProjection(
          projectionFor(baseContract, 'users', ['address', 'email', 'id', 'invited_by_id', 'name']),
        )
        .withSelectAllIntent({ table: 'users' }),
    );
  });
});

describe('compileSelectWithIncludes polymorphic targets', () => {
  function includeFor(
    contract: Contract<SqlStorage>,
    parentModel: string,
    relationName: string,
    nested: CollectionState = emptyState(),
    namespaceId = 'public',
  ): IncludeExpr {
    const relation = resolveIncludeRelation(contract, namespaceId, parentModel, relationName);
    return {
      relationName,
      relatedModelName: relation.relatedModelName,
      relatedTableName: relation.relatedTableName,
      relatedNamespaceId: relation.relatedNamespaceId,
      localTableName: relation.localTableName,
      targetColumns: relation.targetColumns,
      localColumns: relation.localColumns,
      cardinality: relation.cardinality,
      nested,
      scalar: undefined,
      combine: undefined,
    };
  }

  function stateWithInclude(include: IncludeExpr): CollectionState {
    return { ...emptyState(), includes: [include] };
  }

  function childRowsSelectFor(plan: { ast: unknown }, relationName: string): SelectAst {
    expectSelectAst(plan.ast);
    const projection = plan.ast.projection.find((item) => item.alias === relationName);
    expectSubqueryExpr(projection?.expr);
    const aggregateQuery = projection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);
    return aggregateQuery.from.query;
  }

  function projectionAliases(select: SelectAst): string[] {
    return select.projection.map((item) => item.alias);
  }

  it('STI-target include projects discriminator and variant base-table columns, no joins', () => {
    const contract = buildStiPolyContract();
    const state = stateWithInclude(includeFor(contract, 'Account', 'members'));

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'accounts',
      state,
      'Account',
    );
    const childRows = childRowsSelectFor(plan, 'members');

    expect(childRows.joins ?? []).toHaveLength(0);
    const aliases = projectionAliases(childRows);
    expect(aliases).toContain('kind');
    expect(aliases).toContain('role');
    expect(aliases).toContain('plan');
  });

  it('MTI-target include selection controls variant projections while implicit selection retains them', () => {
    const contract = buildMixedPolyContract();
    const implicitState = stateWithInclude(includeFor(contract, 'Project', 'tasks'));
    const omittedMtiState = stateWithInclude(
      includeFor(contract, 'Project', 'tasks', {
        ...emptyState(),
        selectedFields: ['id', 'title'],
      }),
    );
    const selectedMtiState = stateWithInclude(
      includeFor(contract, 'Project', 'tasks', {
        ...emptyState(),
        selectedFields: ['id', 'priority'],
      }),
    );

    const implicitPlan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      implicitState,
      'Project',
    );
    const implicitChildRows = childRowsSelectFor(implicitPlan, 'tasks');

    expect(implicitChildRows.joins).toEqual([
      JoinAst.left(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
    expect(projectionAliases(implicitChildRows)).toEqual([
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
      'assignee_id',
      'features__priority',
      'features__assignee_id',
    ]);

    const omittedMtiPlan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      omittedMtiState,
      'Project',
    );
    const omittedMtiChildRows = childRowsSelectFor(omittedMtiPlan, 'tasks');
    expect(
      projectionAliases(omittedMtiChildRows).filter((alias) => alias.startsWith('features__')),
    ).toEqual([]);

    const selectedMtiPlan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      selectedMtiState,
      'Project',
    );
    const selectedMtiAliases = projectionAliases(childRowsSelectFor(selectedMtiPlan, 'tasks'));
    expect(selectedMtiAliases.filter((alias) => alias.startsWith('features__'))).toEqual([
      'features__priority',
    ]);
    expect(selectedMtiAliases).not.toContain('priority');
  });

  it('variant-narrowed MTI-target include inner-joins only the named variant', () => {
    const contract = buildMixedPolyContract();
    const include = includeFor(contract, 'Project', 'tasks', {
      ...emptyState(),
      variantName: 'Feature',
    });
    const state = stateWithInclude(include);

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'projects_tbl',
      state,
      'Project',
    );
    const childRows = childRowsSelectFor(plan, 'tasks');

    expect(childRows.joins).toEqual([
      JoinAst.inner(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
    expect(projectionAliases(childRows)).toContain('features__priority');
  });

  it('self-relation poly include remaps the variant join ON to the child alias', () => {
    const contract = buildMixedPolyContract();
    // `subtasks` is a Task→Task self relation; the child base table is
    // aliased, so the variant join ON must reference the alias rather
    // than the unaliased base table name.
    const state = stateWithInclude(includeFor(contract, 'Task', 'subtasks'));

    const plan = compileSelectWithIncludes(
      contract,
      getTestAggregates(),
      'public',
      'tasks',
      state,
      'Task',
    );
    const childRows = childRowsSelectFor(plan, 'subtasks');

    expect(childRows.joins).toEqual([
      JoinAst.left(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('subtasks__child', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
  });
});

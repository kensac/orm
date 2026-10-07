import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  buildOrmPlanMeta,
  buildOrmQueryPlan,
  deriveParamsFromAst,
  resolveModelColumns,
  resolveTableColumns,
} from '../src/query-plan-meta';
import { baseContract } from './collection-fixtures';
import { buildMixedPolyContract, buildUnexposedColumnContract } from './helpers';
import { unboundTables } from './unbound-tables';

describe('query plan meta', () => {
  it('resolves table columns and rejects unknown tables', () => {
    expect(resolveTableColumns(baseContract, 'public', 'users')).toEqual(
      Object.keys(unboundTables(baseContract.storage)['users']!.columns),
    );
    expect(() => resolveTableColumns(baseContract, 'public', 'missing')).toThrow(
      'Unknown table "missing" in SQL ORM query planner',
    );
  });

  describe('resolveModelColumns', () => {
    const unexposedContract = buildUnexposedColumnContract();

    it('leaves out a column no field maps, in table order', () => {
      expect({
        table: resolveTableColumns(unexposedContract, 'public', 'user'),
        model: resolveModelColumns(unexposedContract, 'public', 'User', 'user'),
      }).toEqual({
        table: ['id', 'legacy_key', 'email'],
        model: ['id', 'email'],
      });
    });

    it("carries a base model's single-table variant columns and each multi-table variant's inherited key", () => {
      const contract = buildMixedPolyContract();
      expect({
        baseTable: resolveModelColumns(contract, 'public', 'Task', 'tasks'),
        variantTableFromBase: resolveModelColumns(contract, 'public', 'Task', 'features'),
        variantTableFromVariant: resolveModelColumns(contract, 'public', 'Feature', 'features'),
        otherModelsTable: resolveModelColumns(contract, 'public', 'Project', 'tasks'),
      }).toEqual({
        baseTable: ['id', 'title', 'type', 'severity', 'project_id', 'parent_id', 'assignee_id'],
        variantTableFromBase: ['id', 'priority', 'assignee_id'],
        variantTableFromVariant: ['id', 'priority', 'assignee_id'],
        otherModelsTable: [],
      });
    });
  });

  it('includes profileHash in plan meta and carries no sidecars', () => {
    expect(buildOrmPlanMeta(baseContract)).toEqual({
      target: baseContract.target,
      targetFamily: baseContract.targetFamily,
      storageHash: baseContract.storage.storageHash,
      profileHash: baseContract.profileHash,
      lane: 'orm-client',
    });
  });

  it('omits profileHash from plan meta when the contract carries none', () => {
    const { profileHash: _omit, ...rest } = baseContract;
    const noProfileContract = rest as typeof baseContract;
    const meta = buildOrmPlanMeta(noProfileContract);
    expect(meta).not.toHaveProperty('profileHash');
    expect(meta).toMatchObject({ lane: 'orm-client' });
  });

  it('produces a plan whose meta carries no execution-metadata sidecars', () => {
    const ast = SelectAst.from(TableSource.named('users'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
        ProjectionItem.of('email', ColumnRef.of('users', 'email'), { codecId: 'pg/text@1' }),
      ])
      .withLimit(5);

    const { params } = deriveParamsFromAst(ast);
    const plan = buildOrmQueryPlan(baseContract, ast, params);

    expect(plan.meta).not.toHaveProperty('paramDescriptors');
    expect(plan.meta).not.toHaveProperty('projectionTypes');
    expect(plan.meta).not.toHaveProperty('refs');
    expect(plan.meta.annotations?.['codecs']).toBeUndefined();
  });

  it('codecIds for projections live on ProjectionItem, not the meta', () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
      ProjectionItem.of('email', ColumnRef.of('users', 'email'), { codecId: 'pg/text@1' }),
    ]);

    const plan = buildOrmQueryPlan(baseContract, ast, []);

    expect(plan.ast.kind).toBe('select');
    if (plan.ast.kind !== 'select') return;
    expect(plan.ast.projection.map((item) => [item.alias, item.codec?.codecId])).toEqual([
      ['id', 'pg/int4@1'],
      ['email', 'pg/text@1'],
    ]);
  });
});

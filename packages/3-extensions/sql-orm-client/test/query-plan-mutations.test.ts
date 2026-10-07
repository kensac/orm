import {
  BinaryExpr,
  ColumnRef,
  type DeleteAst,
  type DoUpdateSetConflictAction,
  ParamRef,
  ParamRef as ParamRefClass,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteCount,
  compileDeleteReturning,
  compileInsertCount,
  compileInsertCountSplit,
  compileInsertReturning,
  compileInsertReturningSplit,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
} from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';
import { assertInsertAst } from './query-plan-mutations-helpers';
import { unboundTables } from './unbound-tables';

function usersColParam(
  contract: ReturnType<typeof getTestContract>,
  column: string,
  value: unknown,
): ParamRef {
  const columns = unboundTables(contract.storage)['users']?.columns as
    | Record<string, { codecId?: string }>
    | undefined;
  const columnMeta = columns?.[column];
  return ParamRef.of(value, {
    name: column,
    codec: { codecId: columnMeta?.codecId ?? 'unknown' },
  });
}

describe('query plan mutations', () => {
  it('compileInsertReturning() batches rows with stable column order and DEFAULT cells', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileInsertReturning(
      contract,
      'public',
      'User',
      'users',
      [
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com', invited_by_id: 10 },
      ],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([
      10,
      'Alice',
      'alice@example.com',
      11,
      'Bob',
      'bob@example.com',
      10,
    ]);
    expect(plan.ast.rows).toHaveLength(2);
    expect(plan.ast.rows[0]).toMatchObject({
      id: usersColParam(contract, 'id', 10),
      name: usersColParam(contract, 'name', 'Alice'),
      email: usersColParam(contract, 'email', 'alice@example.com'),
    });
    expect(plan.ast.rows[0]?.['invited_by_id']?.kind).toBe('default-value');
    expect(plan.ast.rows[1]).toMatchObject({
      id: usersColParam(contract, 'id', 11),
      name: usersColParam(contract, 'name', 'Bob'),
      email: usersColParam(contract, 'email', 'bob@example.com'),
      invited_by_id: usersColParam(contract, 'invited_by_id', 10),
    });
    expect(plan.ast.returning?.map((item) => item.alias)).toEqual([
      'address',
      'email',
      'id',
      'invited_by_id',
      'name',
    ]);
    expect(plan.ast.returning?.every((item) => item.expr.kind === 'column-ref')).toBe(true);
  });

  it('compileInsertCount() keeps explicit empty rows for all-default batch inserts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(contract, 'public', 'users', [{}, {}]);

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([]);
    expect(plan.ast.rows).toEqual([{}, {}]);
  });

  it('compileInsertCount() attaches a targetless DO NOTHING clause when asked to skip conflicts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(
      contract,
      'public',
      'users',
      [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
      { columns: [] },
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.columns).toEqual([]);
    expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
  });

  it('compileInsertCount() targets the named columns when asked to skip conflicts on them', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(
      contract,
      'public',
      'users',
      [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
      { columns: ['email'] },
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
  });

  it('compileInsertCount() leaves the clause off when not asked to skip conflicts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(contract, 'public', 'users', [
      { id: 10, name: 'Alice', email: 'alice@example.com' },
    ]);

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict).toBeUndefined();
  });

  it('compileInsertReturning() attaches the skip clause alongside RETURNING', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileInsertReturning(
      contract,
      'public',
      'User',
      'users',
      [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
      ['id'],
      { columns: ['email'] },
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
    expect(plan.ast.returning).toHaveLength(1);
  });

  it('compileInsertCountSplit() puts the skip clause on every group statement', () => {
    const contract = getTestContract();
    const plans = compileInsertCountSplit(
      contract,
      'public',
      'users',
      [
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com', invited_by_id: 10 },
      ],
      { columns: [] },
    );

    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      assertInsertAst(plan.ast);
      expect(plan.ast.onConflict?.columns).toEqual([]);
      expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
    }
  });

  it('compileInsertReturningSplit() puts the skip clause on every group statement', () => {
    const contract = withReturningCapability(getTestContract());
    const plans = compileInsertReturningSplit(
      contract,
      'public',
      'User',
      'users',
      [
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com', invited_by_id: 10 },
      ],
      ['id'],
      { columns: ['email'] },
    );

    expect(plans).toHaveLength(2);
    for (const plan of plans) {
      assertInsertAst(plan.ast);
      expect(plan.ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    }
  });

  it('compileUpsertReturning() uses DO NOTHING and default returning columns when update is empty', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileUpsertReturning(
      contract,
      'public',
      'User',
      'users',
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      {},
      ['email'],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.action?.kind).toBe('do-nothing');
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com']);
    expect(plan.ast.returning?.map((item) => item.alias)).toEqual(
      Object.keys(unboundTables(contract.storage)['users']!.columns),
    );
  });

  it('compileInsertReturning() rejects empty rows array', () => {
    const contract = withReturningCapability(getTestContract());

    expect(() =>
      compileInsertReturning(contract, 'public', 'User', 'users', [], undefined),
    ).toThrow('at least one row');
  });

  it('compileInsertCount() rejects empty rows array', () => {
    const contract = getTestContract();

    expect(() => compileInsertCount(contract, 'public', 'users', [])).toThrow('at least one row');
  });

  it('compileUpsertReturning() produces DoUpdateSetConflictAction with correct params when update is non-empty', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileUpsertReturning(
      contract,
      'public',
      'User',
      'users',
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      { name: 'Updated Alice' },
      ['email'],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.action?.kind).toBe('do-update-set');
    const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
    expect(action.set).toEqual({
      name: usersColParam(contract, 'name', 'Updated Alice'),
    });
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com', 'Updated Alice']);
  });

  it('compileUpdateCount() and compileDeleteCount() omit WHERE when filters are empty', () => {
    const contract = getTestContract();

    const updatePlan = compileUpdateCount(contract, 'public', 'users', { name: 'Alice' }, []);
    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where).toBeUndefined();
    expect(updatePlan.params).toEqual(['Alice']);

    const deletePlan = compileDeleteCount(contract, 'public', 'users', []);
    expect(deletePlan.ast.kind).toBe('delete');
    expect((deletePlan.ast as DeleteAst).where).toBeUndefined();
    expect(deletePlan.params).toEqual([]);
  });

  describe('UPDATE / DELETE WHERE preservation', () => {
    function eqOnUserId(value: number) {
      return BinaryExpr.eq(
        ColumnRef.of('users', 'id'),
        ParamRefClass.of(value, {
          name: 'id',
          codec: { codecId: 'pg/int4@1' },
        }),
      );
    }

    it('compileUpdateReturning() preserves WHERE when filters are present', () => {
      const contract = withReturningCapability(getTestContract());
      const plan = compileUpdateReturning(
        contract,
        'public',
        'User',
        'users',
        { name: 'Alice' },
        [eqOnUserId(7)],
        undefined,
      );
      expect(plan.ast.kind).toBe('update');
      expect((plan.ast as UpdateAst).where).toBeDefined();
      expect(plan.params).toEqual(['Alice', 7]);
    });

    it('compileUpdateCount() preserves WHERE when filters are present', () => {
      const contract = getTestContract();
      const plan = compileUpdateCount(contract, 'public', 'users', { name: 'Bob' }, [
        eqOnUserId(9),
      ]);
      expect((plan.ast as UpdateAst).where).toBeDefined();
      expect(plan.params).toEqual(['Bob', 9]);
    });

    it('compileDeleteReturning() preserves WHERE when filters are present and omits when empty', () => {
      const contract = withReturningCapability(getTestContract());
      const planWithWhere = compileDeleteReturning(
        contract,
        'public',
        'User',
        'users',
        [eqOnUserId(3)],
        undefined,
      );
      expect((planWithWhere.ast as DeleteAst).where).toBeDefined();
      expect(planWithWhere.params).toEqual([3]);

      const planNoWhere = compileDeleteReturning(
        contract,
        'public',
        'User',
        'users',
        [],
        undefined,
      );
      expect((planNoWhere.ast as DeleteAst).where).toBeUndefined();
      expect(planNoWhere.params).toEqual([]);
    });
  });

  describe('table/column resolution errors', () => {
    it('compileUpdateCount() rejects an unknown table', () => {
      const contract = getTestContract();
      expect(() =>
        compileUpdateCount(contract, 'public', 'missing_table', { name: 'X' }, []),
      ).toThrowError(/Unknown table "missing_table"/);
    });

    it('compileUpdateCount() rejects an unknown column for the table', () => {
      const contract = getTestContract();
      expect(() =>
        compileUpdateCount(contract, 'public', 'users', { not_a_real_column: 'X' }, []),
      ).toThrowError(/Unknown column "not_a_real_column" in table "users"/);
    });

    it('compileInsertCount() rejects an unknown table', () => {
      const contract = getTestContract();
      expect(() =>
        compileInsertCount(contract, 'public', 'missing_table', [{ id: 1 }]),
      ).toThrowError(/Unknown table "missing_table"/);
    });

    it('compileInsertCount() rejects an unknown column on an insert row', () => {
      const contract = getTestContract();
      expect(() =>
        compileInsertCount(contract, 'public', 'users', [{ id: 1, not_a_real_column: 'X' }]),
      ).toThrowError(/Unknown column "not_a_real_column" in table "users"/);
    });
  });
});

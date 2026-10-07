import { SqlQueryError, UNIQUE_VIOLATION_SQLSTATE } from '@internal/sql-errors';
import { BinaryExpr, ColumnRef, LiteralExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { executeNestedUpdateMutation } from '../src/mutation-executor';
import { buildManyToManyContract, createMockRuntime, getTestContext } from './helpers';
import { collectLiterals, findJunctionDml } from './mutation-executor-helpers';

describe('mutation-executor', () => {
  it('executeNestedUpdateMutation() routes M:N connect through a junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
      data: {
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    const insert = findJunctionDml(runtime, 'insert', 'parent_child');
    expect(insert.kind).toBe('insert');
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 10,
    ]);
  });

  it('executeNestedUpdateMutation() wraps duplicate M:N connect errors', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    const execute = runtime.execute.bind(runtime);
    vi.spyOn(runtime, 'execute').mockImplementation((plan) => {
      const ast = (plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast?.kind === 'insert' && ast.table?.name === 'parent_child') {
        throw new SqlQueryError(
          'duplicate key value violates unique constraint "parent_child_pkey"',
          {
            sqlState: UNIQUE_VIOLATION_SQLSTATE,
          },
        );
      }
      return execute(plan);
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
        data: {
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(
      /relation "children" violated a unique constraint on junction "parent_child"/,
    );
  });

  it('executeNestedUpdateMutation() passes a NOT NULL junction constraint failure through unwrapped', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    const execute = runtime.execute.bind(runtime);
    vi.spyOn(runtime, 'execute').mockImplementation((plan) => {
      const ast = (plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast?.kind === 'insert' && ast.table?.name === 'parent_child') {
        // Drivers normalize a NOT NULL violation to sqlState 23502, not the
        // unique-violation 23505, so the connect wrap must leave it alone.
        throw new SqlQueryError('NOT NULL constraint failed: parent_child.level', {
          sqlState: '23502',
        });
      }
      return execute(plan);
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
        data: {
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(/NOT NULL constraint failed: parent_child\.level/);
  });

  it('executeNestedUpdateMutation() wraps a normalized unique violation regardless of message', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    const execute = runtime.execute.bind(runtime);
    vi.spyOn(runtime, 'execute').mockImplementation((plan) => {
      const ast = (plan as { ast?: { kind: string; table?: { name: string } } }).ast;
      if (ast?.kind === 'insert' && ast.table?.name === 'parent_child') {
        // Opaque message: recognition rides on the normalized sqlState alone,
        // so a primary-key violation (which drivers map to 23505) still wraps.
        throw new SqlQueryError('constraint violation', { sqlState: UNIQUE_VIOLATION_SQLSTATE });
      }
      return execute(plan);
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
        data: {
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ id: 10 }),
        } as never,
      }),
    ).rejects.toThrow(
      /relation "children" violated a unique constraint on junction "parent_child"/,
    );
  });

  it('executeNestedUpdateMutation() routes M:N disconnect through a junction DELETE', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 10 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'id'), LiteralExpr.of(1))],
      data: {
        children: (children: {
          disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
        }) => children.disconnect([{ id: 10 }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'parent_child');
    expect(del.kind).toBe('delete');
    expect(collectLiterals(del.where).sort()).toEqual([1, 10]);
  });

  it('executeNestedUpdateMutation() rejects conflicting values for shared junction columns on disconnect', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id'],
      childColumns: ['tenant_id'],
      targetColumns: ['tenant_id'],
      localFields: ['tenant_id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 7 }], [{ tenant_id: 8 }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        filters: [BinaryExpr.eq(ColumnRef.of('parents', 'tenant_id'), LiteralExpr.of(7))],
        data: {
          children: (children: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.disconnect([{ tenant_id: 8 }]),
        } as never,
      }),
    ).rejects.toThrow(/conflicting values for junction column "tenant_id"/);

    const deletes = runtime.executions.filter(
      (execution) => (execution.plan as { ast?: { kind?: string } }).ast?.kind === 'delete',
    );
    expect(deletes).toEqual([]);
  });

  it('executeNestedUpdateMutation() emits a single predicate for shared junction columns with equal values', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id'],
      childColumns: ['tenant_id'],
      targetColumns: ['tenant_id'],
      localFields: ['tenant_id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 7 }], [{ tenant_id: 7 }], []]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      filters: [BinaryExpr.eq(ColumnRef.of('parents', 'tenant_id'), LiteralExpr.of(7))],
      data: {
        children: (children: {
          disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
        }) => children.disconnect([{ tenant_id: 7 }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'parent_child');
    expect(collectLiterals(del.where)).toEqual([7]);
  });
});

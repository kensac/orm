import { describe, expect, it } from 'vitest';
import { executeNestedCreateMutation, executeNestedUpdateMutation } from '../src/mutation-executor';
import {
  buildExecutionDefaultJunctionContract,
  buildManyToManyContract,
  buildTestContextFromContract,
  createMockRuntime,
  getTestContext,
  getTestContract,
} from './helpers';
import { findJunctionDml, userIdFilter } from './mutation-executor-helpers';

describe('mutation-executor', () => {
  it('executeNestedCreateMutation() rejects M:N disconnect (update-only)', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: {
            disconnect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.disconnect([{ id: 10 }]),
        } as never,
      }),
    ).rejects.toThrow(/disconnect\(\) is only supported in update\(\) nested mutations/);
  });

  it('executeNestedCreateMutation() rejects M:N create when junction has required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          roles: (roles: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
            roles.create([{ id: 'admin' }]),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `create` on relation `roles`: its junction `user_roles` has required column\(s\) `level`.*Write the `user_roles` junction directly or use the SQL builder\./,
    );
  });

  it('executeNestedCreateMutation() rejects M:N connect when junction has required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        data: {
          id: 1,
          name: 'Alice',
          email: 'alice@example.com',
          roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            roles.connect({ id: 'admin' }),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `connect` on relation `roles`: its junction `user_roles` has required column\(s\) `level`.*Write the `user_roles` junction directly or use the SQL builder\./,
    );
  });

  it('executeNestedCreateMutation() M:N connect applies the execution default to the junction row', async () => {
    // `level` is a NOT NULL junction payload column whose only default is an
    // execution-time onCreate generator (no storage default), authored through
    // the DSL via `field.generated`. The connect path must populate it before
    // the INSERT, mirroring insertJunctionLink.
    const contract = buildExecutionDefaultJunctionContract();
    // The defaults applier closes over the contract the context was created
    // from, so the context must be built from this contract — spreading
    // `{ ...getTestContext(), contract }` would never see the new default.
    const context = buildTestContextFromContract(contract, {
      mutationDefaultGenerators: [{ id: 'test-level', generate: () => 5, stability: 'field' }],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 'admin' }],
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'admin' }],
      [],
    ]);

    await executeNestedCreateMutation({
      context,
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          roles.connect({ id: 'admin' }),
      } as never,
    });

    const insert = findJunctionDml(runtime, 'insert', 'user_roles');
    const junctionRow = (insert.rows as ReadonlyArray<Record<string, unknown>>)[0]!;
    expect(Object.keys(junctionRow).sort()).toEqual(['level', 'role_id', 'user_id']);
    expect((junctionRow['level'] as { value: unknown }).value).toBe(5);
  });

  it('executeNestedUpdateMutation() preflights junction guards before the scalar update', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'alice@example.com' }]]);

    await expect(
      executeNestedUpdateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'User',
        filters: [userIdFilter],
        data: {
          name: 'Alice Updated',
          roles: (roles: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            roles.connect({ id: 'admin' }),
        } as never,
      }),
    ).rejects.toThrow(
      /Cannot `connect` on relation `roles`: its junction `user_roles` has required column\(s\) `level`/,
    );

    const updates = runtime.executions.filter(
      (execution) => (execution.plan as { ast?: { kind?: string } }).ast?.kind === 'update',
    );
    expect(updates).toEqual([]);
  });

  it('executeNestedUpdateMutation() allows disconnect on junction with required payload columns', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'admin' }],
      [],
    ]);

    await executeNestedUpdateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      filters: [userIdFilter],
      data: {
        roles: (roles: { disconnect: (criteria: readonly Record<string, unknown>[]) => unknown }) =>
          roles.disconnect([{ id: 'admin' }]),
      } as never,
    });

    const del = findJunctionDml(runtime, 'delete', 'user_roles');
    expect(del.kind).toBe('delete');
  });

  it('executeNestedCreateMutation() allows M:N create on pure junction (no required payload)', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1, name: 'Alice', email: 'alice@example.com' }],
      [{ id: 'ts' }],
      [],
    ]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'User',
      data: {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        tags: (tags: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          tags.create([{ id: 'ts' }]),
      } as never,
    });

    expect(created).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com' });
    const insert = findJunctionDml(runtime, 'insert', 'user_tags');
    expect(insert.kind).toBe('insert');
  });
});

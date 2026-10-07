import { describe, expect, it } from 'vitest';
import {
  assertJunctionParentMetadataLength,
  assertJunctionTargetMetadataLength,
  executeNestedCreateMutation,
  type JunctionRelationDefinition,
} from '../src/mutation-executor';
import {
  buildManyToManyContract,
  buildManyToManyContractWithTargetRelation,
  createMockRuntime,
  getTestContext,
} from './helpers';
import { findJunctionDml } from './mutation-executor-helpers';

describe('mutation-executor', () => {
  it('executeNestedCreateMutation() routes M:N connect through a junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 10 }], [{ id: 1 }], [{ id: 10 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const insert = findJunctionDml(runtime, 'insert', 'parent_child');
    const junctionRow = (insert.rows as ReadonlyArray<Record<string, unknown>>)[0]!;
    expect(Object.keys(junctionRow).sort()).toEqual(['child_id', 'parent_id']);
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 10,
    ]);
  });

  it('executeNestedCreateMutation() routes M:N create through target INSERT then junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 20 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          children.create([{ id: 20 }]),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const targetInsert = findJunctionDml(runtime, 'insert', 'children');
    expect(targetInsert.kind).toBe('insert');
    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(Object.keys(link).sort()).toEqual(['child_id', 'parent_id']);
    expect((runtime.executions.at(-1)!.plan as { params: readonly unknown[] }).params).toEqual([
      1, 20,
    ]);
  });

  it('executeNestedCreateMutation() recurses junction-created targets through the nested-create graph', async () => {
    const contract = buildManyToManyContractWithTargetRelation();
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], [{ id: 99 }], [{ id: 20, owner_id: 99 }], []]);

    const created = await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        id: 1,
        children: (children: { create: (rows: readonly Record<string, unknown>[]) => unknown }) =>
          children.create([
            {
              id: 20,
              owner: (owner: { connect: (criterion: Record<string, unknown>) => unknown }) =>
                owner.connect({ id: 99 }),
            },
          ]),
      } as never,
    });

    expect(created).toEqual({ id: 1 });
    const unwrapRow = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([column, param]) => [column, (param as { value: unknown }).value]),
      );
    const childInsert = findJunctionDml(runtime, 'insert', 'children');
    expect(unwrapRow((childInsert.rows as ReadonlyArray<Record<string, unknown>>)[0]!)).toEqual({
      id: 20,
      owner_id: 99,
    });
    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(unwrapRow(link)).toEqual({ parent_id: 1, child_id: 20 });
  });

  it('executeNestedCreateMutation() AND-s composite keys in the junction INSERT', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
      localFields: ['tenant_id', 'id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ tenant_id: 7, id: 10 }],
      [{ tenant_id: 7, id: 1 }],
      [{ tenant_id: 7, id: 10 }],
      [],
    ]);

    await executeNestedCreateMutation({
      context: { ...getTestContext(), contract },
      runtime,
      namespaceId: 'public',
      modelName: 'Parent',
      data: {
        tenant_id: 7,
        id: 1,
        children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
          children.connect({ id: 10 }),
      } as never,
    });

    const link = (
      findJunctionDml(runtime, 'insert', 'parent_child').rows as ReadonlyArray<
        Record<string, unknown>
      >
    )[0]!;
    expect(Object.keys(link).sort()).toEqual(['child_id', 'parent_id', 'tenant_id']);
  });

  // Mismatched junction column counts can't be authored — the contract-builder
  // rejects an M:N relation whose junction FK pairing is uneven before a
  // contract ever exists. These two cases exercise the defensive length guards
  // directly with a typed JunctionRelationDefinition (a guard input, not a
  // contract).
  function junctionRelationDefinition(
    through: Pick<JunctionRelationDefinition['through'], 'parentColumns' | 'childColumns'> & {
      readonly targetColumns: readonly string[];
    },
    columns: {
      readonly localColumns: readonly string[];
      readonly targetColumns: readonly string[];
    },
  ): JunctionRelationDefinition {
    return {
      relationName: 'children',
      relatedModelName: 'Child',
      relatedNamespaceId: 'public',
      relatedTableName: 'children',
      cardinality: 'N:M',
      localColumns: columns.localColumns,
      targetColumns: columns.targetColumns,
      through: {
        table: 'parent_child',
        namespaceId: 'public',
        parentColumns: through.parentColumns,
        childColumns: through.childColumns,
        targetColumns: through.targetColumns,
        requiredPayloadColumns: [],
      },
    };
  }

  it('assertJunctionParentMetadataLength() rejects mismatched junction parent-column metadata', () => {
    const relation = junctionRelationDefinition(
      {
        parentColumns: ['parent_id', 'tenant_id'],
        childColumns: ['child_id'],
        targetColumns: ['id'],
      },
      { localColumns: ['id'], targetColumns: ['id'] },
    );

    expect(() => assertJunctionParentMetadataLength(relation)).toThrow(
      /parentColumns.*localColumns/,
    );
  });

  it('assertJunctionTargetMetadataLength() rejects mismatched junction target-column metadata', () => {
    const relation = junctionRelationDefinition(
      {
        parentColumns: ['parent_id'],
        childColumns: ['child_id', 'tenant_id'],
        targetColumns: ['id'],
      },
      { localColumns: ['id'], targetColumns: ['id'] },
    );

    expect(() => assertJunctionTargetMetadataLength(relation)).toThrow(
      /childColumns.*targetColumns/,
    );
  });

  it('executeNestedCreateMutation() rejects duplicate resolved connect targets before any write', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 10 }], [{ id: 10 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          id: 1,
          children: (children: {
            connect: (criteria: readonly Record<string, unknown>[]) => unknown;
          }) => children.connect([{ id: 10 }, { id: 10 }]),
        } as never,
      }),
    ).rejects.toThrow(
      /connect\(\) nested mutation for relation "children" resolved duplicate junction link targets/,
    );

    const inserts = runtime.executions.filter(
      (execution) => (execution.plan as { ast?: { kind?: string } }).ast?.kind === 'insert',
    );
    expect(inserts).toEqual([]);
  });

  it('executeNestedCreateMutation() rejects conflicting values for shared junction columns', async () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id'],
      childColumns: ['tenant_id'],
      targetColumns: ['tenant_id'],
      localFields: ['tenant_id'],
    });
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ tenant_id: 8 }], [{ tenant_id: 7 }], [{ tenant_id: 8 }]]);

    await expect(
      executeNestedCreateMutation({
        context: { ...getTestContext(), contract },
        runtime,
        namespaceId: 'public',
        modelName: 'Parent',
        data: {
          tenant_id: 7,
          children: (children: { connect: (criterion: Record<string, unknown>) => unknown }) =>
            children.connect({ tenant_id: 8 }),
        } as never,
      }),
    ).rejects.toThrow(/conflicting values for junction column "tenant_id"/);
  });
});

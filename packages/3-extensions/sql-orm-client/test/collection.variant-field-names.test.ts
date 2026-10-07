import { ColumnRef, OrderByItem } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { buildMixedPolyContract, createMockRuntime, getTestContext } from './helpers';

function tasks() {
  const context = { ...getTestContext(), contract: buildMixedPolyContract() };
  return new Collection({ runtime: createMockRuntime(), context }, 'Task', {
    namespaceId: 'public',
  });
}

const unknownField = (field: string) =>
  expect.objectContaining({ code: 'ORM.FIELD_UNKNOWN', meta: { model: 'Task', field } });

describe('names a variant field outside select', () => {
  it('select on the base collection accepts a multi-table variant field', () => {
    expect(() => tasks().select('id', 'priority' as never)).not.toThrow();
  });

  it('groupBy refuses a multi-table variant field, which is not on the base table', () => {
    expect(() => tasks().groupBy('priority' as never)).toThrow(unknownField('priority'));
  });

  it('distinct refuses a multi-table variant field', () => {
    expect(() => tasks().distinct('priority' as never)).toThrow(unknownField('priority'));
  });

  it('distinctOn refuses a multi-table variant field', () => {
    expect(() =>
      tasks()
        .orderBy(() => OrderByItem.asc(ColumnRef.of('tasks', 'id')))
        .distinctOn('priority' as never),
    ).toThrow(unknownField('priority'));
  });

  it('cursor refuses a multi-table variant field', () => {
    expect(() =>
      tasks()
        .orderBy(() => OrderByItem.asc(ColumnRef.of('tasks', 'id')))
        .cursor({ priority: 1 } as never),
    ).toThrow(unknownField('priority'));
  });
});

import { describe, expect, it } from 'vitest';
import { mapCursorValuesToColumns, mapFieldsToColumns } from '../src/collection-column-mapping';
import { resolveFieldToColumn } from '../src/collection-contract';
import { buildMixedPolyContract, getTestContract } from './helpers';

const unknownField = (model: string, field: string) =>
  expect.objectContaining({
    code: 'ORM.FIELD_UNKNOWN',
    message: `Model "${model}" has no field "${field}"`,
    meta: { model, field },
  });

describe('collection-column-mapping', () => {
  const contract = getTestContract();

  it('resolveFieldToColumn() resolves known fields and refuses a name that is not a field', () => {
    expect(resolveFieldToColumn(contract, 'public', 'Post', 'userId')).toBe('user_id');
    expect(() => resolveFieldToColumn(contract, 'public', 'Post', 'user_id')).toThrow(
      unknownField('Post', 'user_id'),
    );
    expect(() => resolveFieldToColumn(contract, 'public', 'Post', 'constructor')).toThrow(
      unknownField('Post', 'constructor'),
    );
  });

  it('resolveFieldToColumn() refuses any name on a model the contract does not declare', () => {
    expect(() => resolveFieldToColumn(contract, 'public', 'UnknownModel', 'id')).toThrow(
      unknownField('UnknownModel', 'id'),
    );
  });

  it('resolveFieldToColumn() resolves a field a variant inherits from its base model', () => {
    expect(resolveFieldToColumn(buildMixedPolyContract(), 'public', 'Feature', 'title')).toBe(
      'title',
    );
  });

  it('mapFieldsToColumns() maps field names to columns and refuses a column name', () => {
    expect(
      mapFieldsToColumns(contract, 'public', 'Post', undefined, ['id', 'userId', 'views']),
    ).toEqual(['id', 'user_id', 'views']);
    expect(() =>
      mapFieldsToColumns(contract, 'public', 'Post', undefined, ['id', 'user_id']),
    ).toThrow(unknownField('Post', 'user_id'));
  });

  it("mapFieldsToColumns() accepts a narrowed variant's fields, or every variant's when not narrowed", () => {
    const poly = buildMixedPolyContract();
    expect({
      narrowed: mapFieldsToColumns(poly, 'public', 'Task', 'Bug', ['id', 'assigneeId']),
      unnarrowed: mapFieldsToColumns(poly, 'public', 'Task', undefined, ['severity', 'priority']),
    }).toEqual({ narrowed: ['id', 'assignee_id'], unnarrowed: ['severity', 'priority'] });
    expect(() => mapFieldsToColumns(poly, 'public', 'Task', 'Bug', ['priority'])).toThrow(
      unknownField('Task', 'priority'),
    );
  });

  it('mapCursorValuesToColumns() skips undefined values and maps field names to columns', () => {
    expect(
      mapCursorValuesToColumns(contract, 'public', 'Post', undefined, {
        id: 1,
        userId: 2,
        views: undefined,
      }),
    ).toEqual({
      id: 1,
      user_id: 2,
    });
  });

  it('mapCursorValuesToColumns() refuses a name that is not a field', () => {
    expect(() =>
      mapCursorValuesToColumns(contract, 'public', 'Post', undefined, { user_id: 2 }),
    ).toThrow(unknownField('Post', 'user_id'));
  });
});

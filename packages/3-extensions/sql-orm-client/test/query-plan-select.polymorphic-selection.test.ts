import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { compileSelect } from '../src/query-plan-select';
import { emptyState } from '../src/types';
import { buildMixedPolyContract } from './helpers';

describe('polymorphic selection', () => {
  it('treats a selected column that belongs to no table of the hierarchy as an internal error', () => {
    expect(() =>
      compileSelect(
        buildMixedPolyContract(),
        'public',
        'tasks',
        { ...emptyState(), selectedFields: ['id', 'legacy_key'] },
        'Task',
      ),
    ).toThrow(InternalError);
  });
});

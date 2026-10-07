import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { describe, expect, it } from 'vitest';
import {
  CreateIndexCall,
  DropIndexCall,
  RenameTableCall,
} from '../../src/core/migrations/op-factory-call';
import { renderOps } from '../../src/core/migrations/render-ops';

describe('renderOps with a call that produces several ops', () => {
  it('renders the call and each of its companions, in order, with the same lowerer', async () => {
    const received: unknown[] = [];
    const lowerer: ExecuteRequestLowerer = {
      lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
      lowerToExecuteRequest: async (ast) => {
        received.push(ast);
        return Object.freeze({ sql: 'LOWERED', params: Object.freeze([]) });
      },
      renderColumnDefault: async () => '',
    };
    const call = new RenameTableCall('a', 'b', [
      {
        drop: new DropIndexCall('b', 'a_handle_idx'),
        create: new CreateIndexCall('b', 'b_handle_idx', ['handle']),
      },
    ]);

    const result = await Promise.all(renderOps([call], lowerer));

    expect(result.map((rendered) => rendered.label)).toEqual([
      'Rename table a to b',
      'Drop index a_handle_idx on b',
      'Create index b_handle_idx on b',
    ]);
    expect(received.length).toBeGreaterThan(0);
  });
});

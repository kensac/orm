import { describe, expect, it } from 'vitest';
import { compileInsertCountSplit, compileInsertReturningSplit } from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';
import { assertInsertAst } from './query-plan-mutations-helpers';

describe('query plan mutations', () => {
  describe('compileInsertReturningSplit()', () => {
    it('produces a single plan when all rows have the same columns', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'User',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
    });

    it('splits rows with different column sets into separate plans', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'User',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
        ],
        undefined,
      );
      expect(plans).toHaveLength(2);
      assertInsertAst(plans[0]!.ast);
      assertInsertAst(plans[1]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(1);
      expect(plans[1]!.ast.rows).toHaveLength(1);
    });

    it('preserves input order: non-adjacent rows with same signature produce separate groups', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'User',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
          { id: 3, name: 'Charlie', email: 'c@c.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(3);
    });

    it('groups adjacent rows with identical columns together', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'User',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com' },
          { id: 3, name: 'Charlie', email: 'c@c.com', invited_by_id: 1 },
          { id: 4, name: 'Diana', email: 'd@d.com', invited_by_id: 2 },
        ],
        undefined,
      );
      expect(plans).toHaveLength(2);
      assertInsertAst(plans[0]!.ast);
      assertInsertAst(plans[1]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
      expect(plans[1]!.ast.rows).toHaveLength(2);
    });

    it('treats undefined values as absent columns', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'User',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com', invited_by_id: undefined },
          { id: 2, name: 'Bob', email: 'b@b.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
    });

    it('handles a single row', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'User',
        'users',
        [{ id: 1, name: 'Alice', email: 'a@a.com' }],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(1);
    });
  });

  describe('compileInsertCountSplit()', () => {
    it('produces a single plan when all rows have the same columns', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'public', 'users', [
        { id: 1, name: 'Alice', email: 'a@a.com' },
        { id: 2, name: 'Bob', email: 'b@b.com' },
      ]);
      expect(plans).toHaveLength(1);
    });

    it('splits rows with different column sets', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'public', 'users', [
        { id: 1, name: 'Alice', email: 'a@a.com' },
        { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
      ]);
      expect(plans).toHaveLength(2);
    });

    it('preserves input order over minimizing group count', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'public', 'users', [
        { id: 1, name: 'A', email: 'a@a.com' },
        { id: 2, name: 'B', email: 'b@b.com', invited_by_id: 1 },
        { id: 3, name: 'C', email: 'c@c.com' },
      ]);
      expect(plans).toHaveLength(3);
    });
  });

  describe('split helpers reject empty rows', () => {
    it('compileInsertReturningSplit() rejects an empty rows array', () => {
      const contract = withReturningCapability(getTestContract());
      expect(() =>
        compileInsertReturningSplit(contract, 'public', 'User', 'users', [], undefined),
      ).toThrowError(/at least one row/);
    });

    it('compileInsertCountSplit() rejects an empty rows array', () => {
      const contract = getTestContract();
      expect(() => compileInsertCountSplit(contract, 'public', 'users', [])).toThrowError(
        /at least one row/,
      );
    });
  });
});

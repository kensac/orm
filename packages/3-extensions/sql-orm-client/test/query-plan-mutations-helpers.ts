import type { InsertAst } from '@internal/sql-relational-core/ast';
import { expect } from 'vitest';

export function assertInsertAst(ast: unknown): asserts ast is InsertAst {
  expect((ast as { kind: string }).kind).toBe('insert');
}

import {
  type CodecRef,
  DerivedTableSource,
  type SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@internal/sql-relational-core/codec-descriptor-registry';
import { InternalError } from '@internal/utils/internal-error';
import { expect } from 'vitest';
import { baseContract } from './collection-fixtures';
import { isSelectAst } from './helpers';

export function codecRefFor(table: string, column: string): CodecRef {
  const ref = codecRefForStorageColumn(baseContract.storage, 'public', table, column);
  if (ref === undefined) throw new InternalError(`no codec ref for ${table}.${column}`);
  return ref;
}

export function expectSelectAst(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
}

export function expectSubqueryExpr(expr: unknown): asserts expr is SubqueryExpr {
  expect(expr).toBeInstanceOf(SubqueryExpr);
}

export function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeInstanceOf(DerivedTableSource);
}

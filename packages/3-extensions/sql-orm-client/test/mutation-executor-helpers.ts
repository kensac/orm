import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
} from '@internal/sql-relational-core/ast';
import type { MockRuntime } from './helpers';

export function findJunctionDml(
  runtime: MockRuntime,
  kind: 'insert' | 'delete',
  table: string,
): { kind: string; table: { name: string }; rows?: unknown; where?: unknown } {
  for (const execution of runtime.executions) {
    const ast = (execution.plan as { ast?: { kind: string; table?: { name: string } } }).ast;
    if (ast && ast.kind === kind && ast.table?.name === table) {
      return ast as { kind: string; table: { name: string }; rows?: unknown; where?: unknown };
    }
  }
  throw new Error(`no ${kind} on "${table}" found in executions`);
}

export function collectLiterals(node: unknown): unknown[] {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const expr = node as {
    kind?: string;
    value?: unknown;
    left?: unknown;
    right?: unknown;
    exprs?: readonly unknown[];
  };
  if (expr.kind === 'literal') {
    return [expr.value];
  }
  return [
    ...collectLiterals(expr.left),
    ...collectLiterals(expr.right),
    ...(expr.exprs ?? []).flatMap(collectLiterals),
  ];
}

export const userIdFilter: AnyExpression = BinaryExpr.eq(
  ColumnRef.of('users', 'id'),
  LiteralExpr.of(1),
);

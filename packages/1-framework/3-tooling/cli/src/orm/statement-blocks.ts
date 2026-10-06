import type { AppliedStatement } from '@internal/framework-components/control';
import type { Block } from '@prisma/cli-engine';

function operationCountText(count: number): string {
  if (count === 0) return 'no operations';
  return count === 1 ? '1 operation' : `${count} operations`;
}

/**
 * The `Statements applied` tree: one line per statement in the order given,
 * each the family's description of it and the number of operations it
 * produced. Nothing when no statements were given.
 */
export function appliedStatementBlocks(applied: readonly AppliedStatement[]): readonly Block[] {
  if (applied.length === 0) {
    return [];
  }
  return [
    {
      kind: 'tree',
      roots: [
        {
          label: 'Statements applied',
          children: applied.map((entry) => ({
            label: `${entry.description} (${operationCountText(entry.operationCount)})`,
          })),
        },
      ],
    },
  ];
}

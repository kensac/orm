import { expect } from 'vitest';

/**
 * Asserts a planner's `dataLoss` against its own classification: an entry points only at a
 * `destructive` operation, and every `destructive` operation has an entry unless an earlier
 * destructive operation already names what it loses, as a SQLite recreate does for a column a
 * later drop removes again.
 */
export function expectDataLossMatchesDestructive(
  result: { readonly dataLoss: readonly { readonly operationIndex: number }[] },
  operations: readonly { readonly operationClass: string }[],
): void {
  const named = new Set(result.dataLoss.map(({ operationIndex }) => operationIndex));
  const classesNamed = [...named].map((index) => operations[index]?.operationClass);
  expect(classesNamed.every((operationClass) => operationClass === 'destructive')).toBe(true);
  const unnamedDestructive = operations.flatMap(({ operationClass }, index) =>
    operationClass === 'destructive' &&
    !named.has(index) &&
    ![...named].some((namedIndex) => namedIndex < index)
      ? [index]
      : [],
  );
  expect(unnamedDestructive).toEqual([]);
}

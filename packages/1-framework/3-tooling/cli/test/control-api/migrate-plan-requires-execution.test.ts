import type { PerSpacePlan } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import { planRequiresExecution } from '../../src/control-api/operations/migrate';

const HEAD_HASH = 'a'.repeat(64);

function zeroOpPlan(args: {
  readonly origin: string | null;
  readonly destination: string;
}): PerSpacePlan {
  return {
    plan: {
      targetId: 'postgres',
      spaceId: 'app',
      origin: args.origin === null ? null : { storageHash: args.origin },
      destination: { storageHash: args.destination },
      operations: [],
      providedInvariants: [],
    },
    displayOps: [],
    strategy: 'resolve-recorded-path',
    migrationEdges: [],
  } as unknown as PerSpacePlan;
}

describe('planRequiresExecution', () => {
  it('skips the runner when a database with no marker targets the empty contract', () => {
    expect(
      planRequiresExecution(zeroOpPlan({ origin: null, destination: EMPTY_CONTRACT_HASH })),
    ).toBe(false);
  });

  it('skips the runner when the marker already carries the destination', () => {
    expect(planRequiresExecution(zeroOpPlan({ origin: HEAD_HASH, destination: HEAD_HASH }))).toBe(
      false,
    );
  });

  it('still runs a declared-state plan that advances a database with no marker to its head', () => {
    expect(planRequiresExecution(zeroOpPlan({ origin: null, destination: HEAD_HASH }))).toBe(true);
  });

  it('runs any plan that carries operations', () => {
    const plan = zeroOpPlan({ origin: HEAD_HASH, destination: HEAD_HASH });
    const withOps = {
      ...plan,
      plan: {
        ...plan.plan,
        operations: [
          { id: 'relation.users', label: 'Create relation users', operationClass: 'additive' },
        ],
      },
    } as unknown as PerSpacePlan;
    expect(planRequiresExecution(withOps)).toBe(true);
  });
});

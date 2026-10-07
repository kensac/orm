/**
 * A multi-table variant whose table holds only the key it inherits (`Chore`, table `chores`) has no field of its own. It still creates, and reads back through the base model beside a single-table variant.
 */
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/polymorphism-key-only-variant/generated/contract';
import contractJson from './fixtures/polymorphism-key-only-variant/generated/contract.json' with {
  type: 'json',
};
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

function keyOnlyVariantContract(): Contract {
  return new PostgresContractSerializer().deserializeContract(
    JSON.parse(JSON.stringify(contractJson)),
  ) as Contract;
}

function ormFor(runtime: PgIntegrationRuntime, contract: Contract) {
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
  });
  return orm({ runtime, context });
}

describe('integration/polymorphism-key-only-variant', () => {
  it(
    'creates a variant with no field of its own and reads it across variants',
    async () => {
      const contract = keyOnlyVariantContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);

        const chore = await db.public.Task.variant('chore').create({ title: 'Sweep' });
        expect(chore).toEqual({ id: chore.id, title: 'Sweep', type: 'chore' });

        const bug = await db.public.Task.variant('bug').create({
          title: 'Crash',
          severity: 'high',
        });

        const tasks = await db.public.Task.orderBy((task) => task.id.asc()).all();
        expect(tasks).toEqual([
          { id: chore.id, title: 'Sweep', type: 'chore' },
          { id: bug.id, title: 'Crash', type: 'bug', severity: 'high' },
        ]);

        expect(await runtime.query<{ id: number }>('SELECT id FROM chores')).toEqual([
          { id: chore.id },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});

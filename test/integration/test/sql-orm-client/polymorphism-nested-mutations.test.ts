/**
 * Nested mutations that read a polymorphic model: a `connect` to a multi-table variant's row, and an `update` whose filter names a multi-table variant's field.
 */
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/polymorphism/generated/contract';
import contractJson from './fixtures/polymorphism/generated/contract.json' with { type: 'json' };
import { timeouts, withPushedContractRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

function polymorphismContract(): Contract {
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

async function seedFeature(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query("INSERT INTO people (id, name) VALUES (1, 'Ada')");
  await runtime.query("INSERT INTO tasks (id, title, type) VALUES (3, 'Dark mode', 'feature')");
  await runtime.query('INSERT INTO features (id, priority) VALUES (3, 1)');
}

describe('integration/polymorphism-nested-mutations', () => {
  it(
    'connects a new row to a multi-table variant row',
    async () => {
      const contract = polymorphismContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);
        await seedFeature(runtime);

        const comment = await db.public.TaskComment.create({
          body: 'Ship it',
          task: (task) => task.connect({ id: 3 }),
        });

        expect(comment).toEqual({ id: expect.any(Number), body: 'Ship it', taskId: 3 });
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'updates a multi-table variant row found by its own field and connects a relation',
    async () => {
      const contract = polymorphismContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);
        await seedFeature(runtime);

        const updated = await db.public.Task.variant('feature')
          .where((task) => task.priority.eq(1))
          .update({ reporter: (reporter) => reporter.connect({ id: 1 }) });

        expect(updated).toEqual({
          id: 3,
          title: 'Dark mode',
          type: 'feature',
          projectId: null,
          reporterId: 1,
          priority: 1,
          assigneeId: null,
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

/**
 * A relation whose target is a single-table variant (`Person.bugs` targets `Bug`) reads and creates rows that carry the fields the variant inherits from its base model, not only its own.
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

describe('integration/polymorphism-variant-relation-target', () => {
  it(
    'includes the rows of a relation to a single-table variant with their inherited fields',
    async () => {
      const contract = polymorphismContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);
        await runtime.query("INSERT INTO people (id, name) VALUES (1, 'Ada')");
        await runtime.query(
          "INSERT INTO tasks (id, title, type, severity, bug_assignee_person_id) VALUES (10, 'Crash', 'bug', 'high', 1)",
        );

        const people = await db.public.Person.include('bugs').all();

        expect(people).toEqual([
          {
            id: 1,
            name: 'Ada',
            bugs: [
              {
                id: 10,
                title: 'Crash',
                type: 'bug',
                projectId: null,
                reporterId: null,
                severity: 'high',
                assigneeId: 1,
              },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'creates a row through a relation to a single-table variant and returns it with its key',
    async () => {
      const contract = polymorphismContract();
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = ormFor(runtime, contract);

        const person = await db.public.Person.include('bugs').create({
          name: 'Ada',
          bugs: (bugs) => bugs.create([{ title: 'Crash', type: 'bug', severity: 'high' }]),
        });

        expect(person).toEqual({
          id: expect.any(Number),
          name: 'Ada',
          bugs: [
            {
              id: expect.any(Number),
              title: 'Crash',
              type: 'bug',
              projectId: null,
              reporterId: null,
              severity: 'high',
              assigneeId: person.id,
            },
          ],
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});

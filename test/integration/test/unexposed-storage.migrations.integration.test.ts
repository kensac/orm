/**
 * Storage the domain does not expose is storage like any other for migrations and verify: `db init` creates it, strict verify treats it as declared, and a change of exposure alone plans nothing, while adding the column plans it.
 */
import postgresAdapterControl from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriverControl from '@internal/driver-postgres/control';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import postgresTargetControl from '@internal/target-postgres/control';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import {
  runSchemaVerify,
  timeouts,
  useDevDatabase,
  withDriver,
} from './family.schema-verify.helpers';
import {
  buildUnexposedStorageContract,
  contract as unexposedContract,
} from './sql-orm-client/fixtures/unexposed-storage/contract';

const controlStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresTargetControl,
  adapter: postgresAdapterControl,
  driver: postgresDriverControl,
  extensions: [],
});
const controlFamily = sqlFamilyControl.create(controlStack);
const controlAdapter = postgresAdapterControl.create(controlStack);
const frameworkComponents = [
  postgresTargetControl,
  postgresAdapterControl,
  postgresDriverControl,
] as const;
const anyClass: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function plan(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  fromContract: Contract<SqlStorage> | null,
  policy: MigrationOperationPolicy,
) {
  const result = postgresTargetControl.createPlanner(controlAdapter).plan({
    contract,
    schema,
    policy,
    fromContract,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result));
  return result.plan;
}

async function plannedOperationIds(
  from: Contract<SqlStorage>,
  to: Contract<SqlStorage>,
): Promise<readonly string[]> {
  const schema = postgresTargetControl.migrations.contractToSchema(
    from,
    frameworkComponents,
  ) as SqlSchemaIRNode;
  const operations = await Promise.all(plan(to, schema, from, anyClass).operations);
  return operations.map((operation) => operation.id);
}

async function dbInit(connectionString: string, contract: Contract<SqlStorage>): Promise<void> {
  await withDriver(connectionString, async (driver) => {
    const schema = await controlFamily.introspect({ driver, contract });
    const migrationPlan = plan(contract, schema, null, INIT_ADDITIVE_POLICY);
    const result = await postgresTargetControl.createRunner(controlFamily).execute({
      driver,
      perSpaceOptions: [
        {
          space: migrationPlan.spaceId ?? APP_SPACE_ID,
          plan: migrationPlan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: migrationPlan.origin?.storageHash,
              destinationStorageHash: migrationPlan.destination.storageHash,
              operationCount: migrationPlan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
  });
}

describe('storage the domain does not expose, under migrations and verify', () => {
  const { getConnectionString } = useDevDatabase();

  it(
    'creates it with db init, verifies strictly, and reports it missing once dropped',
    async () => {
      const serialized = new PostgresContractSerializer().serializeContract(unexposedContract);
      await dbInit(getConnectionString(), unexposedContract);

      const strict = await runSchemaVerify(getConnectionString(), serialized, { strict: true });
      expect(strict).toMatchObject({ ok: true, schema: { issues: [] } });

      await withDriver(getConnectionString(), (driver) =>
        driver.query('ALTER TABLE "user" DROP COLUMN legacy_key'),
      );
      const dropped = await runSchemaVerify(getConnectionString(), serialized, { strict: true });
      expect(dropped.ok).toBe(false);
      expect(dropped.schema.issues.map((issue) => issue.path)).toEqual([
        ['database', 'public', 'user', 'column:legacy_key'],
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it('plans nothing when only the exposure changes, and ADD COLUMN when the column is new', async () => {
    const absent = buildUnexposedStorageContract('absent');
    const exposed = buildUnexposedStorageContract('exposed');
    const unexposed = buildUnexposedStorageContract('unexposed');

    expect(unexposed.storage.storageHash).toBe(exposed.storage.storageHash);
    expect(await plannedOperationIds(exposed, unexposed)).toEqual([]);
    expect(await plannedOperationIds(unexposed, exposed)).toEqual([]);
    expect(await plannedOperationIds(absent, unexposed)).toEqual(['column.public.user.legacy_key']);
  });
});

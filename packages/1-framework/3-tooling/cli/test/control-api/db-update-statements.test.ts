import { rmSync } from 'node:fs';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  ResolvedStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import { createTestProjectDir } from '../utils/test-project-dir';

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);

function contractWithModels(storageHash: string, models: readonly string[]): Contract {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storage: { storageHash, tables: {}, namespaces: {} },
    domain: {
      namespaces: {
        app: {
          models: Object.fromEntries(
            models.map((model) => [model, { fields: {}, relations: {}, storage: {} }]),
          ),
        },
      },
    },
  } as unknown as Contract;
}

const origin = contractWithModels(ORIGIN_HASH, ['Profile']);
const destination = contractWithModels(DESTINATION_HASH, ['User']);

function markerAt(storageHash: string): ContractMarkerRecord {
  return {
    storageHash,
    profileHash: '',
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(0),
    appTag: null,
    meta: {},
    invariants: [],
  };
}

const driver = {
  close: vi.fn(),
  databaseName: async () => 'appdb',
} as unknown as ControlDriverInstance<'sql', 'postgres'>;

function familyWithMarker(marker: ContractMarkerRecord | undefined) {
  return {
    familyId: 'sql',
    readAllMarkers: async () => (marker === undefined ? new Map() : new Map([['app', marker]])),
    introspect: async () => ({ tables: {} }),
    deserializeContract: (json: unknown) => json as Contract,
    toOperationPreview: () => ({ statements: [] }),
  } as unknown as ControlFamilyInstance<'sql', unknown>;
}

interface PlannerCall {
  readonly fromContract: unknown;
  readonly statements: readonly ResolvedStatement[];
}

function recordingMigrations(operationClass: 'additive' | 'destructive' = 'additive') {
  const calls: PlannerCall[] = [];
  const migrations = {
    createPlanner: () => ({
      plan: (options: PlannerCall): MigrationPlannerResult => {
        calls.push({ fromContract: options.fromContract, statements: options.statements });
        const renamed = options.statements.length > 0;
        return {
          kind: 'success',
          appliedStatements: options.statements.map((statement) => ({
            statement,
            description: 'rename model "Profile" to "User"',
            operationCount: 1,
          })),
          plan: {
            targetId: 'postgres',
            destination: { storageHash: DESTINATION_HASH },
            operations: [
              renamed
                ? { id: 'renameTable.Profile', label: 'Rename table', operationClass: 'widening' }
                : { id: 'dropTable.Profile', label: 'Drop table', operationClass },
            ],
            renderTypeScript: () => '',
          },
        };
      },
    }),
    createRunner: () => ({
      execute: vi.fn().mockResolvedValue(
        ok({
          perSpaceResults: [
            { space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } },
          ],
        }),
      ),
    }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  return { migrations, calls };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function migrationsDirWithSnapshot(contract: Contract | undefined): Promise<string> {
  const dir = createTestProjectDir('db-update-statements');
  tempDirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  if (contract !== undefined) {
    await writeContractSnapshot(migrationsDir, contract.storage.storageHash, {
      contractJson: contract,
      contractDts: '',
    });
  }
  return migrationsDir;
}

function update(options: {
  readonly migrationsDir: string;
  readonly marker: ContractMarkerRecord | undefined;
  readonly renames: readonly string[];
  readonly mode?: 'plan' | 'apply';
  readonly migrations: TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
}) {
  return executeDbUpdate({
    driver,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: familyWithMarker(options.marker),
    contract: destination,
    mode: options.mode ?? 'plan',
    migrations: options.migrations,
    frameworkComponents: [],
    migrationsDir: options.migrationsDir,
    targetId: 'postgres',
    renames: options.renames,
  });
}

describe('executeDbUpdate with statements', () => {
  it('plans from the snapshot of the marker hash and hands the planner the resolved statements', async () => {
    const { migrations, calls } = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
    });

    expect(calls).toEqual([
      {
        fromContract: origin,
        statements: [
          {
            kind: 'rename',
            entity: 'model',
            from: { namespace: 'app', model: 'Profile' },
            to: { namespace: 'app', model: 'User' },
          },
        ],
      },
    ]);
    expect(result.ok && result.value.appliedStatements).toEqual([
      expect.objectContaining({
        description: 'rename model "Profile" to "User"',
        operationCount: 1,
      }),
    ]);
  });

  it('reports the applied statements on an apply', async () => {
    const { migrations } = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    expect(result.ok && result.value.mode).toBe('apply');
    expect(result.ok && result.value.appliedStatements).toHaveLength(1);
  });

  it('gives the destructive pre-plan the statements, so a rename is not refused as a drop', async () => {
    const { migrations, calls } = recordingMigrations('destructive');
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    expect(result.ok).toBe(true);
    expect(calls.every((call) => call.statements.length === 1)).toBe(true);
  });

  it('refuses statements when the snapshot store has no contract for the marker hash', async () => {
    const { migrations, calls } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(undefined);
    await expect(
      update({
        migrationsDir,
        marker: markerAt(ORIGIN_HASH),
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      meta: { hash: ORIGIN_HASH, snapshotDirectory: join(migrationsDir, 'snapshots', ORIGIN_HASH) },
    });
    expect(calls).toEqual([]);
  });

  it('refuses statements when the database has no marker', async () => {
    const { migrations } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(undefined),
        marker: undefined,
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN', meta: { hash: null } });
  });

  it('refuses the same statements once the database is at the destination', async () => {
    const { migrations } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(destination),
        marker: markerAt(DESTINATION_HASH),
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION.STATEMENT_UNRESOLVED' });
  });

  it('plans from the snapshot without statements, and needs no snapshot', async () => {
    const withSnapshot = recordingMigrations();
    await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: [],
      migrations: withSnapshot.migrations,
    });
    expect(withSnapshot.calls).toEqual([{ fromContract: origin, statements: [] }]);

    const without = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(undefined),
      marker: markerAt(ORIGIN_HASH),
      renames: [],
      migrations: without.migrations,
    });
    expect(without.calls).toEqual([{ fromContract: null, statements: [] }]);
    expect(result.ok && result.value.appliedStatements).toEqual([]);
  });
});

import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  createOfflineProject,
  type FakePlannerScript,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function harness(project: OfflineProject, script: FakePlannerScript = {}) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: offlineConfig({ project, script }),
  });
}

async function plannedDirs(project: OfflineProject): Promise<readonly string[]> {
  try {
    return (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs').sort();
  } catch {
    return [];
  }
}

/** The database is at a contract with `Profile`; the emitted contract has `User` instead. */
async function renamingProject(options: { readonly history: boolean } = { history: true }) {
  const project = await createOfflineProject({ storageHash: HASH_TO, models: ['User', 'Post'] });
  if (options.history) {
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
  }
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_FROM,
    models: ['Profile', 'Article'],
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

const profileToUser = {
  kind: 'rename',
  entity: 'model',
  from: { namespace: 'app', model: 'Profile' },
  to: { namespace: 'app', model: 'User' },
};

describe('migration plan --rename', () => {
  it('hands the planner the resolved statements in the order given', async () => {
    const project = await renamingProject();
    const statementsReceived: unknown[][] = [];
    const run = await harness(project, { statementsReceived }).run(
      ['migration', 'plan', '--rename', 'Profile:User', '--rename', 'Article:Post'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(statementsReceived).toEqual([
      [
        profileToUser,
        {
          kind: 'rename',
          entity: 'model',
          from: { namespace: 'app', model: 'Article' },
          to: { namespace: 'app', model: 'Post' },
        },
      ],
    ]);
  });

  it('reports the applied statements in JSON and under the operations in human output', async () => {
    const project = await renamingProject();
    const run = await harness(project).run(['migration', 'plan', '--rename', 'Profile:User'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.presented?.data).toMatchObject({
      appliedStatements: [
        { statement: profileToUser, description: 'statement 1', operationCount: 1 },
      ],
    });
    const human = run.presented?.presentation.human ?? [];
    const statementsIndex = human.findIndex(
      (block) => block.kind === 'tree' && block.roots[0]?.label === 'Statements applied',
    );
    const operationsIndex = human.findIndex(
      (block) => block.kind === 'tree' && block.roots[0]?.label !== 'Statements applied',
    );
    expect(human[statementsIndex]).toEqual({
      kind: 'tree',
      roots: [{ label: 'Statements applied', children: [{ label: 'statement 1 (1 operation)' }] }],
    });
    expect(statementsIndex).toBeGreaterThan(operationsIndex);
  });

  it('refuses an unresolvable statement before writing anything', async () => {
    const project = await renamingProject();
    const statementsReceived: unknown[][] = [];
    const run = await harness(project, { statementsReceived }).run(
      ['migration', 'plan', '--rename', 'Account:User', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.STATEMENT_UNRESOLVED' } },
    });
    expect(statementsReceived).toEqual([]);
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('refuses a malformed statement', async () => {
    const project = await renamingProject();
    const run = await harness(project).run(['migration', 'plan', '--rename', 'Profile', '--json'], {
      cwd: project.dir,
    });
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.STATEMENT_INVALID' } },
    });
  });

  it('refuses every statement on a plan from an empty database', async () => {
    const project = await renamingProject();
    const run = await harness(project).run(
      ['migration', 'plan', '--from', '@empty', '--rename', 'Profile:User', '--json'],
      { cwd: project.dir },
    );
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.STATEMENT_UNRESOLVED',
          why: expect.stringContaining('origin contract has no model "Profile" (models: (none))'),
        },
      },
    });
  });

  /**
   * The database is at the emitted contract's storage hash, but the snapshot of that hash still
   * names the model `Profile`: a rename whose table name is kept leaves the storage unchanged.
   */
  async function storageUnchangedProject() {
    const project = await createOfflineProject({ storageHash: HASH_TO, models: ['User', 'Post'] });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_TO,
    });
    await seedContractSnapshot({
      migrationsDir: project.migrationsDir,
      storageHash: HASH_TO,
      models: ['Profile', 'Article'],
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });
    return project;
  }

  it('reports a statement that needs no operations as applied, without writing a package', async () => {
    const project = await storageUnchangedProject();
    const run = await harness(project, { operations: [] }).run(
      ['migration', 'plan', '--rename', 'Profile:User'],
      { cwd: project.dir, isTty: { stdout: true } },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      noOp: true,
      appliedStatements: [{ statement: profileToUser, operationCount: 0 }],
    });
    expect(run.presented?.presentation.human.at(1)).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'No changes to plan: the statements need no operations',
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('fails planning when the storage changed but the planner planned nothing, statements or not', async () => {
    const project = await renamingProject();
    const run = await harness(project, { operations: [] }).run(
      ['migration', 'plan', '--rename', 'Profile:User', '--json'],
      { cwd: project.dir },
    );

    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLANNING_FAILED' } },
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('passes the statements to the delta of an auto-baseline plan only', async () => {
    const project = await renamingProject({ history: false });
    const statementsReceived: unknown[][] = [];
    const run = await harness(project, { statementsReceived }).run(
      ['migration', 'plan', '--name', 'delta', '--rename', 'Profile:User'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(statementsReceived).toEqual([[], [profileToUser]]);
    expect(run.presented?.data).toMatchObject({
      appliedStatements: [{ statement: profileToUser }],
    });
  });
});

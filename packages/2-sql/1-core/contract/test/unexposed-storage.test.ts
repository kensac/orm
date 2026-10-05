/**
 * Storage the domain does not expose: a column no field maps, a table no model maps, and a foreign key no relation travels. The contract validates; only a field must map a column that exists.
 */
import type { ContractModel } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { col, fk, model, pk, table } from '../src/factories';
import type { SqlModelFieldStorage, SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

function storage<T extends Record<string, unknown>>(tables: T) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: { table: tables },
      },
    },
  };
}

function userModel(fields: Record<string, SqlModelFieldStorage>): ContractModel {
  return blindCast<ContractModel, 'model() widens relations; this model has none'>(
    model('user', fields, {}),
  );
}

const tables = {
  user: table(
    {
      id: col('int4', 'pg/int4@1'),
      email: col('text', 'pg/text@1'),
      legacy_key: col('text', 'pg/text@1', true),
    },
    { pk: pk('id') },
  ),
  _prisma_migrations: table(
    {
      id: col('varchar', 'pg/varchar@1'),
      migration_name: col('varchar', 'pg/varchar@1'),
      user_id: col('int4', 'pg/int4@1', true),
    },
    {
      pk: pk('id'),
      fks: [fk('_prisma_migrations', ['user_id'], 'user', ['id'])],
    },
  ),
};

describe('storage no domain object exposes', () => {
  it('validates a column no field maps, a table no model maps, and a foreign key no relation travels', () => {
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: { User: userModel({ id: { column: 'id' }, email: { column: 'email' } }) },
    });

    expect(() => validateSqlContractFully(contract)).not.toThrow();
  });

  it('still refuses a field that maps a column the table does not have', () => {
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: { User: userModel({ id: { column: 'id' }, legacyKey: { column: 'legacyKey' } }) },
    });

    expect(() => validateSqlContractFully(contract)).toThrow(
      /field "legacyKey" references non-existent column "legacyKey" in table "user"/,
    );
  });
});

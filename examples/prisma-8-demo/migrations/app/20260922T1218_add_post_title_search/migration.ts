#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/2a89d70379cd3a3a349abc0cd39278d70531afd884e29c5b095bed02f0af0955/contract';
import startContract from '../../snapshots/2a89d70379cd3a3a349abc0cd39278d70531afd884e29c5b095bed02f0af0955/contract.json' with {
  type: 'json',
};
import type { Contract as End } from '../../snapshots/fd56da6db7adf93de05ac697db7020bdcfcb00a11702fd0f1c518f9723f1f8a9/contract';
import endContract from '../../snapshots/fd56da6db7adf93de05ac697db7020bdcfcb00a11702fd0f1c518f9723f1f8a9/contract.json' with {
  type: 'json',
};

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'post',
        index: 'post_title_search_e0dd1131',
        expression: 'to_tsvector(\'english\', "title")',
        extras: { type: 'gin' },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

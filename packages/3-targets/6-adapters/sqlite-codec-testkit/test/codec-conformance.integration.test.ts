/**
 * Runs the codec JSON-projection conformance harness against a live SQLite
 * database for every built-in codec descriptor.
 *
 * An unmarked case must conform — its projection must agree with the codec's
 * `encodeJson` and survive the round trip back through `decodeJson`. A marked
 * case must still fail, and fail with the kind it records, so neither the marker
 * nor its recorded kind can rot as projections change.
 *
 * Conformance is measured against the codec's **current** methods, so a green
 * run does not claim every codec's JSON is already canonical: a codec whose
 * `encodeJson` is not yet canonical conforms here and is tracked by the plan.
 * See `codec-conformance/cases.ts`.
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  decodeJsonString,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { SqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { sqliteText } from '@internal/target-sqlite/data-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection } from '../src/index';
import { runSqliteCodecProjection } from '../src/index';
import { sqliteConformanceCases } from './codec-conformance/cases';

const EXTENSION_DATETIME_CODEC_ID = 'sqlite-extension/datetime@1';
const builtinDatetime = sqliteCodecDescriptorRegistry.descriptorFor('sqlite/datetime@1')!;
function declared<T>(hook: T | undefined, name: string): T {
  if (hook === undefined) throw new Error(`sqlite/datetime@1 declares ${name}`);
  return hook;
}
const datetimeCanonicalForm = declared(builtinDatetime.toCanonicalForm, 'toCanonicalForm');
const datetimeDatabaseText = declared(builtinDatetime.toDatabaseText, 'toDatabaseText');

/** A datetime codec of `sqlite/text` from outside the target, which writes `rowText` for a row. */
class ExtensionDatetimeDescriptor extends SqliteCodecDescriptor<void> {
  constructor(private readonly rowText: (value: Date) => string) {
    super();
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteText.id;
  override readonly toCanonicalForm = datetimeCanonicalForm;
  override readonly toDatabaseText = datetimeDatabaseText;
  override readonly codecId = EXTENSION_DATETIME_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (
    ctx: CodecInstanceContext,
  ) => CodecImpl<string, readonly ['equality'], string, Date> {
    const rowText = this.rowText;
    return () =>
      new (class extends CodecImpl<string, readonly ['equality'], string, Date> {
        async encode(value: Date, _ctx: CodecCallContext): Promise<string> {
          return rowText(value);
        }
        async decode(wire: string, _ctx: CodecCallContext): Promise<Date> {
          return new Date(wire);
        }
        encodeJson(value: Date): JsonValue {
          return builtinDatetime.factory(undefined)({ name: 'value' }).encodeJson(value);
        }
        decodeJson(json: JsonValue): Date {
          return new Date(decodeJsonString(EXTENSION_DATETIME_CODEC_ID, json));
        }
      })(this);
  }
}

/** Widens a codec wire value to what `node:sqlite` binds as a positional parameter. */
function toSqliteParam(wire: unknown): SQLInputValue {
  if (wire === null) return null;
  if (typeof wire === 'number' || typeof wire === 'bigint' || typeof wire === 'string') return wire;
  if (wire instanceof Uint8Array) return wire;
  throw new Error(`No SQLite parameter binding for a wire value of type ${typeof wire}.`);
}

describe('SQLite codec JSON-projection conformance', { concurrent: false }, () => {
  let database: DatabaseSync | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(() => {
    database = new DatabaseSync(':memory:');
    connection = {
      query: async (sql, params) =>
        database!.prepare(sql).all(...(params ?? []).map(toSqliteParam)),
    };
  });

  afterAll(() => {
    database?.close();
    database = undefined;
    connection = undefined;
  });

  it('registers a representative value for every built-in descriptor', () => {
    const covered = new Set(sqliteConformanceCases.map((entry) => entry.codecId));
    const uncovered = [...sqliteCodecDescriptorRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => !covered.has(codecId));

    expect(uncovered).toEqual([]);
  });

  // Null is a dimension every column has, and it is what let an assembled
  // projection report an absent value as a present one. Requiring a case per
  // descriptor makes the dimension self-enforcing: a new codec cannot register
  // without one.
  it('registers a NULL case for every built-in descriptor', () => {
    const covered = new Set(
      sqliteConformanceCases
        .filter((entry) => entry.nullValue === true)
        .map((entry) => entry.codecId),
    );
    const uncovered = [...sqliteCodecDescriptorRegistry.values()]
      .map((descriptor) => descriptor.codecId)
      .filter((codecId) => !covered.has(codecId));

    expect(uncovered).toEqual([]);
  });

  // The registry only knows the built-ins; an extension codec is not in it.
  // `descriptor` lets a case carry its descriptor directly, the same escape
  // hatch the PostgreSQL harness has, so a case's codec need not be
  // pre-registered to run through the harness.
  it('runs a case whose descriptor is not in the built-in registry', async () => {
    const unregisteredCase = {
      codecId: 'sqlite-extension/unregistered-example@1',
      descriptor: sqliteCodecDescriptorRegistry.descriptorFor('sqlite/text@1')!,
      label: 'descriptor supplied directly on the case',
      value: 'hello',
      storageType: 'TEXT',
    };

    expect(sqliteCodecDescriptorRegistry.descriptorFor(unregisteredCase.codecId)).toBeUndefined();

    const outcome = await runSqliteCodecProjection(connection!, unregisteredCase);

    expect(outcome.failure).toBeUndefined();
  });

  it('fails a codec whose text for a row differs from the text its descriptor declares the database holds', async () => {
    const outcome = await runSqliteCodecProjection(connection!, {
      codecId: EXTENSION_DATETIME_CODEC_ID,
      descriptor: new ExtensionDatetimeDescriptor((value) =>
        value.toISOString().replace('.000Z', 'Z'),
      ),
      label: 'an instant on a whole second',
      value: new Date('2024-01-01T00:00:00.000Z'),
      storageType: 'TEXT',
    });

    expect(outcome.failure).toEqual({
      kind: 'database-text-mismatch',
      detail:
        'the codec writes "2024-01-01T00:00:00Z" for a row, but its descriptor declares the database holds "2024-01-01T00:00:00.000Z"',
    });
  });

  it('passes a codec whose text for a row is the text its descriptor declares the database holds', async () => {
    const outcome = await runSqliteCodecProjection(connection!, {
      codecId: EXTENSION_DATETIME_CODEC_ID,
      descriptor: new ExtensionDatetimeDescriptor((value) => value.toISOString()),
      label: 'an instant on a whole second',
      value: new Date('2024-01-01T00:00:00.000Z'),
      storageType: 'TEXT',
    });

    expect(outcome.failure).toBeUndefined();
  });

  for (const conformanceCase of sqliteConformanceCases) {
    const expectation =
      conformanceCase.notYetCanonical === undefined
        ? 'agrees with encodeJson and round-trips through decodeJson'
        : 'still disagrees with encodeJson or decodeJson';

    it(`${conformanceCase.codecId} (${conformanceCase.label}) ${expectation}`, async () => {
      const outcome = await runSqliteCodecProjection(connection!, conformanceCase);

      if (conformanceCase.notYetCanonical === undefined) {
        expect(outcome.failure).toBeUndefined();
      } else {
        expect(outcome.failure?.kind).toBe(conformanceCase.notYetCanonical.kind);
      }
    });
  }
});

import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  decodeJsonString,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { SqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import { sqliteDatetime, sqliteDatetimeCanonical } from '@internal/target-sqlite/data-types';

export const EXTENSION_DATETIME_CODEC_ID = 'sqlite-extension/datetime@1';

class ExtensionDatetimeCodec extends CodecImpl<string, readonly ['equality'], string, Date> {
  constructor(
    descriptor: AnyCodecDescriptor,
    private readonly storedText: (value: Date) => string,
  ) {
    super(descriptor);
  }
  async encode(value: Date, _ctx: CodecCallContext): Promise<string> {
    return this.storedText(value);
  }
  async decode(wire: string, _ctx: CodecCallContext): Promise<Date> {
    return new Date(wire);
  }
  encodeJson(value: Date): JsonValue {
    return sqliteDatetimeCanonical(value.toISOString());
  }
  decodeJson(json: JsonValue): Date {
    return new Date(decodeJsonString(EXTENSION_DATETIME_CODEC_ID, json));
  }
}

/** A codec of `sqlite/datetime` from outside the target, which writes `storedText` for a row. */
export class ExtensionDatetimeDescriptor extends SqliteCodecDescriptor<void> {
  constructor(private readonly storedText: (value: Date) => string) {
    super();
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteDatetime.id;
  override readonly codecId = EXTENSION_DATETIME_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => ExtensionDatetimeCodec {
    return () => new ExtensionDatetimeCodec(this, this.storedText);
  }
}

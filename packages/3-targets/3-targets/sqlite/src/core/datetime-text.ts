/** The `strftime` format for the text `encodeSqliteDatetime` writes. */
export const SQLITE_DATETIME_TEXT_FORMAT = '%Y-%m-%dT%H:%M:%fZ';

/** The SQLite expression for the current instant, as the text `encodeSqliteDatetime` writes. */
export const SQLITE_NOW_EXPRESSION = `strftime('${SQLITE_DATETIME_TEXT_FORMAT}','now')`;

/** The text SQLite holds for an instant: what the codec writes for every row, and for a default. */
export function encodeSqliteDatetime(value: Date): string {
  return value.toISOString();
}

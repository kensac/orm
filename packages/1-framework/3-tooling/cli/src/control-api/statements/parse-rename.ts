import type { CliStructuredError } from '@internal/errors/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { errorStatementInvalid } from '../../utils/cli-errors';

/** One side of a statement: `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`. */
export type StatementSide =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string];

export interface ParsedRename {
  readonly text: string;
  readonly from: StatementSide;
  readonly to: StatementSide;
}

const MAX_SEGMENTS = 3;

function parseSide(text: string, side: string): Result<StatementSide, CliStructuredError> {
  const segments = side.split('.');
  if (segments.some((segment) => segment === '')) {
    return notOk(errorStatementInvalid(text, `"${side}" has an empty name.`));
  }
  const [first, second, third] = segments;
  if (first === undefined || segments.length > MAX_SEGMENTS) {
    return notOk(
      errorStatementInvalid(
        text,
        `"${side}" has ${segments.length} names; at most three are allowed.`,
      ),
    );
  }
  if (second === undefined) return ok([first]);
  if (third === undefined) return ok([first, second]);
  return ok([first, second, third]);
}

function namesModelAndField(from: StatementSide, to: StatementSide): boolean {
  const lengths = [from.length, to.length];
  return lengths.includes(1) && lengths.includes(MAX_SEGMENTS);
}

/** Parses the text of one `--rename <old>:<new>` statement. */
export function parseRenameStatement(text: string): Result<ParsedRename, CliStructuredError> {
  const sides = text.split(':');
  const [oldSide, newSide] = sides;
  if (oldSide === undefined || newSide === undefined) {
    return notOk(
      errorStatementInvalid(text, 'The statement has no ":" between the old and new name.'),
    );
  }
  if (sides.length > 2) {
    return notOk(errorStatementInvalid(text, 'The statement has more than one ":".'));
  }
  const from = parseSide(text, oldSide);
  if (!from.ok) return from;
  const to = parseSide(text, newSide);
  if (!to.ok) return to;
  if (namesModelAndField(from.value, to.value)) {
    return notOk(
      errorStatementInvalid(
        text,
        'The statement names a model on one side and a field on the other.',
      ),
    );
  }
  return ok({ text, from: from.value, to: to.value });
}

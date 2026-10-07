import type { CliStructuredError } from '@internal/errors/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { errorStatementInvalid } from '../../utils/cli-errors';
import type { StatementText } from './statement-text';

/** One side of a statement: `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`. */
export type StatementSide =
  | readonly [string]
  | readonly [string, string]
  | readonly [string, string, string];

export interface ParsedRename extends StatementText {
  readonly verb: 'rename';
  readonly from: StatementSide;
  readonly to: StatementSide;
}

const MAX_SEGMENTS = 3;

export const STATEMENT_FORMS_FIX =
  'Each side of `<old>:<new>` is one of `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`, and both sides name a model or both name a field.';

function invalid(statement: StatementText, why: string): CliStructuredError {
  return errorStatementInvalid(statement, why, STATEMENT_FORMS_FIX);
}

function parseSide(
  statement: StatementText,
  side: string,
): Result<StatementSide, CliStructuredError> {
  const segments = side.split('.');
  if (segments.some((segment) => segment === '')) {
    return notOk(invalid(statement, `"${side}" has an empty name.`));
  }
  const [first, second, third] = segments;
  if (first === undefined || segments.length > MAX_SEGMENTS) {
    return notOk(
      invalid(statement, `"${side}" has ${segments.length} names; at most three are allowed.`),
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

/** Parses the text of one rename statement, `<old>:<new>`. */
export function parseRenameStatement(
  statement: StatementText & { readonly verb: 'rename' },
): Result<ParsedRename, CliStructuredError> {
  const sides = statement.text.split(':');
  const [oldSide, newSide] = sides;
  if (oldSide === undefined || newSide === undefined) {
    return notOk(invalid(statement, 'The statement has no ":" between the old and new name.'));
  }
  if (sides.length > 2) {
    return notOk(invalid(statement, 'The statement has more than one ":".'));
  }
  const from = parseSide(statement, oldSide);
  if (!from.ok) return from;
  const to = parseSide(statement, newSide);
  if (!to.ok) return to;
  if (namesModelAndField(from.value, to.value)) {
    return notOk(
      invalid(statement, 'The statement names a model on one side and a field on the other.'),
    );
  }
  return ok({ verb: 'rename', text: statement.text, from: from.value, to: to.value });
}

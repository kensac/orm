import type { CliStructuredError } from '@internal/errors/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { errorStatementInvalid } from '../../utils/cli-errors';
import type { StatementText } from './statement-text';

export interface ParsedDelete extends StatementText {
  readonly verb: 'delete';
}

const DELETE_FORMS_FIX =
  'Write the statement as --delete <name>, where the name is Model, namespace.Model, Model.field or namespace.Model.field, or the storage name the refusal gave, for example --delete Legacy or --delete User.nickname.';

/**
 * Checks the text of one delete statement. The text stays unresolved: a delete names what a plan
 * would lose, so it is matched by equality against the plan's subjects, not resolved against the
 * contracts. Any name a subject can have is accepted, since a storage name may contain any
 * character a quoted identifier can.
 */
export function parseDeleteStatement(
  statement: StatementText & { readonly verb: 'delete' },
): Result<ParsedDelete, CliStructuredError> {
  if (statement.text.trim() === '') {
    return notOk(
      errorStatementInvalid(statement, 'The statement names nothing.', DELETE_FORMS_FIX),
    );
  }
  return ok({ verb: 'delete', text: statement.text });
}

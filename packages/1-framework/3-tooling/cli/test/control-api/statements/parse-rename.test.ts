import { describe, expect, it } from 'vitest';
import { parseRenameStatement } from '../../../src/control-api/statements/parse-rename';
import { expectFailure, expectValue } from './statement-fixtures';

const FORMS = ['`Model`', '`namespace.Model`', '`Model.field`', '`namespace.Model.field`'];

describe('parseRenameStatement', () => {
  describe('accepted forms', () => {
    it.each([
      ['Profile:User', ['Profile'], ['User']],
      ['auth.Profile:billing.User', ['auth', 'Profile'], ['billing', 'User']],
      ['User.name:User.fullName', ['User', 'name'], ['User', 'fullName']],
      ['auth.User.name:auth.User.fullName', ['auth', 'User', 'name'], ['auth', 'User', 'fullName']],
      ['Profile:auth.User', ['Profile'], ['auth', 'User']],
      ['auth.User.name:User.fullName', ['auth', 'User', 'name'], ['User', 'fullName']],
    ])('splits %s into its two sides', (text, from, to) => {
      expect(expectValue(parseRenameStatement(text))).toEqual({ text, from, to });
    });

    it('keeps the case of every segment', () => {
      expect(expectValue(parseRenameStatement('user:User'))).toEqual({
        text: 'user:User',
        from: ['user'],
        to: ['User'],
      });
    });
  });

  describe('malformed statements', () => {
    it.each([
      ['no colon', 'ProfileUser'],
      ['more than one colon', 'Profile:User:Account'],
      ['an empty old side', ':User'],
      ['an empty new side', 'Profile:'],
      ['an empty segment', 'auth..Profile:User'],
      ['a trailing dot', 'Profile.:User'],
      ['more than three segments', 'a.b.c.d:User'],
    ])('rejects %s, quoting the statement and listing the accepted forms', (_case, text) => {
      expectFailure(parseRenameStatement(text), 'MIGRATION.STATEMENT_INVALID', text, ...FORMS);
    });

    it.each(['Profile:auth.User.name', 'auth.User.name:Profile'])(
      'rejects %s, a model on one side and a field on the other',
      (text) => {
        expectFailure(
          parseRenameStatement(text),
          'MIGRATION.STATEMENT_INVALID',
          text,
          'model on one side and a field on the other',
        );
      },
    );
  });
});

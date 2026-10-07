import { describe, expect, it } from 'vitest';
import { dataLossQuestion } from '../../../src/control-api/statements/data-loss-questions';
import { contractOf } from './statement-fixtures';

const origin = contractOf({ app: { models: { User: { fields: ['email'] } } } });
const destination = contractOf({ app: { models: { User: { fields: ['email'] } } } });
const drop = {
  operationIndex: 0,
  label: 'Drop column age from user',
  subject: { kind: 'storage', name: 'public.user.age' },
} as const;

describe('dataLossQuestion for data no model names', () => {
  it('says no model of a known origin contract stores it', () => {
    const question = dataLossQuestion(drop, {
      origin,
      destination,
      renames: [],
      originKnown: true,
    });

    expect({ question: question.question, verbs: question.verbs }).toEqual({
      question:
        'Drop column age from user would lose the data in "public.user.age", which no model of the origin contract stores.',
      verbs: ['delete'],
    });
  });

  it('says the name is a storage name when the origin contract is unknown', () => {
    const question = dataLossQuestion(drop, {
      origin,
      destination,
      renames: [],
      originKnown: false,
    });

    expect(question.question).toBe(
      'Drop column age from user would lose the data in "public.user.age", named by its storage name because the origin contract is unknown.',
    );
  });
});

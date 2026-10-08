import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  answerPlanQuestions,
  type PlannedQuestions,
  type PlannedSubject,
  type PlanQuestion,
} from '../../../src/control-api/statements/data-loss-questions';
import { contractOf } from './statement-fixtures';

const origin = contractOf({ app: { models: { T: { fields: ['id', 'ratio'] } } } });
const destination = contractOf({ app: { models: { T: { fields: ['id', 'ratio2'] } } } });
const ratio: PlannedSubject['subject'] = {
  kind: 'field',
  namespaceId: asNamespaceId('app'),
  model: 'T',
  field: 'ratio',
};

function planWith(
  ...losses: readonly { label: string; operationIndex: number }[]
): PlannedQuestions {
  return {
    dataLoss: losses.map((loss) => ({ ...loss, subject: ratio })),
    accessWidening: [],
  };
}

const dropRatio = { label: 'Drop column "ratio" from "T"', operationIndex: 1 };
const convertRatio = { label: 'Alter type of "T"."ratio2" to int4', operationIndex: 1 };

function run(replanned: PlannedQuestions, typed: readonly (readonly string[])[]) {
  const asked: (readonly string[])[] = [];
  let round = 0;
  return {
    asked,
    result: answerPlanQuestions({
      plan: planWith(dropRatio),
      askAccess: false,
      renames: [],
      preAnswers: [],
      consentAll: false,
      origin,
      originKnown: true,
      destination,
      answer: async (questions: readonly PlanQuestion[]) => {
        asked.push(questions.map(({ question }) => question));
        const answers = typed[round] ?? [];
        round += 1;
        return answers.map((answer) => {
          const [verb, text] = answer.split(' ');
          return { verb: verb === 'rename' ? 'rename' : 'delete', text: text ?? '' } as const;
        });
      },
      replan: async () => ok(replanned),
    }),
  };
}

describe('a rename typed at the prompt', () => {
  it('resolves its loss when the operation asked about is gone, and asks about a new loss on the same field', async () => {
    const { asked, result } = run(planWith(convertRatio), [
      ['rename T.ratio:T.ratio2'],
      ['delete T.ratio'],
    ]);

    expect((await result).ok).toBe(true);
    expect(asked).toEqual([
      ['Drop column "ratio" from "T" would lose the values of field "T.ratio".'],
      ['Alter type of "T"."ratio2" to int4 would lose the values of field "T.ratio".'],
    ]);
  });

  it('fails when the operation asked about is still in the plan', async () => {
    const { result } = run(planWith(dropRatio), [['rename T.ratio:T.ratio2']]);

    const outcome = await result;
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure).toMatchObject({
      code: 'MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS',
    });
  });
});

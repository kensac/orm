import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  askPlanQuestions,
  ORIGIN_SNAPSHOT_RECOVERY,
  type PlannedQuestions,
  type PlannedSubject,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
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
    result: askPlanQuestions({
      plan: planWith(dropRatio),
      askAccess: false,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      keepDataByHand: undefined,
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

describe('questions about storage when the origin contract is unknown', () => {
  it('give the steps that store the snapshot once, on the first such question', async () => {
    const asked: string[] = [];
    const storage = (name: string, operationIndex: number) => ({
      operationIndex,
      label: `Drop table ${name}`,
      subject: { kind: 'storage', name } as const,
    });
    await askPlanQuestions({
      plan: { dataLoss: [storage('Legacy', 0), storage('Profile', 1)], accessWidening: [] },
      askAccess: false,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: false,
      keepDataByHand: undefined,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessWidening: [] }),
    });

    expect(asked).toEqual([
      `Drop table Legacy would lose the data in "Legacy", named by its storage name because the origin contract is unknown; --delete loses its rows. ${ORIGIN_SNAPSHOT_RECOVERY}`,
      'Drop table Profile would lose the data in "Profile", named by its storage name because the origin contract is unknown; --delete loses its rows.',
    ]);
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain('--dry-run');
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain('`prisma db update --advance-ref <name> --dry-run`');
    expect(ORIGIN_SNAPSHOT_RECOVERY).toContain(
      'with the same `--db` as this command if it has one',
    );
  });
});

describe('questions about access', () => {
  it('ask once per operation, and say a policy drop changes access where disabling row-level security widens it', async () => {
    const user = { kind: 'model', namespaceId: asNamespaceId('app'), model: 'T' } as const;
    const asked: string[] = [];
    const result = await askPlanQuestions({
      plan: {
        dataLoss: [],
        accessWidening: [
          {
            operationIndex: 0,
            label: 'Drop RLS policy "readers" on "T"',
            subject: user,
            widens: false,
          },
          {
            operationIndex: 1,
            label: 'Disable row-level security on "T"',
            subject: user,
            widens: true,
          },
        ],
      },
      askAccess: true,
      renames: [],
      preAnswers: [],
      consentAll: { delete: false, allow: false },
      origin,
      originKnown: true,
      keepDataByHand: undefined,
      destination,
      answer: async (questions) => {
        asked.push(...questions.map(({ question }) => question));
        return questions.map(({ subject }) => ({ verb: 'allow', text: subject }));
      },
      replan: async () => ok({ dataLoss: [], accessWidening: [] }),
    });

    expect(asked).toEqual([
      'Drop RLS policy "readers" on "T" would change who can read and write its rows.',
      'Disable row-level security on "T" would widen who can read and write its rows.',
    ]);
    expect(
      result.ok &&
        result.value.consented.map(({ verb, text, operationIndex }) => ({
          verb,
          text,
          operationIndex,
        })),
    ).toEqual([
      { verb: 'allow', text: 'T', operationIndex: 0 },
      { verb: 'allow', text: 'T', operationIndex: 1 },
    ]);
  });
});

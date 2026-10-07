import type { ContractWithDomain } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import {
  type MigrationStatementSubject,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { errorStatementDidNotResolveLoss } from '../../utils/cli-errors';
import type { ConsentVerb } from './parse-consent';
import { resolveStatements } from './resolve-statements';
import type { StatementText } from './statement-text';

/** A verb a plan question accepts. */
export type PlanQuestionVerb = 'rename' | ConsentVerb;

/**
 * What a command asks about one operation of a plan: the question, its subject written as the
 * statement names it, and the verbs that answer it. A command hands it to its prompt.
 */
export interface PlanQuestion {
  readonly question: string;
  readonly subject: string;
  readonly verbs: readonly PlanQuestionVerb[];
  readonly forms: { readonly rename?: string };
  readonly validate: (verb: PlanQuestionVerb, text: string) => string | undefined;
}

export interface PlanAnswer {
  readonly verb: PlanQuestionVerb;
  readonly text: string;
}

/** Asks every question at once and returns the answers in question order. */
export type AnswerPlanQuestions = (
  questions: readonly PlanQuestion[],
) => Promise<readonly PlanAnswer[]>;

/**
 * An operation of a plan with its subject and the label of that operation. `operationIndex` is
 * its position among the operations the result lists; `undefined` when the plan could not resolve
 * it.
 */
export interface PlannedSubject {
  readonly operationIndex: number | undefined;
  readonly label: string;
  readonly subject: MigrationStatementSubject;
}

/** What a plan would lose, and whose access it would widen. */
export interface PlannedQuestions {
  readonly dataLoss: readonly PlannedSubject[];
  readonly accessWidening: readonly PlannedSubject[];
}

function modelText(contract: ContractWithDomain, coordinate: ModelCoordinate): string {
  return Object.keys(contract.domain.namespaces).length > 1
    ? modelDisplayName(coordinate)
    : coordinate.model;
}

/** The contracts a statement names things in, and the renames the plan applies so far. */
export interface StatementContracts {
  readonly origin: ContractWithDomain;
  /** The destination contract; needed only to name a field of a renamed model. */
  readonly destination?: ContractWithDomain;
  readonly renames: readonly StatementText[];
}

/** The model a rename statement of `contracts` gives `coordinate` in the destination, if any. */
function renamedModel(
  coordinate: ModelCoordinate,
  contracts: StatementContracts,
): ModelCoordinate | undefined {
  if (contracts.destination === undefined || contracts.renames.length === 0) return undefined;
  const resolved = resolveStatements({
    statements: contracts.renames,
    origin: { kind: 'contract', contract: contracts.origin },
    destination: contracts.destination,
  });
  if (!resolved.ok) return undefined;
  return resolved.value.find(
    (statement) =>
      statement.entity === 'model' &&
      statement.from.namespaceId === coordinate.namespaceId &&
      statement.from.model === coordinate.model,
  )?.to;
}

/**
 * The subject as a statement names it: `Model` or `Model.field`, with the namespace when its
 * contract has several, or the storage name when no model stores what the operation is about. A
 * field of a model the plan renames is named through the model's new name, as a rename of the
 * field is written.
 */
export function subjectText(
  subject: MigrationStatementSubject,
  contracts: StatementContracts,
): string {
  switch (subject.kind) {
    case 'model':
      return modelText(contracts.origin, subject);
    case 'field': {
      const renamed = renamedModel(subject, contracts);
      const model =
        renamed === undefined || contracts.destination === undefined
          ? modelText(contracts.origin, subject)
          : modelText(contracts.destination, renamed);
      return `${model}.${subject.field}`;
    }
    case 'storage':
      return subject.name;
  }
}

/** The statement's description, written as its question names the subject: `delete field "User.nickname"`. */
export function consentDescription(
  verb: ConsentVerb,
  subject: MigrationStatementSubject,
  text: string,
): string {
  return `${verb} ${subject.kind} "${text}"`;
}

function lossText(subject: MigrationStatementSubject, text: string): string {
  switch (subject.kind) {
    case 'model':
      return `would lose the data of model "${text}"`;
    case 'field':
      return `would lose the values of field "${text}"`;
    case 'storage':
      return `would lose the data in "${text}", which no model of the origin contract stores`;
  }
}

function sameCoordinate(
  statement: ResolvedMigrationStatement,
  subject: MigrationStatementSubject,
): boolean {
  if (subject.kind === 'storage') return false;
  const { from } = statement;
  if (from.namespaceId !== subject.namespaceId || from.model !== subject.model) return false;
  return subject.kind === 'field'
    ? statement.entity === 'field' && statement.from.field === subject.field
    : statement.entity === 'model';
}

function namesSubject(verb: ConsentVerb, subject: string) {
  return (text: string): string | undefined =>
    text === subject ? undefined : `${verb} names "${subject}": --${verb} ${subject}.`;
}

/**
 * The question for one operation that would lose data. A model or field may be renamed instead of
 * deleted; a rename is resolved against the two contracts after the plan's other renames, and its
 * old name must be the subject. Data no model stores can only be deleted.
 */
export function dataLossQuestion(
  loss: PlannedSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): PlanQuestion {
  const subject = subjectText(loss.subject, contracts);
  const renamable = loss.subject.kind !== 'storage';
  const deleteNames = namesSubject('delete', subject);
  return {
    question: `${loss.label} ${lossText(loss.subject, subject)}.`,
    subject,
    verbs: renamable ? ['rename', 'delete'] : ['delete'],
    forms: renamable ? { rename: `${subject}:<new name>` } : {},
    validate: (verb, text) => {
      if (verb !== 'rename') return deleteNames(text);
      const resolved = resolveStatements({
        statements: [...contracts.renames, { verb: 'rename', text }],
        origin: { kind: 'contract', contract: contracts.origin },
        destination: contracts.destination,
      });
      if (!resolved.ok) return `${resolved.failure.message}. ${resolved.failure.why ?? ''}`.trim();
      const statement = resolved.value.at(-1);
      return statement !== undefined && sameCoordinate(statement, loss.subject)
        ? undefined
        : `The rename's old name is not "${subject}". Write it as ${subject}:<new name>.`;
    },
  };
}

/** The question for one operation that would widen who can read or write its subject's rows. */
export function accessWideningQuestion(
  widening: PlannedSubject,
  contracts: StatementContracts,
): PlanQuestion {
  const subject = subjectText(widening.subject, contracts);
  return {
    question: `${widening.label} would widen who can read and write its rows.`,
    subject,
    verbs: ['allow'],
    forms: {},
    validate: (_verb, text) => namesSubject('allow', subject)(text),
  };
}

/** A subject the user consented to, with the statement's text as its question wrote it. */
export interface ConsentedSubject {
  readonly verb: ConsentVerb;
  readonly subject: MigrationStatementSubject;
  readonly text: string;
}

const keyOf = (planned: PlannedSubject) => JSON.stringify(planned.subject);

/**
 * Asks about every operation of a plan that would lose data and, when `askAccess`, every one that
 * would widen access, until each is answered. A `delete` or `allow` text in `preAnswers`, or
 * `consentAll`, answers its question without asking. A rename typed at the prompt is a statement
 * the plan did not have, so the plan is made again with it, and the loss it answered must be gone.
 * The first round asks even when nothing is in question, so a statement no question consumed is
 * refused before anything is done.
 */
export async function answerPlanQuestions<TPlan extends PlannedQuestions>(input: {
  readonly plan: TPlan;
  readonly askAccess: boolean;
  readonly renames: readonly StatementText[];
  readonly preAnswers: readonly StatementText[];
  readonly consentAll: boolean;
  readonly origin: ContractWithDomain;
  readonly destination: ContractWithDomain;
  readonly answer: AnswerPlanQuestions;
  readonly replan: (
    renames: readonly StatementText[],
  ) => Promise<Result<TPlan, CliStructuredError>>;
}): Promise<
  Result<
    {
      readonly plan: TPlan;
      readonly renames: readonly StatementText[];
      readonly consented: readonly ConsentedSubject[];
    },
    CliStructuredError
  >
> {
  let plan = input.plan;
  let renames = input.renames;
  const consented = new Map<string, ConsentedSubject>();
  for (let round = 0; ; round += 1) {
    const contracts = { origin: input.origin, destination: input.destination, renames };
    const pending = (
      verb: ConsentVerb,
      planned: readonly PlannedSubject[],
    ): readonly PlannedSubject[] => [
      ...new Map(
        planned
          .filter((entry) => !consented.has(`${verb}:${keyOf(entry)}`))
          .map((entry) => [keyOf(entry), entry]),
      ).values(),
    ];
    const consent = (verb: ConsentVerb, entry: PlannedSubject, text: string) =>
      consented.set(`${verb}:${keyOf(entry)}`, { verb, subject: entry.subject, text });
    for (const [verb, entries] of [
      ['delete', pending('delete', plan.dataLoss)],
      ['allow', input.askAccess ? pending('allow', plan.accessWidening) : []],
    ] as const) {
      for (const entry of entries) {
        const text = subjectText(entry.subject, contracts);
        const given = input.preAnswers.some(
          (statement) => statement.verb === verb && statement.text === text,
        );
        if (input.consentAll || given) consent(verb, entry, text);
      }
    }
    const losses = pending('delete', plan.dataLoss);
    const widenings = input.askAccess ? pending('allow', plan.accessWidening) : [];
    if (losses.length + widenings.length === 0 && round > 0) break;
    const questions = [
      ...losses.map((loss) => dataLossQuestion(loss, contracts)),
      ...widenings.map((widening) => accessWideningQuestion(widening, contracts)),
    ];
    const answers = await input.answer(questions);
    const typedRenames: { readonly text: string; readonly loss: PlannedSubject }[] = [];
    answers.forEach((answer, index) => {
      const entry = [...losses, ...widenings][index];
      const question = questions[index];
      if (entry === undefined || question === undefined) return;
      if (answer.verb === 'rename') typedRenames.push({ text: answer.text, loss: entry });
      else consent(answer.verb, entry, question.subject);
    });
    if (typedRenames.length === 0) {
      if (losses.length + widenings.length === 0) break;
      continue;
    }
    renames = [...renames, ...typedRenames.map(({ text }) => ({ verb: 'rename' as const, text }))];
    const replanned = await input.replan(renames);
    if (!replanned.ok) return replanned;
    plan = replanned.value;
    const stillLost = new Set(plan.dataLoss.map(keyOf));
    const unresolved = typedRenames.find(({ loss }) => stillLost.has(keyOf(loss)));
    if (unresolved !== undefined) {
      return notOk(
        errorStatementDidNotResolveLoss(
          { verb: 'rename', text: unresolved.text },
          subjectText(unresolved.loss.subject, contracts),
        ),
      );
    }
  }
  return ok({ plan, renames, consented: [...consented.values()] });
}

import type { ContractWithDomain } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import {
  type MigrationStatementSubject,
  type ModelCoordinate,
  modelDisplayName,
  type ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  errorStatementAnswersNoQuestion,
  errorStatementDidNotResolveLoss,
} from '../../utils/cli-errors';
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

/**
 * Asks every question at once and returns one answer per question, in question order, with a verb
 * and text the question accepts. To refuse, throw. It is called at least once per apply, with an
 * empty list when nothing is in question, including under `acceptDataLoss: true`; return `[]`
 * then.
 */
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

function lossText(subject: MigrationStatementSubject, text: string, originKnown: boolean): string {
  switch (subject.kind) {
    case 'model':
      return `would lose the data of model "${text}"`;
    case 'field':
      return `would lose the values of field "${text}"`;
    case 'storage':
      return originKnown
        ? `would lose the data in "${text}", which no model of the origin contract stores`
        : `would lose the data in "${text}", named by its storage name because the origin contract is unknown. --delete loses its rows. If it was renamed, keep them instead: emit the contract the database is at, run db update --advance-ref <name> to store its snapshot (it changes nothing), then emit the new contract and answer with --rename`;
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

/** Whether the destination still has the subject's model or field, under the name a rename gives it. */
function inDestination(
  subject: MigrationStatementSubject,
  contracts: StatementContracts & { readonly destination: ContractWithDomain },
): boolean {
  if (subject.kind === 'storage') return false;
  const model = renamedModel(subject, contracts) ?? subject;
  const destinationModel =
    contracts.destination.domain.namespaces[model.namespaceId]?.models[model.model];
  if (destinationModel === undefined) return false;
  return subject.kind === 'model' || Object.hasOwn(destinationModel.fields, subject.field);
}

/**
 * The question for one operation that would lose data. A model or field the destination no longer
 * has may be renamed instead of deleted, when the planner can carry out a rename; a rename is
 * resolved against the two contracts after the plan's other renames, and its old name must be the
 * subject. A subject the destination keeps, such as a field whose type changes, and data no model
 * stores, can only be deleted.
 */
export function dataLossQuestion(
  loss: PlannedSubject,
  contracts: StatementContracts & {
    readonly destination: ContractWithDomain;
    readonly originKnown: boolean;
    readonly renamesPlannable: boolean;
  },
): PlanQuestion {
  const subject = subjectText(loss.subject, contracts);
  const renamable =
    contracts.renamesPlannable &&
    loss.subject.kind !== 'storage' &&
    !inDestination(loss.subject, contracts);
  const deleteNames = namesSubject('delete', subject);
  return {
    question: `${loss.label} ${lossText(loss.subject, subject, contracts.originKnown)}.`,
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

function checkAnswers(questions: readonly PlanQuestion[], answers: readonly PlanAnswer[]): void {
  if (answers.length !== questions.length) {
    const noun = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    throw new InternalError(
      `answerQuestions gave ${noun(answers.length, 'answer')} for ${noun(questions.length, 'question')}; answer each question in order, or throw to refuse.`,
      { cause: { questions: questions.map(({ subject }) => subject), answers } },
    );
  }
  questions.forEach((question, index) => {
    const answer = answers[index];
    if (answer === undefined) return;
    const cause = { cause: { question: question.subject, verbs: question.verbs, answer } };
    if (!question.verbs.includes(answer.verb)) {
      throw new InternalError(
        `answerQuestions answered "${question.question}" with ${answer.verb}, which it does not accept; it accepts ${question.verbs.join(' or ')}.`,
        cause,
      );
    }
    const rejected = question.validate(answer.verb, answer.text);
    if (rejected !== undefined) {
      throw new InternalError(
        `answerQuestions answered "${question.question}" wrongly: ${rejected}`,
        cause,
      );
    }
  });
}

/**
 * Asks about every operation of a plan that would lose data and, when `askAccess`, every one that
 * would widen access, until each is answered. A `delete` or `allow` text in `preAnswers`, or
 * `consentAll` for its verb, answers its question without asking. A rename typed at the prompt is a statement
 * the plan did not have, so the plan is made again with it, and the operation it answered must be
 * gone; a loss the new plan has on the same subject, such as a type change on the renamed field,
 * is asked in the next round. The first round asks even when nothing is in question, so a statement no question consumed is
 * refused before anything is done.
 */
export async function answerPlanQuestions<TPlan extends PlannedQuestions, TFailure>(input: {
  readonly plan: TPlan;
  readonly askAccess: boolean;
  readonly renames: readonly StatementText[];
  readonly preAnswers: readonly StatementText[];
  readonly consentAll: { readonly [verb in ConsentVerb]: boolean };
  readonly origin: ContractWithDomain;
  readonly originKnown: boolean;
  readonly renamesPlannable: boolean;
  readonly destination: ContractWithDomain;
  readonly answer: AnswerPlanQuestions;
  readonly replan: (renames: readonly StatementText[]) => Promise<Result<TPlan, TFailure>>;
}): Promise<
  Result<
    {
      readonly plan: TPlan;
      readonly renames: readonly StatementText[];
      readonly consented: readonly ConsentedSubject[];
    },
    TFailure | CliStructuredError
  >
> {
  let plan = input.plan;
  let renames = input.renames;
  const consented = new Map<string, ConsentedSubject>();
  const usedPreAnswers = new Set<StatementText>();
  for (let round = 0; ; round += 1) {
    const contracts = {
      origin: input.origin,
      originKnown: input.originKnown,
      renamesPlannable: input.renamesPlannable,
      destination: input.destination,
      renames,
    };
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
        const given = input.preAnswers.filter(
          (statement) => statement.verb === verb && statement.text === text,
        );
        for (const statement of given) usedPreAnswers.add(statement);
        if (input.consentAll[verb] || given.length > 0) consent(verb, entry, text);
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
    checkAnswers(questions, answers);
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
    const operationOf = (entry: PlannedSubject) => `${entry.label}:${keyOf(entry)}`;
    const stillPlanned = new Set(plan.dataLoss.map(operationOf));
    const unresolved = typedRenames.find(({ loss }) => stillPlanned.has(operationOf(loss)));
    if (unresolved !== undefined) {
      return notOk(
        errorStatementDidNotResolveLoss(
          { verb: 'rename', text: unresolved.text },
          subjectText(unresolved.loss.subject, contracts),
        ),
      );
    }
  }
  const unused = input.preAnswers.filter((statement) => !usedPreAnswers.has(statement));
  if (unused.length > 0) {
    return notOk(
      errorStatementAnswersNoQuestion(
        unused,
        questionSubjects(plan, input.askAccess, { ...input, renames }),
      ),
    );
  }
  return ok({ plan, renames, consented: [...consented.values()] });
}

function questionSubjects(
  plan: PlannedQuestions,
  askAccess: boolean,
  contracts: StatementContracts,
): readonly string[] {
  const subjects = [...plan.dataLoss, ...(askAccess ? plan.accessWidening : [])].map((entry) =>
    subjectText(entry.subject, contracts),
  );
  return [...new Set(subjects)];
}

/**
 * Refuses the `delete` and `allow` statements that name no subject a plan asks about, without
 * asking anything: a run that only plans still says which statements would consent to nothing.
 */
export function refuseUnusedConsents(input: {
  readonly plan: PlannedQuestions;
  readonly statements: readonly StatementText[];
  readonly contracts: StatementContracts;
}): Result<void, CliStructuredError> {
  const subjects = questionSubjects(input.plan, true, input.contracts);
  const matches = (statement: StatementText, entries: readonly PlannedSubject[]) =>
    entries.some((entry) => subjectText(entry.subject, input.contracts) === statement.text);
  const unused = input.statements.filter(
    (statement) =>
      (statement.verb === 'delete' && !matches(statement, input.plan.dataLoss)) ||
      (statement.verb === 'allow' && !matches(statement, input.plan.accessWidening)),
  );
  return unused.length === 0
    ? ok(undefined)
    : notOk(errorStatementAnswersNoQuestion(unused, subjects));
}

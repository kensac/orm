import {
  type ApplicationDomainNamespace,
  asNamespaceId,
  type ContractModelBase,
  type ContractWithDomain,
} from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import type {
  FieldCoordinate,
  ModelCoordinate,
  ResolvedStatement,
} from '@internal/framework-components/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  errorStatementInvalid,
  errorStatementOriginUnknown,
  errorStatementUnresolved,
} from '../../utils/cli-errors';
import { type ParsedRename, parseRenameStatement, type StatementSide } from './parse-rename';

/**
 * The origin contract statements resolve against, or where the command looked
 * for it without finding it.
 */
export type StatementOrigin =
  | { readonly kind: 'contract'; readonly contract: ContractWithDomain }
  | {
      readonly kind: 'missing';
      readonly hash: string | null;
      readonly snapshotDirectory: string;
    };

/**
 * `origin` and `destination` are the application contract space's contracts;
 * names that exist only in an extension space never resolve.
 */
export interface ResolveStatementsInput {
  readonly renames: readonly string[];
  readonly origin: StatementOrigin;
  readonly destination: ContractWithDomain;
}

type Side = 'old' | 'new';

interface NamedContract {
  readonly name: 'origin' | 'destination';
  readonly contract: ContractWithDomain;
}

interface FoundModel {
  readonly coordinate: ModelCoordinate;
  readonly model: ContractModelBase;
}

type ModelLookup =
  | ({ readonly kind: 'found' } & FoundModel)
  | { readonly kind: 'missing' | 'refused'; readonly reason: string };

interface ModelReading extends FoundModel {
  readonly entity: 'model';
}

interface FieldReading {
  readonly entity: 'field';
  readonly coordinate: FieldCoordinate;
  readonly model: ContractModelBase;
  readonly destinationModel: ModelCoordinate | undefined;
}

type SideReading = ModelReading | FieldReading;

interface ResolutionState {
  readonly origin: NamedContract;
  readonly destination: NamedContract;
  readonly originOfRenamedModel: Map<string, ModelCoordinate>;
  readonly renamedFrom: Set<string>;
  readonly renamedTo: Set<string>;
}

const MODEL_RENAMES = 'model';
const FIELD_RENAMES = 'field';

function qualifiedModel(coordinate: ModelCoordinate): string {
  return `${coordinate.namespace}.${coordinate.model}`;
}

function qualifiedField(coordinate: FieldCoordinate): string {
  return `${qualifiedModel(coordinate)}.${coordinate.field}`;
}

function listed(names: readonly string[]): string {
  return names.length === 0 ? '(none)' : [...names].sort().join(', ');
}

function sentence(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
}

function modelIn(
  namespace: ApplicationDomainNamespace,
  name: string,
): ContractModelBase | undefined {
  return Object.hasOwn(namespace.models, name) ? namespace.models[name] : undefined;
}

function hasValueObject(namespace: ApplicationDomainNamespace, name: string): boolean {
  return namespace.valueObjects !== undefined && Object.hasOwn(namespace.valueObjects, name);
}

function modelAt(
  contract: ContractWithDomain,
  coordinate: ModelCoordinate,
): ContractModelBase | undefined {
  const namespaces = contract.domain.namespaces;
  const namespace = Object.hasOwn(namespaces, coordinate.namespace)
    ? namespaces[coordinate.namespace]
    : undefined;
  return namespace === undefined ? undefined : modelIn(namespace, coordinate.model);
}

function fieldNames(model: ContractModelBase): readonly string[] {
  return [...Object.keys(model.fields), ...Object.keys(model.relations)];
}

function hasField(model: ContractModelBase, field: string): boolean {
  return Object.hasOwn(model.fields, field) || Object.hasOwn(model.relations, field);
}

function valueObjectReason(name: string): string {
  return `"${name}" is a value object, and value object renames are not supported in this release`;
}

function lookupModelInNamespace(
  contract: NamedContract,
  namespaceId: string,
  namespace: ApplicationDomainNamespace,
  name: string,
): ModelLookup {
  const model = modelIn(namespace, name);
  if (model !== undefined) {
    return {
      kind: 'found',
      coordinate: { namespace: asNamespaceId(namespaceId), model: name },
      model,
    };
  }
  if (hasValueObject(namespace, name)) {
    return { kind: 'refused', reason: valueObjectReason(`${namespaceId}.${name}`) };
  }
  return {
    kind: 'missing',
    reason: `the ${contract.name} contract has no model "${name}" in namespace "${namespaceId}" (models there: ${listed(Object.keys(namespace.models))})`,
  };
}

function lookupModel(
  contract: NamedContract,
  namespaceId: string | undefined,
  name: string,
): ModelLookup {
  const namespaces = contract.contract.domain.namespaces;
  if (namespaceId !== undefined) {
    const namespace = Object.hasOwn(namespaces, namespaceId) ? namespaces[namespaceId] : undefined;
    if (namespace === undefined) {
      return {
        kind: 'missing',
        reason: `the ${contract.name} contract has no namespace "${namespaceId}" (namespaces: ${listed(Object.keys(namespaces))})`,
      };
    }
    return lookupModelInNamespace(contract, namespaceId, namespace, name);
  }
  const declaring = Object.entries(namespaces).filter(
    ([, namespace]) => modelIn(namespace, name) !== undefined,
  );
  const [only] = declaring;
  if (only !== undefined && declaring.length === 1) {
    return lookupModelInNamespace(contract, only[0], only[1], name);
  }
  if (declaring.length > 1) {
    const candidates = declaring.map(([id]) => `${id}.${name}`);
    return {
      kind: 'refused',
      reason: `"${name}" is a model in more than one namespace of the ${contract.name} contract (${listed(candidates)}); name it with its namespace`,
    };
  }
  if (Object.values(namespaces).some((namespace) => hasValueObject(namespace, name))) {
    return { kind: 'refused', reason: valueObjectReason(name) };
  }
  const models = Object.entries(namespaces).flatMap(([id, namespace]) =>
    Object.keys(namespace.models).map((model) => `${id}.${model}`),
  );
  return {
    kind: 'missing',
    reason: `the ${contract.name} contract has no model "${name}" (models: ${listed(models)})`,
  };
}

function readModel(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  name: string,
): Result<ModelReading, string> {
  const lookup = lookupModel(side === 'old' ? state.origin : state.destination, namespaceId, name);
  if (lookup.kind !== 'found') return notOk(lookup.reason);
  return ok({ entity: 'model', coordinate: lookup.coordinate, model: lookup.model });
}

function readFieldOf(
  contract: NamedContract,
  found: FoundModel,
  field: string,
  destinationModel: ModelCoordinate | undefined,
): Result<FieldReading, string> {
  if (!hasField(found.model, field)) {
    return notOk(
      `the ${contract.name} model "${qualifiedModel(found.coordinate)}" has no field "${field}" (fields: ${listed(fieldNames(found.model))})`,
    );
  }
  return ok({
    entity: 'field',
    coordinate: { ...found.coordinate, field },
    model: found.model,
    destinationModel,
  });
}

function originCounterpart(
  state: ResolutionState,
  destinationModel: ModelCoordinate,
): FoundModel | undefined {
  const coordinate =
    state.originOfRenamedModel.get(qualifiedModel(destinationModel)) ?? destinationModel;
  const model = modelAt(state.origin.contract, coordinate);
  return model === undefined ? undefined : { coordinate, model };
}

/**
 * The old side of a field rename names the model as the destination spells
 * it, and the field as the origin counterpart of that model has it. When the
 * model is not in the destination but the origin has it with that field, the
 * reading still resolves so the caller can say the field would move between
 * models.
 */
function readOldField(
  state: ResolutionState,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, string> {
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind === 'found') {
    const counterpart = originCounterpart(state, destination.coordinate);
    if (counterpart === undefined) {
      const name = qualifiedModel(destination.coordinate);
      return notOk(
        `the destination model "${name}" has no counterpart in the origin contract: the origin has no model "${name}" and no earlier statement renames a model to it`,
      );
    }
    return readFieldOf(state.origin, counterpart, field, destination.coordinate);
  }
  if (destination.kind === 'refused') return notOk(destination.reason);
  const origin = lookupModel(state.origin, namespaceId, modelName);
  if (origin.kind === 'found' && hasField(origin.model, field)) {
    return readFieldOf(state.origin, origin, field, undefined);
  }
  return notOk(destination.reason);
}

function readNewField(
  state: ResolutionState,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, string> {
  const destination = lookupModel(state.destination, namespaceId, modelName);
  if (destination.kind !== 'found') return notOk(destination.reason);
  return readFieldOf(state.destination, destination, field, destination.coordinate);
}

function readField(
  state: ResolutionState,
  side: Side,
  namespaceId: string | undefined,
  modelName: string,
  field: string,
): Result<FieldReading, string> {
  return side === 'old'
    ? readOldField(state, namespaceId, modelName, field)
    : readNewField(state, namespaceId, modelName, field);
}

function readSide(
  state: ResolutionState,
  side: Side,
  segments: StatementSide,
): Result<SideReading, string> {
  if (segments.length === 1) return readModel(state, side, undefined, segments[0]);
  if (segments.length === 3) return readField(state, side, ...segments);
  const [first, second] = segments;
  const asModel = readModel(state, side, first, second);
  const asField = readField(state, side, undefined, first, second);
  if (asModel.ok && asField.ok) {
    return notOk(
      `"${first}.${second}" resolves both as namespace "${first}" model "${second}" and as model "${first}" field "${second}"; write the field as namespace.Model.field if you mean the field`,
    );
  }
  if (asModel.ok) return asModel;
  if (asField.ok) return asField;
  return notOk(
    `"${first}.${second}" resolves neither as namespace.Model (${asModel.failure}) nor as Model.field (${asField.failure})`,
  );
}

function resolveModelRename(
  state: ResolutionState,
  text: string,
  from: ModelCoordinate,
  to: ModelCoordinate,
): Result<ResolvedStatement, CliStructuredError> {
  const fromKey = `${MODEL_RENAMES}:${qualifiedModel(from)}`;
  const toKey = `${MODEL_RENAMES}:${qualifiedModel(to)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        text,
        `An earlier statement already renames "${qualifiedModel(from)}".`,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        text,
        `An earlier statement already renames a model to "${qualifiedModel(to)}".`,
      ),
    );
  }
  if (modelAt(state.origin.contract, to) !== undefined) {
    return notOk(
      errorStatementUnresolved(
        text,
        `"${qualifiedModel(to)}" already exists in the origin contract, so it cannot be the new name of a model.`,
      ),
    );
  }
  if (modelAt(state.destination.contract, from) !== undefined) {
    return notOk(
      errorStatementUnresolved(
        text,
        `"${qualifiedModel(from)}" still exists in the destination contract, so it was not renamed.`,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  state.originOfRenamedModel.set(qualifiedModel(to), from);
  return ok({ kind: 'rename', entity: 'model', from, to });
}

function resolveFieldRename(
  state: ResolutionState,
  text: string,
  from: FieldReading,
  to: FieldReading,
): Result<ResolvedStatement, CliStructuredError> {
  const toModel = qualifiedModel(to.coordinate);
  if (from.destinationModel === undefined || qualifiedModel(from.destinationModel) !== toModel) {
    return notOk(
      errorStatementInvalid(
        text,
        `The old name is a field of "${qualifiedModel(from.destinationModel ?? from.coordinate)}" and the new name a field of "${toModel}"; a field cannot move between models.`,
      ),
    );
  }
  const fromKey = `${FIELD_RENAMES}:${qualifiedField(from.coordinate)}`;
  const toKey = `${FIELD_RENAMES}:${qualifiedField(to.coordinate)}`;
  if (state.renamedFrom.has(fromKey)) {
    return notOk(
      errorStatementInvalid(
        text,
        `An earlier statement already renames "${qualifiedField(from.coordinate)}".`,
      ),
    );
  }
  if (state.renamedTo.has(toKey)) {
    return notOk(
      errorStatementInvalid(
        text,
        `An earlier statement already renames a field to "${qualifiedField(to.coordinate)}".`,
      ),
    );
  }
  if (hasField(from.model, to.coordinate.field)) {
    return notOk(
      errorStatementUnresolved(
        text,
        `The field "${to.coordinate.field}" already exists on the origin model "${qualifiedModel(from.coordinate)}", so it cannot be the new name of a field.`,
      ),
    );
  }
  if (hasField(to.model, from.coordinate.field)) {
    return notOk(
      errorStatementUnresolved(
        text,
        `The field "${from.coordinate.field}" still exists on the destination model "${toModel}", so it was not renamed.`,
      ),
    );
  }
  state.renamedFrom.add(fromKey);
  state.renamedTo.add(toKey);
  return ok({ kind: 'rename', entity: 'field', from: from.coordinate, to: to.coordinate });
}

function resolveStatement(
  state: ResolutionState,
  statement: ParsedRename,
): Result<ResolvedStatement, CliStructuredError> {
  const from = readSide(state, 'old', statement.from);
  if (!from.ok) return notOk(errorStatementUnresolved(statement.text, sentence(from.failure)));
  const to = readSide(state, 'new', statement.to);
  if (!to.ok) return notOk(errorStatementUnresolved(statement.text, sentence(to.failure)));
  if (from.value.entity === 'model' && to.value.entity === 'model') {
    return resolveModelRename(state, statement.text, from.value.coordinate, to.value.coordinate);
  }
  if (from.value.entity === 'field' && to.value.entity === 'field') {
    return resolveFieldRename(state, statement.text, from.value, to.value);
  }
  return notOk(
    errorStatementInvalid(
      statement.text,
      'The statement names a model on one side and a field on the other.',
    ),
  );
}

/**
 * Resolves the `--rename` statements a user gave, in order, against the
 * origin and destination contracts. Each resolved statement names its old and
 * new entity by namespace, model and field.
 */
export function resolveStatements(
  input: ResolveStatementsInput,
): Result<readonly ResolvedStatement[], CliStructuredError> {
  if (input.renames.length === 0) return ok([]);
  if (input.origin.kind === 'missing') {
    return notOk(errorStatementOriginUnknown(input.origin));
  }
  const state: ResolutionState = {
    origin: { name: 'origin', contract: input.origin.contract },
    destination: { name: 'destination', contract: input.destination },
    originOfRenamedModel: new Map(),
    renamedFrom: new Set(),
    renamedTo: new Set(),
  };
  const resolved: ResolvedStatement[] = [];
  for (const text of input.renames) {
    const parsed = parseRenameStatement(text);
    if (!parsed.ok) return parsed;
    const statement = resolveStatement(state, parsed.value);
    if (!statement.ok) return statement;
    resolved.push(statement.value);
  }
  return ok(resolved);
}

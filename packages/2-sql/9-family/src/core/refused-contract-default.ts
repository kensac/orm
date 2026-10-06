import { sqlFamilyError } from './errors';

/**
 * Refuses to plan a column whose contract default its data type does not store, with the refusal
 * `contractDefaultRefusal` gives.
 */
export function refuseContractDefault(column: string, refusal: string): never {
  throw sqlFamilyError('CONTRACT.DEFAULT_INVALID', `Column "${column}": ${refusal}`, {
    meta: { reason: 'default-not-canonical', column },
  });
}

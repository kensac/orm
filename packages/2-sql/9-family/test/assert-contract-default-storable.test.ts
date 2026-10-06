import type { JsonValue } from '@internal/contract/types';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { assertContractDefaultStorable } from '../src/core/assert-contract-default-storable';

const utcOnly = (value: JsonValue): JsonValue => {
  if (typeof value === 'string' && value.endsWith('Z')) return value;
  throw structuredError('CONTRACT.CAST_REFUSED', `${JSON.stringify(value)} has no UTC offset.`);
};

describe('assertContractDefaultStorable', () => {
  it('throws CONTRACT.DEFAULT_INVALID naming the column when the data type refuses the default', () => {
    expect(() =>
      assertContractDefaultStorable(
        'at',
        { kind: 'literal', value: '2024-01-01T00:00:00' },
        utcOnly,
        false,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Column "at": The contract holds this default in a form its data type does not store: "2024-01-01T00:00:00" has no UTC offset. Re-emit the contract, then try again.',
        meta: { reason: 'default-not-canonical', column: 'at' },
      }),
    );
  });

  it('refuses a list default by its first refused element', () => {
    expect(() =>
      assertContractDefaultStorable(
        'at',
        { kind: 'literal', value: ['2024-01-01T00:00:00Z', '2024-01-01'] },
        utcOnly,
        true,
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.DEFAULT_INVALID' }));
  });

  it.each([
    ['a default the type holds', { kind: 'literal', value: '2024-01-01T00:00:00Z' }],
    ['a function default', { kind: 'function', expression: 'now()' }],
  ] as const)('accepts %s', (_name, columnDefault) => {
    expect(() => assertContractDefaultStorable('at', columnDefault, utcOnly, false)).not.toThrow();
  });
});

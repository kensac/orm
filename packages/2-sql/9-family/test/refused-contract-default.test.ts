import { describe, expect, it } from 'vitest';
import { refuseContractDefault } from '../src/core/refused-contract-default';

describe('refuseContractDefault', () => {
  it('throws CONTRACT.DEFAULT_INVALID naming the column, with the refusal as the message', () => {
    expect(() => refuseContractDefault('at', 'The contract holds this default ...')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message: 'Column "at": The contract holds this default ...',
        meta: { reason: 'default-not-canonical', column: 'at' },
      }),
    );
  });
});

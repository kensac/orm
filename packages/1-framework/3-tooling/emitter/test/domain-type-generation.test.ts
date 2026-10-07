import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  generateRootsType,
  serializeExecutionType,
  serializeObjectKey,
  serializeValue,
} from '../src/domain-type-generation';

describe('serializeValue', () => {
  it('serializes null', () => {
    expect(serializeValue(null)).toBe('null');
  });

  it('serializes undefined', () => {
    expect(serializeValue(undefined)).toBe('undefined');
  });

  it('serializes strings as double-quoted literals', () => {
    expect(serializeValue('hello')).toBe('"hello"');
  });

  it('escapes backslashes and double quotes in strings', () => {
    expect(serializeValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(serializeValue("it's")).toBe('"it\'s"');
    expect(serializeValue('back\\slash')).toBe('"back\\\\slash"');
  });

  it('serializes numbers', () => {
    expect(serializeValue(42)).toBe('42');
    expect(serializeValue(3.14)).toBe('3.14');
  });

  it('serializes booleans', () => {
    expect(serializeValue(true)).toBe('true');
    expect(serializeValue(false)).toBe('false');
  });

  it('serializes bigints', () => {
    expect(serializeValue(BigInt(123))).toBe('123n');
  });

  it('serializes arrays as readonly tuples', () => {
    expect(serializeValue(['a', 'b'])).toBe('readonly ["a", "b"]');
  });

  it('serializes objects with readonly properties', () => {
    expect(serializeValue({ key: 'val' })).toBe('{ readonly key: "val" }');
  });

  it('serializes nested objects', () => {
    const result = serializeValue({ a: { b: 1 } });
    expect(result).toBe('{ readonly a: { readonly b: 1 } }');
  });

  it('returns unknown for unsupported types', () => {
    expect(serializeValue(Symbol('test'))).toBe('unknown');
  });

  describe('injection safety', () => {
    // Lock the escape behavior so attacker-controlled (or merely weird) strings in a schema.prisma cannot break out of the emitted double-quoted literal and inject arbitrary TypeScript into contract.d.ts.

    it('escapes a string attempting to terminate the literal', () => {
      const injected = 'x"; export let foo = "bar';
      const serialized = serializeValue(injected);
      expect(serialized).toBe('"x\\"; export let foo = \\"bar"');
      // The serialized form is a single valid string literal: exactly two outer double quotes, and every inner double quote is backslash-escaped.
      expect(serialized.match(/(?<!\\)"/g)?.length).toBe(2);
    });

    it('escapes backslash-terminated strings (no lookahead break-out)', () => {
      expect(serializeValue('ends with \\')).toBe('"ends with \\\\"');
      expect(serializeValue('double\\\\back')).toBe('"double\\\\\\\\back"');
    });

    it('escapes control characters and line separators', () => {
      // Raw line terminators inside a quoted literal are a syntax error,
      // and U+2028/U+2029 terminate lines in legacy parsers.
      expect(serializeValue('a\u2028b')).toBe('"a\\u2028b"');
      expect(serializeValue('a\u2029b')).toBe('"a\\u2029b"');
      expect(serializeValue('a\nb')).toBe('"a\\nb"');
      expect(serializeValue('a\rb')).toBe('"a\\rb"');
      expect(serializeValue('a\tb')).toBe('"a\\tb"');
      expect(serializeValue('ab')).toBe('"a\\u0007b"');
    });

    it('quotes object keys that look like identifier bypass attempts', () => {
      expect(serializeObjectKey('k"; injected: "v')).toBe('"k\\"; injected: \\"v"');
      expect(serializeObjectKey('')).toBe('""');
    });
  });
});

describe('serializeObjectKey', () => {
  it('passes through valid identifiers', () => {
    expect(serializeObjectKey('foo')).toBe('foo');
    expect(serializeObjectKey('_bar')).toBe('_bar');
    expect(serializeObjectKey('$baz')).toBe('$baz');
    expect(serializeObjectKey('camelCase')).toBe('camelCase');
  });

  it('quotes keys with special characters', () => {
    expect(serializeObjectKey('has space')).toBe('"has space"');
    expect(serializeObjectKey('has-dash')).toBe('"has-dash"');
    expect(serializeObjectKey('ns/name@1')).toBe('"ns/name@1"');
    expect(serializeObjectKey('has\nnewline')).toBe('"has\\nnewline"');
    expect(serializeObjectKey('1leading-digit')).toBe('"1leading-digit"');
  });
});

describe('serializeExecutionType', () => {
  it('uses ExecutionHash alias instead of literal hash value', () => {
    const result = serializeExecutionType({
      executionHash: 'abc123',
      mutations: { defaults: [] },
    });
    expect(result).toContain('readonly executionHash: ExecutionHash');
    expect(result).not.toContain('abc123');
  });

  it('serializes non-hash fields normally', () => {
    const result = serializeExecutionType({
      executionHash: 'abc123',
      mutations: { defaults: [{ kind: 'autoIncrement' }] },
    });
    expect(result).toContain('readonly mutations:');
    expect(result).toContain('readonly kind: "autoIncrement"');
  });
});

describe('serializeCrossReference with space', () => {
  it('includes the space discriminator when the ref carries one', () => {
    const result = generateRootsType({ user: crossRef('User', 'public', 'authSpace') });
    expect(result).toContain('readonly space: "authSpace"');
  });
});

describe('serializeValue object key order', () => {
  it('sorts object keys, so the literal type does not depend on how the value was built', () => {
    expect(serializeValue({ field: 'email', direction: 1 })).toBe(
      serializeValue({ direction: 1, field: 'email' }),
    );
    expect(serializeValue({ field: 'email', direction: 1 })).toBe(
      '{ readonly direction: 1; readonly field: "email" }',
    );
  });

  it('keeps array order, which is meaningful', () => {
    expect(serializeValue([{ b: 1 }, { a: 2 }])).toBe(
      'readonly [{ readonly b: 1 }, { readonly a: 2 }]',
    );
  });
});

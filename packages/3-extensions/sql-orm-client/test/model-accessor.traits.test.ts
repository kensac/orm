import { createSqlOperationRegistry } from '@internal/sql-operations';
import type { CodecTrait } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import { context, makeDescriptors } from './model-accessor-helpers';

describe('createModelAccessor', () => {
  describe('runtime trait-gating', () => {
    it('only creates equality methods when codec has equality trait', () => {
      const codecDescriptors = makeDescriptors({ 'pg/int4@1': ['equality'] });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'public', 'Post');
      const field = accessor['id'] as unknown as Record<string, unknown>;

      expect(typeof field['eq']).toBe('function');
      expect(typeof field['neq']).toBe('function');
      expect(typeof field['in']).toBe('function');
      expect(typeof field['notIn']).toBe('function');
      expect(typeof field['isNull']).toBe('function');
      expect(typeof field['isNotNull']).toBe('function');

      expect(field['gt']).toBeUndefined();
      expect(field['lt']).toBeUndefined();
      expect(field['gte']).toBeUndefined();
      expect(field['lte']).toBeUndefined();
      expect(field['like']).toBeUndefined();
      expect(field['asc']).toBeUndefined();
      expect(field['desc']).toBeUndefined();
    });

    it('creates all methods when codec has all relevant traits', () => {
      const codecDescriptors = makeDescriptors({
        'pg/text@1': ['equality', 'order', 'textual'],
      });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'public', 'User');
      const field = accessor['name'] as unknown as Record<string, unknown>;

      for (const method of [
        'eq',
        'neq',
        'gt',
        'lt',
        'gte',
        'lte',
        'like',
        'in',
        'notIn',
        'isNull',
        'isNotNull',
        'asc',
        'desc',
      ]) {
        expect(typeof field[method]).toBe('function');
      }
    });

    it('throws when relation shorthand filter targets a field without equality trait', () => {
      const codecDescriptors = makeDescriptors({ 'pg/int4@1': ['order'] });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'public', 'Post');

      expect(() => accessor['comments']!.some({ postId: 42 })).toThrow(
        /does not support equality comparisons/,
      );
    });
  });

  describe('extension operations', () => {
    it('attaches trait-targeted op only when codec traits are a superset of required traits', () => {
      const queryOperations = createSqlOperationRegistry();
      queryOperations.register('synthetic', {
        self: { traits: ['equality', 'textual'] },
        impl: () => undefined as never,
      });

      const traitsByCodec: Record<string, readonly CodecTrait[]> = {
        'pg/text@1': ['equality', 'textual'],
        'pg/int4@1': ['equality'],
        'pg/bool@1': ['equality', 'boolean'],
      };
      const codecDescriptors = makeDescriptors(traitsByCodec);

      const ctx = { ...context, queryOperations, codecDescriptors };
      const user = createModelAccessor(ctx, 'public', 'User');
      const post = createModelAccessor(ctx, 'public', 'Post');

      const name = user['name'] as unknown as Record<string, unknown>;
      expect(typeof name['synthetic']).toBe('function');

      const views = post['views'] as unknown as Record<string, unknown>;
      expect(views['synthetic']).toBeUndefined();
    });

    it('attaches an operation without self to no field', () => {
      const queryOperations = createSqlOperationRegistry();
      queryOperations.register('attached', {
        self: { traits: ['textual'] },
        impl: () => undefined as never,
      });
      queryOperations.register('selfless', { impl: () => undefined as never });

      const codecDescriptors = makeDescriptors({ 'pg/text@1': ['equality', 'textual'] });
      const user = createModelAccessor(
        { ...context, queryOperations, codecDescriptors },
        'public',
        'User',
      );

      const name = user['name'] as unknown as Record<string, unknown>;
      expect(typeof name['attached']).toBe('function');
      expect(name['selfless']).toBeUndefined();
    });
  });
});

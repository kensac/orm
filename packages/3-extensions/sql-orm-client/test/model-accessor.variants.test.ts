import {
  BinaryExpr,
  ColumnRef,
  type ExistsExpr,
  ParamRef,
  ProjectionItem,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import { buildMixedPolyContract } from './helpers';
import { context } from './model-accessor-helpers';
import { unboundTables } from './unbound-tables';

describe('createModelAccessor', () => {
  describe('variant-aware field resolution', () => {
    const polyContext = { ...context, contract: buildMixedPolyContract() };

    // Codecs come from the patched poly contract's storage, not the base
    // test contract that the outer `paramRef` helper reads.
    function polyParam(table: string, column: string, value: unknown): ParamRef {
      const tables = unboundTables(polyContext.contract.storage) as Record<
        string,
        { columns: Record<string, { codecId?: string }> } | undefined
      >;
      const codecId = tables[table]?.columns[column]?.codecId;
      return codecId ? ParamRef.of(value, { codec: { codecId } }) : ParamRef.of(value);
    }

    // The base `Task` accessor type carries only base fields; the patched poly
    // contract adds variant columns at runtime. View the accessor as a bag of
    // comparison methods so the runtime resolution can be asserted regardless
    // of the static base type.
    interface FieldOps {
      eq(value: unknown): unknown;
      gte(value: unknown): unknown;
    }
    type FieldBag = Record<string, FieldOps | undefined>;

    it('resolves an MTI variant column against the joined variant table', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as FieldBag;
      // `priority` lives on the joined `features` table, not the base `tasks`.
      expect(feature['priority']!.gte(3)).toEqual(
        new BinaryExpr(
          'gte',
          ColumnRef.of('features', 'priority'),
          polyParam('features', 'priority', 3),
        ),
      );
    });

    it('keeps base columns qualified against the base table when a variant is selected', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as FieldBag;
      expect(feature['title']!.eq('Dark mode')).toEqual(
        new BinaryExpr(
          'eq',
          ColumnRef.of('tasks', 'title'),
          polyParam('tasks', 'title', 'Dark mode'),
        ),
      );
    });

    it('does not expose another variant column for the selected variant', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as FieldBag;
      expect(feature['priority']).toBeDefined();
      const bug = createModelAccessor(polyContext, 'public', 'Task', 'Bug') as unknown as FieldBag;
      // Bug is STI — its `severity` rides the base table, never the features join.
      expect(bug['severity']!.eq('critical')).toEqual(
        new BinaryExpr(
          'eq',
          ColumnRef.of('tasks', 'severity'),
          polyParam('tasks', 'severity', 'critical'),
        ),
      );
      // Selecting an STI variant must not surface the MTI variant column.
      expect(bug['priority']).toBeUndefined();
    });

    it('leaves base resolution untouched when no variant is selected', () => {
      const task = createModelAccessor(polyContext, 'public', 'Task') as unknown as FieldBag;
      expect(task['title']!.eq('x')).toEqual(
        new BinaryExpr('eq', ColumnRef.of('tasks', 'title'), polyParam('tasks', 'title', 'x')),
      );
      // Without a selected variant the MTI variant column is not resolvable.
      expect(task['priority']).toBeUndefined();
    });
  });

  describe('variant-aware relation resolution', () => {
    const polyContext = { ...context, contract: buildMixedPolyContract() };

    interface RelationOps {
      some(predicate?: unknown): unknown;
    }
    type RelationBag = Record<string, RelationOps | undefined>;

    it('correlates an MTI variant relation predicate against the variant table', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as RelationBag;

      const expr = feature['assignee']!.some() as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.from).toEqual(TableSource.named('assignees', undefined, 'public'));
      expect(expr.subquery.projection).toEqual([
        ProjectionItem.of('_exists', ColumnRef.of('assignees', 'id')),
      ]);
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('assignees', 'id'), ColumnRef.of('features', 'assignee_id')),
      );
    });

    it('correlates an STI variant relation predicate against the base table', () => {
      const bug = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Bug',
      ) as unknown as RelationBag;

      const expr = bug['assignee']!.some() as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.from).toEqual(TableSource.named('assignees', undefined, 'public'));
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('assignees', 'id'), ColumnRef.of('tasks', 'assignee_id')),
      );
    });

    it('does not expose the variant-declared relation without narrowing', () => {
      const task = createModelAccessor(polyContext, 'public', 'Task') as unknown as RelationBag;
      expect(task['assignee']).toBeUndefined();
    });

    it('keeps a base relation resolving against the base table when a variant is selected', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as RelationBag;

      const expr = feature['subtasks']!.some() as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('tasks', '__orm_rel_1', 'public'));
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'parent_id'), ColumnRef.of('tasks', 'id')),
      );
    });

    it('does not consume an alias when resolving an already joined variant source', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as RelationBag;

      feature['assignee']!.some();
      const expr = feature['subtasks']!.some() as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('tasks', '__orm_rel_1', 'public'));
    });
  });
});

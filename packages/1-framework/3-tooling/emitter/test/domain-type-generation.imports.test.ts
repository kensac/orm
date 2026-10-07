import type { TypesImportSpec } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import {
  deduplicateImports,
  generateCodecTypeIntersection,
  generateHashTypeAliases,
  generateImportLines,
} from '../src/domain-type-generation';

describe('deduplicateImports', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateImports([])).toEqual([]);
  });

  it('keeps unique imports', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'A' },
      { package: 'pkg-b', named: 'CodecTypes', alias: 'B' },
    ];
    expect(deduplicateImports(imports)).toHaveLength(2);
  });

  it('deduplicates by package+named (first wins)', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'First' },
      { package: 'pkg-a', named: 'CodecTypes', alias: 'Second' },
    ];
    const result = deduplicateImports(imports);
    expect(result).toHaveLength(1);
    expect(result[0]!.alias).toBe('First');
  });

  it('preserves insertion order', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-b', named: 'X', alias: 'X' },
      { package: 'pkg-a', named: 'Y', alias: 'Y' },
    ];
    const result = deduplicateImports(imports);
    expect(result[0]!.package).toBe('pkg-b');
    expect(result[1]!.package).toBe('pkg-a');
  });
});

describe('generateImportLines', () => {
  it('generates import with alias', () => {
    const imports: TypesImportSpec[] = [
      { package: '@internal/adapter', named: 'CodecTypes', alias: 'PgCodecTypes' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual(["import type { CodecTypes as PgCodecTypes } from '@internal/adapter';"]);
  });

  it('simplifies import when named === alias', () => {
    const imports: TypesImportSpec[] = [
      { package: '@internal/adapter', named: 'Vector', alias: 'Vector' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual(["import type { Vector } from '@internal/adapter';"]);
  });

  it('merges multiple named imports from the same package onto one line', () => {
    const imports: TypesImportSpec[] = [
      {
        package: '@test/mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      { package: '@test/mongo/codec-types', named: 'Vector', alias: 'Vector' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual([
      "import type { CodecTypes as MongoCodecTypes, Vector } from '@test/mongo/codec-types';",
    ]);
  });

  it('emits one line per distinct package, sorted by specifier', () => {
    const imports: TypesImportSpec[] = [
      { package: '@scope/zeta/codec-types', named: 'Numeric', alias: 'Numeric' },
      { package: '@scope/zeta/codec-types', named: 'CodecTypes', alias: 'ZetaTypes' },
      { package: '@scope/alpha/operation-types', named: 'QueryOperationTypes', alias: 'AlphaOps' },
    ];
    const lines = generateImportLines(imports);
    expect(lines).toEqual([
      "import type { QueryOperationTypes as AlphaOps } from '@scope/alpha/operation-types';",
      "import type { CodecTypes as ZetaTypes, Numeric } from '@scope/zeta/codec-types';",
    ]);
  });
});

describe('generateCodecTypeIntersection', () => {
  it('returns Record<string, never> when no matching imports', () => {
    expect(generateCodecTypeIntersection([], 'CodecTypes')).toBe('Record<string, never>');
  });

  it('returns single alias when one match', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg', named: 'CodecTypes', alias: 'PgCodecTypes' },
    ];
    expect(generateCodecTypeIntersection(imports, 'CodecTypes')).toBe('PgCodecTypes');
  });

  it('returns intersection when multiple matches', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg-a', named: 'CodecTypes', alias: 'A' },
      { package: 'pkg-b', named: 'CodecTypes', alias: 'B' },
    ];
    expect(generateCodecTypeIntersection(imports, 'CodecTypes')).toBe('A & B');
  });

  it('filters by named parameter', () => {
    const imports: TypesImportSpec[] = [
      { package: 'pkg', named: 'CodecTypes', alias: 'CT' },
      { package: 'pkg', named: 'OperationTypes', alias: 'OT' },
    ];
    expect(generateCodecTypeIntersection(imports, 'OperationTypes')).toBe('OT');
  });
});

describe('generateHashTypeAliases', () => {
  it('generates storage and profile hash aliases', () => {
    const result = generateHashTypeAliases({
      storageHash: 'abc123',
      profileHash: 'def456',
    });
    expect(result).toContain('StorageHashBase<"abc123">');
    expect(result).toContain('ProfileHashBase<"def456">');
  });

  it('generates concrete execution hash when provided', () => {
    const result = generateHashTypeAliases({
      storageHash: 'abc',
      executionHash: 'exec',
      profileHash: 'prof',
    });
    expect(result).toContain('ExecutionHashBase<"exec">');
  });

  it('generates generic execution hash when not provided', () => {
    const result = generateHashTypeAliases({
      storageHash: 'abc',
      profileHash: 'prof',
    });
    expect(result).toContain('ExecutionHashBase<string>');
  });
});

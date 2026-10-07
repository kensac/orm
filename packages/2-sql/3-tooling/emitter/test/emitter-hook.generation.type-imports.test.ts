import { extractCodecTypeImports } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { TestDescriptor } from './emitter-hook-generation-helpers';

describe('sql-target-family-hook', () => {
  it('gets types imports with multiple extensions', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
      {
        kind: 'extension',
        id: 'test-extension',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/extension/codec-types',
              named: 'CodecTypes',
              alias: 'ExtensionTypes',
            },
          },
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports.length).toBe(2);
    expect(codecImports[0]?.package).toBe('@test/adapter/codec-types');
    expect(codecImports[1]?.package).toBe('@test/extension/codec-types');
  });

  it('gets types imports with descriptors without codecTypes', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports.length).toBe(0);
  });

  it('gets types imports using extractCodecTypeImports', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports).toEqual([
      { package: '@test/adapter/codec-types', named: 'CodecTypes', alias: 'TestTypes' },
    ]);
  });
});

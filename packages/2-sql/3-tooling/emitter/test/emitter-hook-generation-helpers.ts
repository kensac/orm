import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';

export type TestDescriptor = TargetBoundComponentDescriptor<'sql', string>;

export const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

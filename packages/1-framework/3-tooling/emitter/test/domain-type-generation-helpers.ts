import type { Codec, CodecLookup } from '@internal/framework-components/codec';

type CodecStub = Codec & {
  readonly renderOutputType?: (params: Record<string, unknown>) => string | undefined;
};

export function stubCodec(overrides: Partial<CodecStub> & { id: string }): CodecStub {
  return {
    decode: (w: unknown) => w,
    encodeJson: (v: unknown) => v,
    decodeJson: (j: unknown) => j,
    ...overrides,
  } as unknown as CodecStub;
}

export function stubCodecLookup(codecs: Record<string, CodecStub>): CodecLookup {
  return {
    get: (id) => codecs[id],
    renderOutputTypeFor: (id, params) => codecs[id]?.renderOutputType?.(params),
  };
}

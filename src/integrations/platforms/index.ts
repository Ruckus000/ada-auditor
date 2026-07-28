import { createPlatformContext } from '../../domain/platforms';
import { genericAdapter } from './generic';
import { reactAdapter } from './react';
import type { PlatformAdapter, PlatformAdapterInput, PlatformMetadata } from './types';
import { wordpressAdapter } from './wordpress';

const adapters: PlatformAdapter[] = [reactAdapter, wordpressAdapter, genericAdapter];

export function resolvePlatformMetadata(input: PlatformAdapterInput): PlatformMetadata {
  const hinted = input.platformHint
    ? adapters.find((candidate) => candidate.platform === input.platformHint)
    : undefined;
  const adapter =
    hinted ?? adapters.find((candidate) => candidate.detect(input)) ?? genericAdapter;
  const context = createPlatformContext({
    platformHint: adapter.platform,
  });

  return adapter.enrich(context);
}

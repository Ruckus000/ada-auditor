import type { PlatformContext, SupportedPlatform } from '../../domain/platforms';

export type PlatformAdapterInput = {
  html: string;
  platformHint?: string;
};

export type PlatformMetadata = {
  id: SupportedPlatform;
  hints: string[];
};

export type PlatformAdapter = {
  platform: PlatformContext['platform'];
  detect: (input: PlatformAdapterInput) => boolean;
  enrich: (context: PlatformContext) => PlatformMetadata;
};

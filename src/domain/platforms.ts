export type SupportedPlatform = 'generic' | 'react' | 'wordpress';

export type PlatformCapabilities = {
  spaNavigationHints: boolean;
  componentSourceHints: boolean;
  cmsTemplateHints: boolean;
};

export type PlatformContext = {
  platform: SupportedPlatform;
  capabilities: PlatformCapabilities;
};

const capabilitiesByPlatform: Record<SupportedPlatform, PlatformCapabilities> = {
  generic: {
    spaNavigationHints: false,
    componentSourceHints: false,
    cmsTemplateHints: false,
  },
  react: {
    spaNavigationHints: true,
    componentSourceHints: true,
    cmsTemplateHints: false,
  },
  wordpress: {
    spaNavigationHints: false,
    componentSourceHints: false,
    cmsTemplateHints: true,
  },
};

export function createPlatformContext(input: {
  platformHint?: string;
}): PlatformContext {
  const normalizedPlatform: SupportedPlatform =
    input.platformHint === 'react' || input.platformHint === 'wordpress'
      ? input.platformHint
      : 'generic';

  return {
    platform: normalizedPlatform,
    capabilities: capabilitiesByPlatform[normalizedPlatform],
  };
}

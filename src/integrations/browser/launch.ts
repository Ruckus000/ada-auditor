import { chromium, type Browser } from 'playwright-core';

/**
 * Resolves a Chromium binary for the current environment.
 *
 * Two environments, two sources:
 *
 * - Local and CI have a full Chromium from `playwright install chromium`.
 *   `playwright-core` shares Playwright's browser registry, so it finds that
 *   binary without `playwright` itself being a runtime dependency.
 * - Vercel's serverless filesystem has no browser at all, so the binary ships
 *   with the function via `@sparticuz/chromium` — a Chromium build compressed
 *   to fit inside the bundle, unpacked to /tmp on first use.
 *
 * The import of `@sparticuz/chromium` is dynamic so local and CI runs never
 * pay to unpack a binary they are not going to use.
 */

function isServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function launchChromium(options: { headless?: boolean } = {}): Promise<Browser> {
  const headless = options.headless ?? true;

  if (!isServerless()) {
    return chromium.launch({ headless });
  }

  const sparticuz = (await import('@sparticuz/chromium')).default;

  return chromium.launch({
    args: sparticuz.args,
    executablePath: await sparticuz.executablePath(),
    headless,
  });
}

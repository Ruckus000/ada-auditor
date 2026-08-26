import { launchChromium } from './launch';

/**
 * Renders report HTML to a PDF.
 *
 * Uses the Chromium the auditor already launches, so the deliverable a client
 * pays for costs no new dependency and no rendering service.
 *
 * The context is deliberately offline: report HTML is self-contained, and the
 * markup embedded in it comes from the audited site. Blocking every request
 * means a snippet that slipped past escaping still could not phone home, and
 * that rendering never stalls on a third-party asset.
 */
export async function renderPdf(
  html: string,
  options: {
    /**
     * Emit a tagged (structured) PDF.
     *
     * Off by default, which is what the client report has always produced —
     * changing that is a product decision, not a side effect of adding the
     * option. It exists because the document pipeline needs a *tagged* PDF to
     * work against, and the alternative was a second Chromium-to-PDF path in a
     * test that could drift from this one.
     */
    tagged?: boolean;
  } = {},
): Promise<Buffer> {
  const browser = await launchChromium({ headless: true });

  try {
    const context = await browser.newContext();
    await context.route('**/*', (route) => route.abort());

    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      tagged: options.tagged ?? false,
    });
  } finally {
    await browser.close();
  }
}

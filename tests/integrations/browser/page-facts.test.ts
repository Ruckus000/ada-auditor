import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectPageFacts } from '../../../src/integrations/browser/page-facts';

/**
 * The collector against a real browser, because a unit test cannot catch what
 * broke it the first time: `[V]` passed as a function, the evaluate callback
 * arrived in the page wrapped in esbuild's `__name` helper — which exists in
 * the Node bundle and not in the browser — and died with
 * `ReferenceError: __name is not defined` under `tsx`, while every type
 * checked and every pure test passed. Serialization across the process
 * boundary is the thing under test, and only a real page exercises it.
 */

const FIXTURE = `<!doctype html><html lang="en"><head><title>facts</title></head><body>
  <div id="tile" onclick="location.href='x.html'">Meetings</div>
  <div id="tile-focusable" tabindex="0" role="button" onclick="go()">Permits</div>
  <button onclick="submit()">Native button</button>

  <form>
    <input id="date" type="text" placeholder="Preferred date" />
    <label for="email">Email address</label>
    <input id="email" type="email" aria-label="Contact" />
    <label>Wrapped <input id="wrapped" type="text" /></label>
    <input type="hidden" name="csrf" value="t" />
  </form>
</body></html>`;

describe('collectPageFacts against a real page', () => {
  let dir: string;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-facts-'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), FIXTURE, 'utf8');
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, 'index.html')).href);
  });

  afterAll(async () => {
    await browser?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('collects non-native click targets, native ones excluded', async () => {
    const facts = await collectPageFacts(page);

    const selectors = facts.clickTargets.map((t) => t.selector);
    expect(selectors).toContain('#tile');
    expect(selectors).toContain('#tile-focusable');
    // The <button onclick> is ordinary — native interactive tags stay out.
    expect(facts.clickTargets.some((t) => t.tag === 'button')).toBe(false);

    const tile = facts.clickTargets.find((t) => t.selector === '#tile');
    expect(tile).toMatchObject({ tag: 'div', role: null, tabindex: null });
    const focusable = facts.clickTargets.find((t) => t.selector === '#tile-focusable');
    expect(focusable).toMatchObject({ role: 'button', tabindex: '0' });
  });

  it('collects labelling facts for text controls, hidden inputs excluded', async () => {
    const facts = await collectPageFacts(page);

    const bySelector = new Map(facts.labelledControls.map((c) => [c.selector, c]));
    expect(bySelector.get('#date')).toMatchObject({
      labelText: null,
      ariaLabel: null,
      placeholder: 'Preferred date',
    });
    // label[for] association.
    expect(bySelector.get('#email')).toMatchObject({
      labelText: 'Email address',
      ariaLabel: 'Contact',
    });
    // Wrapping-label association.
    expect(bySelector.get('#wrapped')?.labelText).toContain('Wrapped');
    // type=hidden never appears.
    expect([...bySelector.keys()].some((s) => s.includes('csrf'))).toBe(false);
  });
});

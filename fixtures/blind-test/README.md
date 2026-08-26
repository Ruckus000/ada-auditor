# Blind-test sites

Three four-page static sites, deliberately broken, used to measure what the
auditor sees. **Nothing here is a template.** Every page contains barriers on
purpose; copying markup out of these files into the product would ship them.

| Directory | Profile |
|---|---|
| `ridgeline-dental/` | Small-business brochure: template site hand-edited for a decade |
| `fairview-township/` | Municipal: tiles instead of links, PDF minutes, auto-refreshing alerts |
| `kestrel-cloud/` | SaaS signup: dark theme, hand-rolled widgets, ARIA from memory |

Each site holds:

- `site.json` — the pages, in the order the journey walks them.
- `answer-key.json` — every planted barrier and correct implementation, with
  the mechanism that should catch it (`deterministic`, `needs-review`,
  `judgement`, `clean`). **Written before the first run**, from the WCAG
  criterion rather than from axe's rule list — a key derived from what the tool
  already catches would only ever prove the tool catches it.

Run them with `npm run blind:test`; results and analysis in
[`docs/research/blind-test/`](../../docs/research/blind-test/).

Two deliberate properties, both easy to erode:

- **`clean` rows are load-bearing.** They are correctly built elements that
  must produce no finding. Without them a scorecard rewards a tool for
  reporting everything.
- **The pages are served over `file://`**, because the SSRF guard refuses
  loopback and private addresses and should keep doing so. That is also the
  limit of this test: it exercises the audit core, never the app's own bundle.
  `npm run smoke:real` is still the only check that does.

# Real municipal documents

Nine PDFs pulled from public municipal and state government sites on
2026-08-24, to test whether the development corpus's numbers survive contact
with documents nobody on this project authored.

**The files are not in the repo.** `real/` is gitignored: they are somebody
else's bytes, some carry names and addresses of private individuals, and any
ground truth written for them quotes their text. This file is the record —
URLs and hashes, not content. Everything below is reproducible by re-fetching.

Nothing in the pipeline touches the network. These were fetched once, by hand,
and are processed locally from then on.

## What was fetched

| local name | pages | KB | tagged | headings | tables | source |
|---|---:|---:|---|---:|---:|---|
| `ct-legal-notice` | 11 | 330 | no | 0 | 0 | https://www.cga.ct.gov/2016/rpt/pdf/2016-R-0099.pdf |
| `fordcity-fee-schedule` | 4 | 462 | no | 0 | 0 | https://fordcityborough.org/wp-content/uploads/2026/03/2026-Mid-Year-Fee-Schedule.pdf |
| `lacity-clerk-misc` | 5 | 3478 | yes | 0 | 0 | https://cityclerk.lacity.org/onlinedocs/2024/24-0793_misc_09-04-24.pdf |
| `newcastle-pc-hearing` | 1 | 192 | yes | 6 | 0 | https://newcastlecity.delaware.gov/files/2026/03/3.9.26.PC_.PubHearing.pdf |
| `nola-cpc-notice` | 2 | 87 | no | 0 | 0 | https://nola.gov/getattachment/NEXT/City-Planning/Meetings/Current-Year/2026/May/City-Planning-Commission/5-26-2026-1-30-00-PM/CPC-public-hearing-notice-5-26-26.pdf/ |
| `nyc-notice-form` | 1 | 264 | no | 0 | 0 | https://www.nyc.gov/assets/manhattancb3/downloads/sla/2025/06/applications/Essex-Mun-Exp-Notice.pdf |
| `orono-fee-schedule` | 18 | 270 | yes | 0 | 144 | https://www.oronomn.gov/DocumentCenter/View/7167/2026-Fee-Schedule |
| `sturgis-agenda` | 90 | 8105 | yes | 0 | 0 | https://www.sturgis-sd.gov/meetingfiles/100228/agendas/06c06fcecada4272a8dfbf6b1677f839.pdf |
| `tml-statutes-table` | 15 | 97 | yes | 0 | 1 | https://www.tml.org/DocumentCenter/View/328/Table-of-Statutes-Requiring-Newspaper-Publication-PDF |

## SHA-256

Recorded so that a fixture or a source file edited after results are known is
visible rather than deniable. This is the h08 discipline made mechanical: that
fixture was corrected after its cost was known, which was defensible only
because it was disclosed.

```
7d428163094203605435b772b35a1f5835e7a5a12ab238deef93c0bbd7fd80f3  ct-legal-notice.pdf
1823d75b1a46b6026f967858cfdac43acf42dc764494e209146eb45f7fa0239e  fordcity-fee-schedule.pdf
822d0c3fe7432b6fad99defd847a510af4e8dbe2d178a9e531da46f873ddacb0  lacity-clerk-misc.pdf
415c4ecb665fbd87785ac8c5f234dc1b5e36aab5b8b931ef1aa8d411e43a75af  newcastle-pc-hearing.pdf
b280cdefb200a860216f4137a8fb0a60f488b33e89e48af83f0f019357cf87a7  nola-cpc-notice.pdf
c5a90c9efcdc3edb89133af9566308a30d94f86ad4fd81126950e168a457ea38  nyc-notice-form.pdf
9ee26ad1e06bb377ad082198e6296af833a0b368212552810c67a0a53ba16aaf  orono-fee-schedule.pdf
c5beddb21aad2f11339473d49a14d9ac4adad7d5df219ff369f4249422cde76b  sturgis-agenda.pdf
ad1003f057df8b77563ddf72ac42f1d7838cd6cbbf23002e0d70aeed2249cb37  tml-statutes-table.pdf
```

## Real Word sources — added 2026-08-25

The first genuine client-format `.docx` files in the project. Everything before
this was a PDF, or a synthetic HTML corpus converted to ODF, which is two
conversions from anything a client sends.

Town of Manchester, NY — Town Board, published on the town's own site.
Public records. **Files are gitignored like everything else in `real/`.**

Page: https://manchesterny.org/town-board

```
cf8d76d37525897b…  manchester-tb-agenda.docx    22,043 bytes  Feb 2023 TB Meeting Agenda
470c910e4f5664bf…  manchester-tb-minutes.docx   55,677 bytes  Feb 2023 TB Meeting Minutes
```

Full hashes:
```
cf8d76d37525897b047af7786009ebb407483d054a351ab91a3b162f39b96b82  manchester-tb-agenda.docx
470c910e4f5664bfae891d56734378adc97251e992f1b23c9ac4b0c2fff6f270  manchester-tb-minutes.docx
```

## Real table-bearing sources — added 2026-08-25

Added to test the document class the Manchester files could not: real tables.
Public records / public agency publications. **Gitignored like everything in
`real/`.**

**Word — NJ Dept of Community Affairs, Division of Local Government Services**
https://www.nj.gov/dca/dlgs/programs/mc_budgets.shtml

```
nj-audit-affidavit.doc        43,008 bytes  1 table, 5 rows, no header row marked
nj-revenue-checklist.doc      32,256 bytes  0 tables
nj-auditor-report.docx        18,333 bytes  0 tables
nj-cola-ordinance.docx        14,522 bytes  0 tables
nj-budget-cap-res.docx        15,051 bytes  0 tables
```

**Note: four of five real government Word documents contain no table at all**,
and no publicly-published municipal Word file with substantial tables could be
found. Municipalities publish PDFs, not sources.

**Excel — Kansas Dept of Administration, municipal budget workbooks**
https://admin.ks.gov/offices/accounts-reports/local-government/municipal-services/budget-workbooks-for-budget-year2025

```
ks-city-budget.xlsx          544,310 bytes  78 sheets/tables
ks-township-budget.xlsx      573,016 bytes  73 sheets/tables
```

Full hashes:
```
427cb414ae1a3f50ec9a06673b981188afe26646856d39c9208b40ce4ba826ec  nj-audit-affidavit.doc
e9211088b5d8ec24dfa339c1789df45898b818d93147706d587ca82f6c1fd915  nj-revenue-checklist.doc
6dfc71b7857a526b67c5ab399074b0da5027def6da7fdc170b84742ab23773b1  nj-auditor-report.docx
c938c671fdb4bd0a921305fe89736ed78a51a9c6b3deb9e4035d706841c88298  nj-cola-ordinance.docx
ba37bb36994126b6d7003d723425df3968603d28f93464120a2ee8ef4f4dc2c4  nj-budget-cap-res.docx
fb84b884e707dfba0a117eb58e8ac8a5256541ef59d6e4a4fd2dcc4ec22818e2  ks-city-budget.xlsx
b7d75cb63a717744f103e80d61a372b405e235b906eb048cb8d5d2c9a050c59b  ks-township-budget.xlsx
```

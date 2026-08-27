# Real municipal Word documents

Thirty-one Word documents pulled from public municipal sites on 2026-08-27
for Arm A of the remediation test — the population the conversion path
exists to serve. Two municipalities, one serving from its own host across
~20 committees and one from its website builder's CDN, mixing modern .docx
with legacy OLE .doc.

**The files are not in the repo.** `real-word/` is gitignored on the same
reasoning as `real/`: they are somebody else's bytes and may carry names of
private individuals. This file is the record — URLs and hashes — and
everything below is reproducible by re-fetching. Ground truth for the .docx
files is read from their own XML by `extract-docx-truth.mjs`; legacy .doc
gets outcome-level checks only, by documented limitation.

| local | bytes | sha256 | source |
|---|---:|---|---|
| `r01.docx` | 19789 | `6d02fb5260e9c831…` | https://townofshelburnema.gov/files/Business_Certificates.docx |
| `r02.doc` | 68096 | `4764956dced2013e…` | https://townofshelburnema.gov/files/Trench_Permit.doc |
| `r03.docx` | 36590 | `098c84945f641223…` | https://townofshelburnema.gov/files/Marijuana_Regulations_-_Efective_August_1_2023.docx |
| `r04.docx` | 20002 | `9078eca6c7204f25…` | https://townofshelburnema.gov/files/Open_Space_Committee_2026-3-23_agenda.docx |
| `r05.doc` | 32256 | `427518957c7a2054…` | https://townofshelburnema.gov/files/APPOINTING_INDIVIDUALS_TO_TOWN_COMMITTEES_COMMISSIONS__BOARDS_-_Policy.doc |
| `r06.docx` | 14941 | `b080560652448c6d…` | https://townofshelburnema.gov/files/Public_Certification_Notice.docx |
| `r07.doc` | 47616 | `d0722a62e8f82550…` | https://townofshelburnema.gov/files/Mask_Advisory_-_Department_of_Public_Health_March_1_2022.doc |
| `r08.docx` | 156258 | `e50e14988349bcd4…` | https://townofshelburnema.gov/files/Open_Space_Comm_2026-1-26_approved_minutes.docx |
| `r09.doc` | 114688 | `07c0f7ce20c255f5…` | https://townofshelburnema.gov/files/Well_Regulations_-_Private_Wells.doc |
| `r10.docx` | 12987 | `d453f2ffefbecec8…` | https://townofshelburnema.gov/files/Shelburne_Local_Cultural_Council_2018-11-29_Draft_Minutes.docx |
| `r11.docx` | 24463 | `acac687e755032b3…` | https://townofshelburnema.gov/files/Tree_Warden_Advertisement.docx |
| `r12.docx` | 69336 | `f7878e28517ff086…` | https://townofshelburnema.gov/files/Select_Board_2026-08-10_Meeting_Minutes_.docx |
| `r13.doc` | 36352 | `034a26bf5b614730…` | https://townofshelburnema.gov/files/TOWN_BALLOT_SAMPLE-_ELECTIONS_May_19_2026.doc |
| `r14.docx` | 16005 | `6db56376e53f398e…` | https://townofshelburnema.gov/files/Finance_Committee_Budget_Report_for_FY23_1.docx |
| `r15.docx` | 17757 | `b9f32e6c5d674bc8…` | https://townofshelburnema.gov/files/E-911_Address_Assignment_Regulations.docx |
| `r16.docx` | 19081 | `2062e88cee75c7ce…` | https://townofshelburnema.gov/files/Dog_License.docx |
| `r17.docx` | 31570 | `38b66cfbaedde372…` | https://townofshelburnema.gov/files/Assessors_2019-01-07_Agenda.docx |
| `r18.docx` | 18424 | `1f8f133ab96d29d9…` | https://townofshelburnema.gov/files/Conflict_of_Interest_Law_for_Municipal_Employees.docx |
| `r19.docx` | 525847 | `180bbfd1b5ac8112…` | https://townofshelburnema.gov/files/Tobacco_Regulation_Nicotine_Free_Generation_-_Proposed_May_2026.docx |
| `r20.doc` | 62976 | `780eef74ff0aa941…` | https://townofshelburnema.gov/files/02-24-2021_Minutes.doc |
| `r21.docx` | 58633 | `bc34f61223fdb1dd…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/12.13.22%20Town%20Board%20Meeting.docx |
| `r22.docx` | 21235 | `6170691b6f9b325f…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/December%202022%20TB%20Meeting%20Agenda.docx |
| `r23.docx` | 22043 | `cf8d76d37525897b…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/February%202023%20TB%20Meeting%20Agenda.docx |
| `r24.docx` | 55677 | `470c910e4f5664bf…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/February%202023%20TB%20Meeting%20Minutes.docx |
| `r25.docx` | 21702 | `690a55388d515bc8…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/January%202023%20TB%20Meeting%20Agenda.docx |
| `r26.docx` | 53318 | `a8a2fca5789ec78f…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/January%202023%20TB%20Meeting%20Minutes.docx |
| `r27.doc` | 99840 | `be72e02c7fd5e04b…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/January%202023%20TB%20Organizational%20Minutes.doc |
| `r28.docx` | 20815 | `0acfa1176d3c534b…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/Manchester%20TB%20mtg%20April%202022.docx |
| `r29.docx` | 23534 | `ece9241728bbc1c7…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/Manchester%20TB%20mtg%20July%202022.docx |
| `r30.docx` | 20957 | `c66dfc81146f4699…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/Manchester%20TB%20mtg%20June%202022.docx |
| `r31.docx` | 21136 | `71687e0e4ceabe4f…` | https://img1.wsimg.com/blobby/go/ef639264-158d-44ea-9a37-7c837d10e343/downloads/Manchester%20TB%20mtg%20May%202022.docx |

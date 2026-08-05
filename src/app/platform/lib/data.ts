/**
 * Demo content for the platform screens.
 *
 * Everything here is fixture data for the agency worklist prototype — no client
 * site in this file is real. It is transcribed from the `Platform Screens`
 * design so the screens read exactly as designed; swapping it for a live source
 * means replacing this module, not the components.
 */

export type VerdictKind = 'fail' | 'risk' | 'pass' | 'scan';
export type Severity = 'must' | 'should' | 'nice';
export type FindingStatus = 'Open' | 'Assigned' | 'Retest due' | 'Dismissed' | 'Fixed';
export type StepKind = 'block' | 'hard' | 'ok';
export type Audience = 'legal' | 'dev' | 'exec';

export interface FindingDetailData {
  /** What a person actually experiences, in plain language. */
  plain: string;
  /** Empty when the finding does not block a journey outright. */
  blocks: string;
  file: string;
  bad: string;
  good: string;
  where: Array<[path: string, spot: string]>;
}

export interface FindingRecord {
  severity: Severity;
  what: string;
  wcag: string;
  area: 'Front end' | 'Back end';
  pages: string;
  status: FindingStatus;
  detail: FindingDetailData;
}

const D = (
  plain: string,
  blocks: string,
  file: string,
  bad: string,
  good: string,
  where: Array<[string, string]>,
): FindingDetailData => ({ plain, blocks, file, bad, good, where });

const f = (
  severity: Severity,
  what: string,
  wcag: string,
  area: 'Front end' | 'Back end',
  pages: string,
  status: FindingStatus,
  detail: FindingDetailData,
): FindingRecord => ({ severity, what, wcag, area, pages, status, detail });

export const WCAG_NAMES: Record<string, string> = {
  '1.1.1': 'Non-text Content',
  '1.3.1': 'Info and Relationships',
  '1.4.1': 'Use of Color',
  '1.4.3': 'Contrast (Minimum)',
  '2.1.1': 'Keyboard',
  '2.1.2': 'No Keyboard Trap',
  '2.2.1': 'Timing Adjustable',
  '2.4.1': 'Bypass Blocks',
  '2.4.2': 'Page Titled',
  '2.4.4': 'Link Purpose',
  '2.4.7': 'Focus Visible',
  '2.5.7': 'Dragging Movements',
  '3.1.1': 'Language of Page',
  '3.3.1': 'Error Identification',
  '3.3.2': 'Labels or Instructions',
  '1.2.2': 'Captions (Prerecorded)',
  '2.4.3': 'Focus Order',
  '4.1.2': 'Name, Role, Value',
  '4.1.3': 'Status Messages',
};

export const FINDINGS_BY_CLIENT: Record<string, FindingRecord[]> = {
  'Acme Outfitters': [
    f(
      'must',
      'The cart button has no name a screen reader can read',
      '4.1.2',
      'Front end',
      '6 pages',
      'Assigned',
      D(
        'The button is an icon with no text and no label, so a screen reader announces it only as “button”. Someone who cannot see the bag icon has no way to know this opens the cart — and no other route to checkout exists on the page.',
        'This blocks the Guest checkout journey. Nobody using a screen reader can complete a purchase while it is open.',
        'components/header/Cart.tsx',
        '<button class="cart">\n  <svg .../>\n</button>',
        '<button class="cart"\n  aria-label="Cart, 1 item">\n  <svg aria-hidden="true" .../>\n</button>',
        [
          ['/', 'Header, top right'],
          ['/collections/new', 'Header, top right'],
          ['/products/trail-jacket', 'Header, top right'],
          ['/cart', 'Header, top right'],
          ['/checkout', 'Header, top right'],
        ],
      ),
    ),
    f(
      'must',
      'The card payment frame traps the keyboard',
      '2.1.2',
      'Front end',
      '1 page',
      'Open',
      D(
        'Once focus enters the card fields it cannot leave with a keyboard. Tab cycles inside the frame forever, so the only way out is to reload the page and lose the basket.',
        'This blocks the Guest checkout journey at the payment step, after the customer has entered an address.',
        'checkout/PaymentFrame.tsx',
        '<iframe src="pay.js"\n  tabindex="0">',
        '<iframe src="pay.js" title="Card details">\n<!-- plus a focus guard after the frame -->',
        [['/checkout', 'Payment step']],
      ),
    ),
    f(
      'must',
      'The page language is never declared',
      '3.1.1',
      'Back end',
      '24 pages',
      'Open',
      D(
        'The server sends every page without a language attribute, so a screen reader reads English content with whatever accent the user last used. Product names and addresses become unintelligible.',
        'This blocks the Create an account journey at the first step, and degrades every other page on the site.',
        'server/templates/layout.hbs',
        '<html>',
        '<html lang="en">',
        [
          ['/', 'Document root'],
          ['/checkout', 'Document root'],
          ['/account/new', 'Document root'],
        ],
      ),
    ),
    f(
      'must',
      'Address errors are announced silently',
      '3.3.1',
      'Front end',
      '3 pages',
      'Open',
      D(
        'When a required address field fails validation the message is painted in red text but never announced. A screen reader user hears nothing and cannot tell why the form will not submit.',
        'This blocks the Guest checkout journey at the address step.',
        'checkout/AddressForm.tsx',
        '<span class="err">Enter a postcode</span>',
        '<span class="err" role="alert">Enter a postcode</span>\n<!-- plus aria-describedby on the input -->',
        [
          ['/checkout', 'Address step'],
          ['/account/addresses', 'Add address'],
          ['/account/edit', 'Edit address'],
        ],
      ),
    ),
    f(
      'should',
      'Price text is too light to read',
      '1.4.3',
      'Front end',
      '24 pages',
      'Retest due',
      D(
        'Prices are set in a light grey that measures 2.4:1 against the page. Anyone with low vision has to guess what an item costs, which is the one number that matters most on the page.',
        '',
        'styles/tokens.css',
        '--price-ink: #b4b4b4;',
        '--price-ink: #5b5b5b; /* 5.1:1 */',
        [
          ['/collections/new', 'Product grid'],
          ['/products/trail-jacket', 'Price block'],
          ['/cart', 'Line items'],
        ],
      ),
    ),
    f(
      'should',
      'Heading levels skip from h1 to h4',
      '1.3.1',
      'Front end',
      '11 pages',
      'Dismissed',
      D(
        'The page jumps from the h1 straight to h4, so anyone navigating by headings cannot tell which sections sit inside which. Nothing is unreachable, but the shape of the page is wrong.',
        '',
        'components/Section.tsx',
        '<h4>Care instructions</h4>',
        '<h2>Care instructions</h2>',
        [
          ['/products/trail-jacket', 'Details tabs'],
          ['/collections/outerwear', 'Filter panel'],
        ],
      ),
    ),
    f(
      'should',
      'Order receipts are untagged PDFs',
      '1.1.1',
      'Back end',
      'All receipts',
      'Open',
      D(
        'Receipts are generated as flat PDFs with no tags and no text layer, so a screen reader reads nothing at all. The customer has no accessible record of what they paid.',
        '',
        'server/pdf/receipt.ts',
        'pdf.image(renderReceipt())',
        'pdf.text(receipt, { tagged: true, lang: "en" })',
        [['/orders/:id/receipt.pdf', 'Generated per order']],
      ),
    ),
    f(
      'nice',
      'Link text says “here” with no context',
      '2.4.4',
      'Front end',
      '7 pages',
      'Open',
      D(
        'Several links read only as “here” when pulled out of the surrounding sentence, so a list of links on the page is a list of the same word. Understandable in context, unhelpful out of it.',
        '',
        'content/help-blocks.md',
        'Read our returns policy <a>here</a>.',
        'Read our <a>returns policy</a>.',
        [
          ['/help', 'Body copy'],
          ['/returns', 'Body copy'],
          ['/faq', 'Body copy'],
        ],
      ),
    ),
  ],
  'Northwind Health': [
    f(
      'must',
      'The appointment calendar is mouse-only',
      '2.1.1',
      'Front end',
      '4 pages',
      'Open',
      D(
        'The date grid responds to mouse events only. With a keyboard there is no way to move between dates or choose one, so the booking flow stops at the first step.',
        'This blocks the Book an appointment journey. There is no phone-free alternative route.',
        'booking/Calendar.tsx',
        '<div onMouseDown={pick}>12</div>',
        '<button type="button" onClick={pick}\n  aria-pressed={selected}>12</button>',
        [
          ['/book', 'Date picker'],
          ['/book/reschedule', 'Date picker'],
          ['/clinics/:id/book', 'Date picker'],
        ],
      ),
    ),
    f(
      'must',
      'Time slots are unlabelled divs',
      '4.1.2',
      'Front end',
      '4 pages',
      'Open',
      D(
        'Each available time is a plain div with no role and no accessible name, so a screen reader announces an unbroken run of numbers with no indication that any of them can be chosen.',
        'This blocks the Book an appointment journey at the time step.',
        'booking/SlotGrid.tsx',
        '<div class="slot">09:20</div>',
        '<button type="button" class="slot">\n  09:20 with Dr Iyer\n</button>',
        [
          ['/book', 'Slot grid'],
          ['/book/reschedule', 'Slot grid'],
        ],
      ),
    ),
    f(
      'must',
      'Booking confirmation is never announced',
      '4.1.3',
      'Front end',
      '1 page',
      'Open',
      D(
        'The confirmation appears in a region that is added to the page silently. A screen reader user submits the form and hears nothing, so there is no way to know whether the appointment was made.',
        'This blocks the Book an appointment journey at the final step.',
        'booking/Confirm.tsx',
        '<div class="toast">Booked</div>',
        '<div class="toast" role="status">\n  Booked for 12 Aug, 09:20\n</div>',
        [['/book/confirm', 'Confirmation panel']],
      ),
    ),
    f(
      'should',
      'Required fields are not marked as required',
      '3.3.2',
      'Front end',
      '9 pages',
      'Assigned',
      D(
        'Required fields are shown with a red asterisk in the label but nothing in the markup. A screen reader user only discovers what was required after the form fails.',
        '',
        'forms/Field.tsx',
        '<label>Date of birth *</label>',
        '<label for="dob">Date of birth (required)</label>\n<input id="dob" required>',
        [
          ['/register', 'Patient details'],
          ['/book', 'Reason for visit'],
          ['/account/edit', 'Contact details'],
        ],
      ),
    ),
    f(
      'nice',
      'Page titles repeat across the site',
      '2.4.2',
      'Back end',
      '61 pages',
      'Open',
      D(
        'Every page is titled “Northwind Health”, so a screen reader user with several tabs open cannot tell them apart, and browser history is unusable.',
        '',
        'server/templates/head.hbs',
        '<title>Northwind Health</title>',
        '<title>{page} — Northwind Health</title>',
        [
          ['/book', 'Document title'],
          ['/clinics', 'Document title'],
          ['/account', 'Document title'],
        ],
      ),
    ),
  ],
  'Portland Transit': [
    f(
      'must',
      'The fare receipt is an untagged PDF',
      '1.1.1',
      'Back end',
      'All receipts',
      'Open',
      D(
        'Receipts are rendered as images inside a PDF with no text layer, so a screen reader reads nothing. A rider cannot confirm what they were charged.',
        'This blocks the Buy a transit pass journey at the receipt step. Section 508 applies, so one blocked step is a compliance failure.',
        'server/pdf/receipt.ts',
        'pdf.image(renderFare())',
        'pdf.text(fare, { tagged: true, lang: "en" })',
        [['/fares/:id/receipt.pdf', 'Generated per purchase']],
      ),
    ),
    f(
      'should',
      'Fare status is shown in colour only',
      '1.4.1',
      'Front end',
      '12 pages',
      'Open',
      D(
        'Active and expired passes are distinguished by a green or red dot with no text, so anyone who cannot tell the colours apart cannot tell whether their pass is valid.',
        '',
        'fares/StatusDot.tsx',
        '<span class="dot green" />',
        '<span class="dot green" />\n<span>Active until 12 Aug</span>',
        [
          ['/account/passes', 'Pass list'],
          ['/fares', 'Fare table'],
        ],
      ),
    ),
    f(
      'should',
      'No visible focus ring on navigation',
      '2.4.7',
      'Front end',
      '88 pages',
      'Retest due',
      D(
        'The stylesheet removes the browser focus ring and never replaces it. A keyboard user cannot see where they are on the page.',
        '',
        'styles/base.css',
        ':focus { outline: none; }',
        ':focus-visible { outline: 3px solid #1b4ed8; outline-offset: 2px; }',
        [
          ['/', 'Primary navigation'],
          ['/fares', 'Primary navigation'],
          ['/alerts', 'Primary navigation'],
        ],
      ),
    ),
    f(
      'nice',
      'The skip link is not the first element',
      '2.4.1',
      'Front end',
      '88 pages',
      'Open',
      D(
        'A skip link exists but sits after the language picker and the alert banner, so a keyboard user passes several controls before reaching it.',
        '',
        'components/Header.tsx',
        '<LangPicker /> <Alerts /> <SkipLink />',
        '<SkipLink /> <LangPicker /> <Alerts />',
        [
          ['/', 'Top of document'],
          ['/fares', 'Top of document'],
        ],
      ),
    ),
  ],
  'Halcyon Bank': [
    f(
      'must',
      'Document upload is drag-and-drop only',
      '2.5.7',
      'Front end',
      '1 page',
      'Assigned',
      D(
        'The upload area accepts files by dragging alone. There is no file input and no button, so anyone who cannot drag — with a keyboard, a switch, or on a phone — cannot submit the documents the application needs.',
        'This blocks the Apply for a mortgage journey at step 8 of 11, after the customer has entered everything else.',
        'apply/DocumentUpload.tsx',
        '<div onDrop={take}>Drop files here</div>',
        '<div onDrop={take}>Drop files here</div>\n<input type="file" id="docs" multiple>\n<label for="docs">Choose files</label>',
        [['/apply/documents', 'Upload panel']],
      ),
    ),
    f(
      'should',
      'The review table has no header cells',
      '1.3.1',
      'Front end',
      '1 page',
      'Open',
      D(
        'The application summary is built from divs, so a screen reader reads a flat run of values with no indication of which figure belongs to which question.',
        '',
        'apply/ReviewTable.tsx',
        '<div class="row"><div>Income</div>…',
        '<table><tr><th scope="row">Income</th><td>…</td></tr>',
        [['/apply/review', 'Summary table']],
      ),
    ),
    f(
      'should',
      'The session times out after 60 seconds',
      '2.2.1',
      'Back end',
      'Sitewide',
      'Open',
      D(
        'The signed-in session ends after a minute of inactivity with no warning and no way to ask for more time. Anyone who reads or types slowly is thrown out mid-application.',
        '',
        'server/session.ts',
        'maxIdle: 60',
        'maxIdle: 1200 // plus a 20s warning with an extend button',
        [
          ['/apply/*', 'Session middleware'],
          ['/account/*', 'Session middleware'],
        ],
      ),
    ),
    f(
      'nice',
      'Statement filenames are not descriptive',
      '2.4.4',
      'Back end',
      '4 pages',
      'Open',
      D(
        'Downloaded statements are all named document.pdf, so a folder of them is indistinguishable without opening each one.',
        '',
        'server/statements.ts',
        'filename="document.pdf"',
        'filename="statement-2026-07-halcyon.pdf"',
        [['/statements', 'Download link']],
      ),
    ),
  ],
  'Brightside Clinic': [
    f(
      'must',
      'The appointment calendar is mouse-only',
      '2.1.1',
      'Front end',
      '4 pages',
      'Open',
      D(
        'The date grid responds to mouse events only, so with a keyboard there is no way to choose a date. The calendar is the whole product here.',
        'This blocks the Book an appointment journey at the first step.',
        'booking/Calendar.tsx',
        '<div onMouseDown={pick}>12</div>',
        '<button type="button" onClick={pick}>12</button>',
        [
          ['/book', 'Date picker'],
          ['/clinics/:id/book', 'Date picker'],
        ],
      ),
    ),
    f(
      'must',
      'Time slots are unlabelled divs',
      '4.1.2',
      'Front end',
      '4 pages',
      'Open',
      D(
        'Available times are divs with no role and no name, so a screen reader announces numbers with no sense that they can be chosen.',
        'This blocks the Book an appointment journey at the time step.',
        'booking/SlotGrid.tsx',
        '<div class="slot">09:20</div>',
        '<button type="button" class="slot">09:20 with Dr Ayo</button>',
        [['/book', 'Slot grid']],
      ),
    ),
    f(
      'must',
      'Confirmation is never announced',
      '4.1.3',
      'Front end',
      '1 page',
      'Open',
      D(
        'The confirmation is inserted silently, so a screen reader user cannot tell whether the appointment was made.',
        'This blocks the Book an appointment journey at the final step.',
        'booking/Confirm.tsx',
        '<div class="toast">Booked</div>',
        '<div class="toast" role="status">Booked for 12 Aug</div>',
        [['/book/confirm', 'Confirmation panel']],
      ),
    ),
  ],
  'Fern & Foster': [
    f(
      'should',
      'Gallery images have decorative alt text',
      '1.1.1',
      'Front end',
      '6 pages',
      'Open',
      D(
        'Product photos carry alt text like “image1”, which tells a screen reader user nothing about the piece they are considering.',
        '',
        'components/Gallery.tsx',
        '<img alt="image1">',
        '<img alt="Oak dining chair, front view">',
        [
          ['/shop', 'Product grid'],
          ['/products/oak-chair', 'Gallery'],
        ],
      ),
    ),
    f(
      'should',
      'The newsletter field has no label',
      '3.3.2',
      'Front end',
      '12 pages',
      'Open',
      D(
        'The email field uses placeholder text only. Once the user starts typing, the only clue about what the field wants is gone.',
        '',
        'components/Newsletter.tsx',
        '<input placeholder="Email">',
        '<label for="nl">Email address</label>\n<input id="nl">',
        [
          ['/', 'Footer'],
          ['/shop', 'Footer'],
        ],
      ),
    ),
    f(
      'should',
      'Focus order jumps in the filter panel',
      '2.4.3',
      'Front end',
      '3 pages',
      'Open',
      D(
        'Tabbing through the filters moves from the top control to the apply button and back up, so the order on screen and the order in the keyboard do not match.',
        '',
        'shop/Filters.tsx',
        'tabindex="3"',
        '<!-- remove tabindex; order the DOM instead -->',
        [['/shop', 'Filter panel']],
      ),
    ),
    f(
      'nice',
      'Decorative icons are announced',
      '1.1.1',
      'Front end',
      '9 pages',
      'Open',
      D(
        'Ornamental leaf icons are read out between sentences, which adds noise without adding meaning.',
        '',
        'components/Icon.tsx',
        '<svg role="img">',
        '<svg aria-hidden="true">',
        [
          ['/', 'Section dividers'],
          ['/about', 'Section dividers'],
        ],
      ),
    ),
  ],
  'Lumen Learning': [
    f(
      'should',
      'Video captions are auto-generated only',
      '1.2.2',
      'Front end',
      '18 pages',
      'Open',
      D(
        'Lecture captions come straight from speech recognition, so technical terms are wrong throughout. Someone relying on them gets a different lesson.',
        '',
        'media/Player.tsx',
        'captions: "auto"',
        'captions: "reviewed" // human-corrected VTT',
        [
          ['/courses/:id/lesson/1', 'Player'],
          ['/courses/:id/lesson/2', 'Player'],
        ],
      ),
    ),
    f(
      'should',
      'Progress is shown in colour only',
      '1.4.1',
      'Front end',
      '4 pages',
      'Open',
      D(
        'Completed and outstanding lessons differ only by a green or grey bar, with no text or icon to tell them apart.',
        '',
        'courses/Progress.tsx',
        '<span class="bar done" />',
        '<span class="bar done" /> <span>4 of 9 complete</span>',
        [
          ['/courses', 'Course cards'],
          ['/dashboard', 'Progress rail'],
        ],
      ),
    ),
    f(
      'nice',
      'Quiz timers cannot be extended',
      '2.2.1',
      'Front end',
      '6 pages',
      'Open',
      D(
        'Timed quizzes give a fixed twenty minutes. There is a documented extension process, but nothing in the interface offers it.',
        '',
        'quiz/Timer.tsx',
        'limit: 20 * 60',
        'limit: settings.accommodations ?? 20 * 60',
        [['/quiz/:id', 'Timer panel']],
      ),
    ),
  ],
  'Cedar & Co': [],
};

export interface SiteSeed {
  name: string;
  domain: string;
  kind: VerdictKind;
  score: number;
  pages: number;
  delta: string;
  owner: string;
  last: string;
  next: string;
  flag: string;
  worst: string;
}

export const SITE_SEEDS: SiteSeed[] = [
  {
    name: 'Northwind Health',
    domain: 'northwindhealth.org',
    kind: 'fail',
    score: 48,
    pages: 61,
    delta: '−6',
    owner: 'MS',
    last: '2h ago',
    next: 'Nightly',
    flag: 'Demand letter received 24 July',
    worst: 'Book an appointment — 3 of 5 steps blocked. Nobody can reach a clinician without a mouse.',
  },
  {
    name: 'Portland Transit',
    domain: 'transit.portland.gov',
    kind: 'fail',
    score: 55,
    pages: 88,
    delta: '−2',
    owner: 'MS',
    last: '5h ago',
    next: 'Nightly',
    flag: 'Section 508 deadline 12 Aug',
    worst: 'Buy a transit pass — the receipt PDF is untagged, so the fare is unreadable after purchase.',
  },
  {
    name: 'Acme Outfitters',
    domain: 'acmeoutfitters.com',
    kind: 'fail',
    score: 62,
    pages: 24,
    delta: '+3',
    owner: 'JR',
    last: '14m ago',
    next: 'Nightly',
    flag: '',
    worst: 'Guest checkout — 2 of 6 steps blocked. 1,240 sessions a week take this path.',
  },
  {
    name: 'Halcyon Bank',
    domain: 'halcyonbank.com',
    kind: 'risk',
    score: 71,
    pages: 42,
    delta: '+5',
    owner: 'TL',
    last: 'Yesterday',
    next: 'Weekly · Mon',
    flag: '',
    worst: 'Apply for a mortgage — 11 steps, one blocked at document upload.',
  },
  {
    name: 'Brightside Clinic',
    domain: 'brightsideclinic.com',
    kind: 'scan',
    score: 0,
    pages: 31,
    delta: '—',
    owner: 'TL',
    last: 'Running now',
    next: '—',
    flag: '',
    worst: 'Still running — 12 must-fix so far.',
  },
  {
    name: 'Fern & Foster',
    domain: 'fernfoster.co',
    kind: 'pass',
    score: 88,
    pages: 12,
    delta: '+1',
    owner: 'JR',
    last: '3h ago',
    next: 'Weekly · Thu',
    flag: '',
    worst: 'All 3 journeys finishable end to end.',
  },
  {
    name: 'Lumen Learning',
    domain: 'lumenlearn.edu',
    kind: 'pass',
    score: 90,
    pages: 56,
    delta: '0',
    owner: 'TL',
    last: 'Yesterday',
    next: 'Nightly',
    flag: '',
    worst: 'Enrol in a course — clean for 4 runs.',
  },
  {
    name: 'Cedar & Co',
    domain: 'cedarco.com',
    kind: 'pass',
    score: 94,
    pages: 18,
    delta: '+2',
    owner: 'JR',
    last: '6h ago',
    next: 'Weekly · Tue',
    flag: '',
    worst: 'Clean for 6 runs straight. Due a manual review.',
  },
];

export type DiffKind = 'new' | 'fixed' | 'regressed';

export interface ClientExtra {
  standard: string;
  run: number;
  prevRun: number;
  journeyCount: number;
  crit: string;
  skipped: number;
  runCount: number;
  body: string;
  diff: Array<[number, DiffKind]>;
  runs: Array<[id: number, score: number, delta: string, when: string]>;
  report: string;
}

export const CLIENT_EXTRAS: Record<string, ClientExtra> = {
  'Acme Outfitters': {
    standard: 'WCAG 2.2 AA',
    run: 131,
    prevRun: 129,
    journeyCount: 3,
    crit: 'acme',
    skipped: 6,
    runCount: 34,
    body: 'The worst of them stop someone using a screen reader from finishing a purchase, so the store is effectively closed to those customers.',
    diff: [
      [2, 'new'],
      [3, 'fixed'],
      [1, 'regressed'],
    ],
    runs: [
      [131, 62, '+3', 'Today, 08:04'],
      [129, 59, '−1', 'Yesterday'],
      [128, 60, '+4', '29 Jul'],
      [127, 56, '0', '28 Jul'],
      [126, 56, '+2', '27 Jul'],
    ],
    report: 'ACR issued 31 July from this run. Link is live and three people have opened it.',
  },
  'Northwind Health': {
    standard: 'WCAG 2.2 AA',
    run: 88,
    prevRun: 86,
    journeyCount: 1,
    crit: 'northwind',
    skipped: 0,
    runCount: 88,
    body: 'Three of them sit in appointment booking, so a patient cannot reach a clinician online. A demand letter is on file, which makes this the agency’s highest exposure.',
    diff: [
      [4, 'new'],
      [1, 'fixed'],
      [3, 'regressed'],
    ],
    runs: [
      [88, 48, '−6', '2h ago'],
      [87, 54, '−2', 'Yesterday'],
      [86, 56, '0', '29 Jul'],
      [85, 56, '+1', '28 Jul'],
      [84, 55, '−3', '27 Jul'],
    ],
    report: 'ACR issued 28 July to outside counsel. Counsel asked for an update by Friday.',
  },
  'Portland Transit': {
    standard: 'Section 508',
    run: 64,
    prevRun: 63,
    journeyCount: 1,
    crit: 'transit',
    skipped: 2,
    runCount: 64,
    body: 'As a public body a single blocked journey step is a failure regardless of the score, and the remediation deadline is 12 August.',
    diff: [
      [1, 'new'],
      [2, 'fixed'],
      [2, 'regressed'],
    ],
    runs: [
      [64, 55, '−2', '5h ago'],
      [63, 57, '+1', 'Yesterday'],
      [62, 56, '+3', '29 Jul'],
      [61, 53, '0', '28 Jul'],
      [60, 53, '−4', '26 Jul'],
    ],
    report: '508 summary filed 24 July for the quarter. Next filing due in October.',
  },
  'Halcyon Bank': {
    standard: 'WCAG 2.2 AA',
    run: 52,
    prevRun: 51,
    journeyCount: 2,
    crit: 'halcyon',
    skipped: 0,
    runCount: 52,
    body: 'The mortgage application cannot be completed without dragging a file. Everything else is slow rather than impossible.',
    diff: [
      [0, 'new'],
      [4, 'fixed'],
      [0, 'regressed'],
    ],
    runs: [
      [52, 71, '+5', 'Yesterday'],
      [51, 66, '+2', '28 Jul'],
      [50, 64, '+1', '21 Jul'],
      [49, 63, '0', '14 Jul'],
      [48, 63, '+3', '7 Jul'],
    ],
    report: 'Exec one-pager issued 19 July for the board pack. No client link is live.',
  },
  'Brightside Clinic': {
    standard: 'WCAG 2.2 AA',
    run: 19,
    prevRun: 18,
    journeyCount: 1,
    crit: 'northwind',
    skipped: 3,
    runCount: 19,
    body: 'Twelve must-fix findings have landed so far, all of them in the appointment calendar.',
    diff: [
      [0, 'new'],
      [0, 'fixed'],
      [0, 'regressed'],
    ],
    runs: [
      [19, 0, '—', 'Running now'],
      [18, 44, '−2', 'Yesterday'],
      [17, 46, '+1', '28 Jul'],
      [16, 45, '0', '21 Jul'],
      [15, 45, '+5', '14 Jul'],
    ],
    report: 'No report issued yet. Wait for the run to finish before generating one.',
  },
  'Fern & Foster': {
    standard: 'WCAG 2.2 AA',
    run: 27,
    prevRun: 26,
    journeyCount: 0,
    crit: 'clean',
    skipped: 0,
    runCount: 27,
    body: 'Four findings remain that make tasks slower rather than impossible.',
    diff: [
      [0, 'new'],
      [2, 'fixed'],
      [0, 'regressed'],
    ],
    runs: [
      [27, 88, '+1', '3h ago'],
      [26, 87, '+2', '25 Jul'],
      [25, 85, '0', '18 Jul'],
      [24, 85, '+1', '11 Jul'],
      [23, 84, '+4', '4 Jul'],
    ],
    report: 'No report issued in the current contract period.',
  },
  'Lumen Learning': {
    standard: 'WCAG 2.2 AA',
    run: 45,
    prevRun: 44,
    journeyCount: 1,
    crit: 'clean',
    skipped: 0,
    runCount: 45,
    body: 'Three findings remain at the lowest severity.',
    diff: [
      [0, 'new'],
      [1, 'fixed'],
      [0, 'regressed'],
    ],
    runs: [
      [45, 90, '0', 'Yesterday'],
      [44, 90, '+1', '29 Jul'],
      [43, 89, '+2', '28 Jul'],
      [42, 87, '0', '27 Jul'],
      [41, 87, '+1', '26 Jul'],
    ],
    report: 'No report issued. Client has asked for one at the end of the term.',
  },
  'Cedar & Co': {
    standard: 'WCAG 2.2 AA',
    run: 40,
    prevRun: 39,
    journeyCount: 0,
    crit: 'clean',
    skipped: 0,
    runCount: 40,
    body: 'Every tested journey can be finished with a keyboard and with a screen reader. Clean for six runs.',
    diff: [
      [0, 'new'],
      [1, 'fixed'],
      [0, 'regressed'],
    ],
    runs: [
      [40, 94, '+2', '6h ago'],
      [39, 92, '0', '22 Jul'],
      [38, 92, '+1', '15 Jul'],
      [37, 91, '+3', '8 Jul'],
      [36, 88, '0', '1 Jul'],
    ],
    report: 'ACR issued 12 July with a clean result. The client link has since expired.',
  },
};

export const KPIS = [
  { label: 'SITES BELOW CONTRACT', value: '6', note: 'of 34 · 2 more than last week', color: '#96231c' },
  { label: 'MUST-FIX OPEN', value: '217', note: 'across the whole portfolio', color: '#96231c' },
  { label: 'CLOSED THIS WEEK', value: '41', note: 'best week since April', color: '#0b5f58' },
  { label: 'AVERAGE SCORE', value: '74', note: '+3 over 30 days', color: '#7a4e0a' },
];

export interface JourneyDef {
  name: string;
  site: string;
  chip: VerdictKind;
  summary: string;
  footer: string;
  steps: Array<[label: string, kind: StepKind, note: string]>;
}

export const JOURNEY_DEFS: JourneyDef[] = [
  {
    name: 'Guest checkout',
    site: 'Acme Outfitters',
    chip: 'fail',
    summary: '2 of 6 steps blocked',
    footer:
      'A screen reader user gets as far as the cart and stops. 1,240 sessions a week take this path.',
    steps: [
      ['Land on catalog', 'ok', 'Clean'],
      ['Open a product', 'hard', 'Price too faint to read'],
      ['Add to cart', 'block', 'Cart button has no name'],
      ['Enter address', 'hard', 'Errors announced silently'],
      ['Pay', 'block', 'Card iframe traps keyboard'],
      ['Confirmation', 'ok', 'Clean'],
    ],
  },
  {
    name: 'Apply for a mortgage',
    site: 'Halcyon Bank',
    chip: 'risk',
    summary: '11 steps · 1 blocked, 3 hard going',
    footer:
      'The longest journey we test. Everything before step 8 is fine, so the whole application is lost at document upload.',
    steps: [
      ['Start an application', 'ok', 'Clean'],
      ['Confirm eligibility', 'ok', 'Clean'],
      ['Personal details', 'hard', 'Labels sit outside the field'],
      ['Employment', 'ok', 'Clean'],
      ['Income', 'ok', 'Clean'],
      ['Existing debts', 'ok', 'Clean'],
      ['Property details', 'ok', 'Clean'],
      ['Upload documents', 'block', 'Drag-and-drop only, no file input'],
      ['Review the summary', 'hard', 'Table has no header cells'],
      ['Sign the declaration', 'hard', 'Canvas signature, no alternative'],
      ['Submitted', 'ok', 'Clean'],
    ],
  },
  {
    name: 'Book an appointment',
    site: 'Brightside Clinic',
    chip: 'fail',
    summary: '3 of 5 steps blocked',
    footer: 'The calendar is the whole product and it cannot be operated without a mouse.',
    steps: [
      ['Find a clinic', 'ok', 'Clean'],
      ['Pick a date', 'block', 'Calendar is mouse-only'],
      ['Pick a time', 'block', 'Slots are unlabelled divs'],
      ['Confirm details', 'hard', 'Required fields not marked'],
      ['Get confirmation', 'block', 'Confirmation never announced'],
    ],
  },
  {
    name: 'Buy a transit pass',
    site: 'Portland Transit',
    chip: 'fail',
    summary: '1 of 5 steps blocked',
    footer:
      'Public-sector site — Section 508 applies, so a single blocked step is a compliance failure.',
    steps: [
      ['Choose a fare', 'ok', 'Clean'],
      ['Sign in', 'hard', 'No visible focus ring'],
      ['Add funds', 'ok', 'Clean'],
      ['Pay', 'block', 'Receipt PDF is untagged'],
      ['Receipt', 'hard', 'Amount only shown in colour'],
    ],
  },
  {
    name: 'Enrol in a course',
    site: 'Lumen Learning',
    chip: 'pass',
    summary: '8 steps · all finishable',
    footer: 'Clean for four runs. Worth a manual screen-reader pass rather than more automation.',
    steps: [
      ['Browse the catalogue', 'ok', 'Clean'],
      ['Open a course', 'ok', 'Clean'],
      ['Check prerequisites', 'ok', 'Clean'],
      ['Create an account', 'ok', 'Clean'],
      ['Verify email', 'ok', 'Clean'],
      ['Choose a cohort', 'ok', 'Clean'],
      ['Pay or apply for aid', 'ok', 'Clean'],
      ['Enrolled', 'ok', 'Clean'],
    ],
  },
  {
    name: 'Reset a password',
    site: 'Halcyon Bank',
    chip: 'risk',
    summary: 'Slow but finishable',
    footer:
      'Nothing blocks the task, but the timeout gives 60 seconds with no way to ask for more.',
    steps: [
      ['Request the link', 'ok', 'Clean'],
      ['Open the email', 'ok', 'Clean'],
      ['Set a new one', 'hard', 'Session times out at 60s'],
      ['Sign in', 'ok', 'Clean'],
    ],
  },
  {
    name: 'Create an account',
    site: 'Acme Outfitters',
    chip: 'fail',
    summary: '1 of 4 steps blocked',
    footer:
      'The page language is missing sitewide, so every field is read out in the wrong accent.',
    steps: [
      ['Open sign-up', 'block', 'Page has no language set'],
      ['Fill the form', 'hard', 'Labels sit outside the field'],
      ['Verify email', 'ok', 'Clean'],
      ['First sign-in', 'ok', 'Clean'],
    ],
  },
  {
    name: 'Return an item',
    site: 'Acme Outfitters',
    chip: 'risk',
    summary: '9 steps · 2 hard going',
    footer:
      'Nobody is blocked, but a return takes nine steps and two of them give no feedback when they fail.',
    steps: [
      ['Sign in', 'ok', 'Clean'],
      ['Open order history', 'ok', 'Clean'],
      ['Pick the order', 'ok', 'Clean'],
      ['Pick the item', 'ok', 'Clean'],
      ['Choose a reason', 'hard', 'Dropdown has no label'],
      ['Choose a refund type', 'ok', 'Clean'],
      ['Print the label', 'hard', 'Label PDF is untagged'],
      ['Book a collection', 'ok', 'Clean'],
      ['Confirmation', 'ok', 'Clean'],
    ],
  },
  {
    name: 'Request a prescription refill',
    site: 'Northwind Health',
    chip: 'fail',
    summary: '2 of 5 steps blocked',
    footer: 'A patient who cannot use a mouse cannot request a refill online at all.',
    steps: [
      ['Sign in', 'ok', 'Clean'],
      ['Find the prescription', 'hard', 'Results table has no headers'],
      ['Request the refill', 'block', 'Button is a div with no role'],
      ['Choose a pharmacy', 'block', 'Map picker is mouse-only'],
      ['Confirmation', 'ok', 'Clean'],
    ],
  },
];

export const CRITERION_SETS: Record<string, Array<[string, string, string, string]>> = {
  acme: [
    ['1.1.1', 'Non-text Content', 'Does not support', '#96231c'],
    ['1.3.1', 'Info and Relationships', 'Partially supports', '#7a4e0a'],
    ['1.4.3', 'Contrast (Minimum)', 'Does not support', '#96231c'],
    ['2.1.2', 'No Keyboard Trap', 'Does not support', '#96231c'],
    ['2.4.7', 'Focus Visible', 'Partially supports', '#7a4e0a'],
    ['3.1.1', 'Language of Page', 'Does not support', '#96231c'],
    ['4.1.2', 'Name, Role, Value', 'Does not support', '#96231c'],
  ],
  northwind: [
    ['1.3.1', 'Info and Relationships', 'Does not support', '#96231c'],
    ['2.1.1', 'Keyboard', 'Does not support', '#96231c'],
    ['2.4.3', 'Focus Order', 'Does not support', '#96231c'],
    ['2.5.1', 'Pointer Gestures', 'Does not support', '#96231c'],
    ['3.3.2', 'Labels or Instructions', 'Partially supports', '#7a4e0a'],
    ['4.1.3', 'Status Messages', 'Does not support', '#96231c'],
  ],
  transit: [
    ['1.4.1', 'Use of Color', 'Does not support', '#96231c'],
    ['1.4.11', 'Non-text Contrast', 'Partially supports', '#7a4e0a'],
    ['2.4.7', 'Focus Visible', 'Does not support', '#96231c'],
    ['4.1.2', 'Name, Role, Value', 'Partially supports', '#7a4e0a'],
  ],
  halcyon: [
    ['1.3.1', 'Info and Relationships', 'Partially supports', '#7a4e0a'],
    ['2.2.1', 'Timing Adjustable', 'Does not support', '#96231c'],
    ['2.5.7', 'Dragging Movements', 'Does not support', '#96231c'],
    ['3.3.7', 'Redundant Entry', 'Supports', '#0b5f58'],
  ],
  clean: [
    ['1.1.1', 'Non-text Content', 'Supports', '#0b5f58'],
    ['1.3.1', 'Info and Relationships', 'Supports', '#0b5f58'],
    ['1.4.3', 'Contrast (Minimum)', 'Supports', '#0b5f58'],
    ['2.1.1', 'Keyboard', 'Supports', '#0b5f58'],
    ['4.1.2', 'Name, Role, Value', 'Supports', '#0b5f58'],
  ],
};

export const FIX_SETS: Record<string, Array<[string, string, string]>> = {
  acme: [
    ['Cart button has no name', 'components/header/Cart.tsx', '6 pages'],
    ['Price text fails contrast', 'styles/tokens.css', '24 pages'],
    ['Card iframe traps the keyboard', 'checkout/PaymentFrame.tsx', '1 page'],
  ],
  northwind: [
    ['Calendar is mouse-only', 'booking/Calendar.tsx', '4 pages'],
    ['Time slots are unlabelled divs', 'booking/SlotGrid.tsx', '4 pages'],
    ['Confirmation is never announced', 'booking/Confirm.tsx', '1 page'],
  ],
  transit: [
    ['Receipt PDF is untagged', 'server/pdf/receipt.ts', 'all receipts'],
    ['Fare status shown in colour only', 'fares/StatusDot.tsx', '12 pages'],
    ['No visible focus ring', 'styles/base.css', '88 pages'],
  ],
  halcyon: [
    ['Upload is drag-and-drop only', 'apply/DocumentUpload.tsx', '1 page'],
    ['Summary table has no header cells', 'apply/ReviewTable.tsx', '1 page'],
    ['Session times out at 60s', 'server/session.ts', 'sitewide'],
  ],
  clean: [['No open findings', '—', '—']],
};

export interface ReportDef {
  title: string;
  sub: string;
  type: string;
  issued: string;
  access: string;
  accessColor: string;
  aud: Audience;
  client: string;
  domain: string;
  standard: string;
  verdict: string;
  verdictBg: string;
  crit: string;
  sev: [number, number, number, number];
  notesPages: string;
  preview: string;
  para1: string;
  para2: string;
}

export const REPORT_DEFS: ReportDef[] = [
  {
    title: 'Acme Outfitters — ACR',
    sub: 'Run #131 · WCAG 2.2 AA · 14 pages',
    type: 'ACR',
    issued: '31 Jul 2026',
    access: 'Link live · 3 viewers',
    accessColor: '#0b5f58',
    aud: 'legal',
    client: 'Acme Outfitters',
    domain: 'acmeoutfitters.com',
    standard: 'WCAG 2.2 Level AA',
    verdict: 'DOES NOT CONFORM',
    verdictBg: '#96231c',
    crit: 'acme',
    sev: [4, 5, 7, 11],
    notesPages: 'pages 4–12',
    preview: '1 of 14',
    para1:
      'Meridian Access tested 24 pages and 5 user journeys on acmeoutfitters.com between 28 and 31 July 2026, against WCAG 2.2 Level AA. Nine findings block conformance today. Four of those stop a person using a screen reader from completing a purchase at all; the remaining five make the task slow or confusing rather than impossible.',
    para2:
      'Three of the nine sit in server-rendered templates rather than in the page markup, so a single template change closes them across all 24 pages.',
  },
  {
    title: 'Northwind Health — ACR',
    sub: 'Run #88 · sent to outside counsel',
    type: 'ACR',
    issued: '28 Jul 2026',
    access: 'Link live · 7 viewers',
    accessColor: '#0b5f58',
    aud: 'legal',
    client: 'Northwind Health',
    domain: 'northwindhealth.org',
    standard: 'WCAG 2.2 Level AA',
    verdict: 'DOES NOT CONFORM',
    verdictBg: '#96231c',
    crit: 'northwind',
    sev: [9, 14, 6, 8],
    notesPages: 'pages 5–19',
    preview: '1 of 21',
    para1:
      'Meridian Access tested 61 pages and 4 user journeys on northwindhealth.org between 24 and 28 July 2026, against WCAG 2.2 Level AA. Twenty-three findings block conformance today. Three of them sit in the appointment booking flow, which means a patient who cannot use a mouse has no way to reach a clinician online.',
    para2:
      'This report was requested by outside counsel following correspondence received on 24 July 2026. Testing method and dates are stated in full in section 5.',
  },
  {
    title: 'Portland Transit — 508 summary',
    sub: 'Run #64 · quarterly filing',
    type: 'PDF',
    issued: '24 Jul 2026',
    access: 'Downloaded only',
    accessColor: '#55636b',
    aud: 'legal',
    client: 'Portland Transit',
    domain: 'transit.portland.gov',
    standard: 'Section 508 · WCAG 2.0 Level AA',
    verdict: 'DOES NOT CONFORM',
    verdictBg: '#96231c',
    crit: 'transit',
    sev: [6, 21, 12, 5],
    notesPages: 'pages 3–9',
    preview: '1 of 11',
    para1:
      'Meridian Access tested 88 pages and 3 user journeys on transit.portland.gov between 21 and 24 July 2026, against the Revised Section 508 standards. Six findings block conformance. The fare purchase flow is the most serious: the receipt is issued as an untagged PDF, so a rider cannot confirm what they paid.',
    para2:
      'As a public-sector body, a single blocked journey step is a compliance failure regardless of the overall score. The remediation deadline on file is 12 August 2026.',
  },
  {
    title: 'Halcyon Bank — exec one-pager',
    sub: 'Run #52 · board pack',
    type: 'PDF',
    issued: '19 Jul 2026',
    access: 'Downloaded only',
    accessColor: '#55636b',
    aud: 'exec',
    client: 'Halcyon Bank',
    domain: 'halcyonbank.com',
    standard: 'WCAG 2.2 Level AA',
    verdict: 'PARTIALLY CONFORMS',
    verdictBg: '#7a4e0a',
    crit: 'halcyon',
    sev: [1, 9, 4, 3],
    notesPages: 'the appendix',
    preview: '1 of 2',
    para1:
      'Halcyon Bank scores 71 out of 100, up five points since the last run. One finding still blocks conformance: the mortgage application cannot be completed without dragging a file, which stops any customer who cannot use a mouse at step 8 of 11.',
    para2:
      'Closing that one finding moves the site to a passing verdict. The web team estimates half a day of work; nothing else on the list is contractually blocking.',
  },
  {
    title: 'Cedar & Co — ACR',
    sub: 'Run #40 · clean result',
    type: 'ACR',
    issued: '12 Jul 2026',
    access: 'Link expired',
    accessColor: '#96231c',
    aud: 'legal',
    client: 'Cedar & Co',
    domain: 'cedarco.com',
    standard: 'WCAG 2.2 Level AA',
    verdict: 'CONFORMS',
    verdictBg: '#0b5f58',
    crit: 'clean',
    sev: [0, 0, 1, 2],
    notesPages: 'pages 3–6',
    preview: '1 of 8',
    para1:
      'Meridian Access tested 18 pages and 3 user journeys on cedarco.com between 9 and 12 July 2026, against WCAG 2.2 Level AA. No findings block conformance, and every tested journey can be completed end to end with a keyboard and with a screen reader.',
    para2:
      'Automated checks alone detect roughly 40% of accessibility barriers. A manual review is recommended before this statement is relied on publicly.',
  },
  {
    title: 'Acme Outfitters — remediation plan',
    sub: 'Run #118 · superseded by #131',
    type: 'Dev',
    issued: '2 Jul 2026',
    access: 'Link revoked',
    accessColor: '#96231c',
    aud: 'dev',
    client: 'Acme Outfitters',
    domain: 'acmeoutfitters.com',
    standard: 'WCAG 2.2 Level AA',
    verdict: 'SUPERSEDED',
    verdictBg: '#55636b',
    crit: 'acme',
    sev: [7, 12, 9, 14],
    notesPages: 'pages 4–16',
    preview: '1 of 18',
    para1:
      'This plan lists every open finding on acmeoutfitters.com as of run #118, with the file that owns it and the change that closes it. Findings are ordered by how many pages they affect, so template-level fixes come first.',
    para2:
      'Run #131 has since replaced this plan. Four of the findings below are already closed; the link was revoked to stop the stale list circulating.',
  },
];

export const VIEWERS_BY_CLIENT: Record<string, Array<[string, string, string]>> = {
  'Acme Outfitters': [
    ['PR', 'Priya Raman · Acme legal', 'Today, 09:12'],
    ['DM', 'Dana Moss · Acme web team', 'Yesterday, 16:40'],
    ['KO', 'Kelsey Oyelaran · outside counsel', '29 Jul, 11:03'],
  ],
  'Northwind Health': [
    ['GA', 'Gwen Adler · general counsel', 'Today, 07:40'],
    ['RS', 'Rafi Suleiman · outside counsel', '29 Jul, 18:22'],
  ],
};

export const LINK_STATES: Record<string, 'live' | 'expired'> = {
  'Acme Outfitters': 'live',
  'Northwind Health': 'live',
  'Cedar & Co': 'expired',
};

export const LINK_NOTES = {
  live: 'Anyone with this link can read the report. It expires 30 August 2026.',
  expired:
    'This link has expired. The report is still in the library — re-issue it to share again.',
  none: 'No live link for this client. Generate a report to create one.',
} as const;

export interface ActivityRowSeed {
  initials: string;
  who: string;
  action: string;
  target: string;
  detail: string;
  client: string;
  when: string;
  revertable: boolean;
  reverted: boolean;
}

const act = (
  initials: string,
  who: string,
  action: string,
  target: string,
  detail: string,
  client: string,
  when: string,
  revertable: boolean,
  reverted: boolean,
): ActivityRowSeed => ({ initials, who, action, target, detail, client, when, revertable, reverted });

export const ACTIVITY_DAYS: Array<{ label: string; rows: ActivityRowSeed[] }> = [
  {
    label: 'TODAY · 31 JULY',
    rows: [
      act('JR', 'Jules Reyes', 'dismissed', 'Heading level skips from h1 to h4', 'Reason: “design system ships a fix next sprint”', 'Acme Outfitters', '10:42', true, false),
      act('SYS', 'Nightly run #131', 'found', '2 new must-fix findings', '24 pages · 3m 42s', 'Acme Outfitters', '08:04', false, false),
      act('DM', 'Dana Moss', 'marked fixed', 'Price text is too light to read', 'Verified by re-test · contrast now 5.1:1', 'Acme Outfitters', '07:58', true, false),
      act('MS', 'Mira Sato', 'confirmed', 'AI suggestion: thin page structure', 'Promoted to Should fix', 'Northwind Health', '07:12', true, false),
      act('MS', 'Mira Sato', 'reopened', 'Fare table has no header cells', 'Regressed after last night’s deploy', 'Portland Transit', '06:40', true, false),
    ],
  },
  {
    label: 'YESTERDAY · 30 JULY',
    rows: [
      act('JR', 'Jules Reyes', 'issued', 'Acme Outfitters — ACR', 'Shared link, expires 30 Aug · 3 viewers since', 'Acme Outfitters', '18:20', false, false),
      act('TL', 'Tomás Lund', 'marked fixed', 'No visible focus style on navigation', 'Undone by Mira Sato 12 minutes later', 'Halcyon Bank', '16:05', false, true),
      act('TL', 'Tomás Lund', 'changed the schedule', 'Weekly → nightly runs', 'After two regressions in one week', 'Northwind Health', '11:15', true, false),
      act('SYS', 'Scheduler', 'skipped', '6 pages behind sign-in', 'Test account expired', 'Acme Outfitters', '02:06', false, false),
    ],
  },
];

export const ACTIVITY_CLIENT_NAMES = [
  'Acme Outfitters',
  'Northwind Health',
  'Portland Transit',
  'Halcyon Bank',
];

/** [startUrl, skipPaths, schedule, alsoRunOn, testAccount, credentialState] */
export const CONFIG_BY_CLIENT: Record<
  string,
  [string, string[], string, string, string, 'expired' | 'missing' | 'ok' | 'none']
> = {
  'Acme Outfitters': [
    'https://staging.acmeoutfitters.com',
    ['/blog/*', '/legacy/*', '/*.pdf', '/admin/*'],
    'Every night at 02:00 PT',
    'Every deploy to main',
    'qa@acme.test',
    'expired',
  ],
  'Northwind Health': [
    'https://www.northwindhealth.org',
    ['/careers/*', '/news/*'],
    'Every night at 01:00 PT',
    'Every deploy to main',
    'audit@northwind.test',
    'ok',
  ],
  'Portland Transit': [
    'https://transit.portland.gov',
    ['/archive/*', '/*.pdf'],
    'Every night at 03:00 PT',
    'Manual runs only',
    'rider@transit.test',
    'ok',
  ],
  'Halcyon Bank': [
    'https://halcyonbank.com',
    ['/press/*', '/investors/*'],
    'Every Monday at 02:00 PT',
    'Every release tag',
    'audit@halcyon.test',
    'ok',
  ],
  'Brightside Clinic': [
    'https://brightsideclinic.com',
    ['/blog/*'],
    'Every night at 02:30 PT',
    'Manual runs only',
    'clinic@brightside.test',
    'missing',
  ],
  'Fern & Foster': [
    'https://fernfoster.co',
    ['/journal/*'],
    'Every Thursday at 04:00 PT',
    'Manual runs only',
    'None set',
    'none',
  ],
  'Lumen Learning': [
    'https://lumenlearn.edu',
    ['/library/*', '/*.pdf'],
    'Every night at 05:00 PT',
    'Every deploy to main',
    'student@lumen.test',
    'ok',
  ],
  'Cedar & Co': [
    'https://cedarco.com',
    ['/lookbook/*'],
    'Every Tuesday at 02:00 PT',
    'Manual runs only',
    'None set',
    'none',
  ],
};

export const PEOPLE: Array<[string, string, string, string, string]> = [
  ['JR', 'Jules Reyes', 'jules@meridian.co', 'Lead auditor', 'Everything, including dismissal reasons and internal notes.'],
  ['MS', 'Mira Sato', 'mira@meridian.co', 'Auditor', 'Everything on assigned clients. Can change verdicts.'],
  ['AM', 'Adaeze Mba', 'adaeze@meridian.co', 'Account manager', 'Scores, trends and issued reports. Cannot change a verdict.'],
  ['DM', 'Dana Moss', 'dana@acme.com', 'Client · developer', 'Open findings, code and fixes for Acme only.'],
  ['PR', 'Priya Raman', 'priya@acme.com', 'Client · legal', 'Verdict, criteria table and issued reports for Acme only.'],
];

export const INTEGRATIONS: Array<[string, string, string, string, string, string, string, string]> = [
  ['Jira', 'JI', '#eef1f6', '#37507e', 'ACME board · must-fix findings open a ticket automatically', 'Configure', '#c2b9a7', '#3a464e'],
  ['GitHub', 'GH', '#f3efe6', '#3a464e', 'Blocks a deploy when a must-fix appears on main', 'Configure', '#c2b9a7', '#3a464e'],
  ['Slack', 'SL', '#f2f8f6', '#0b5f58', '#acme-web · a summary after every nightly run', 'Configure', '#c2b9a7', '#3a464e'],
  ['Figma', 'FI', '#fdf6f5', '#96231c', 'Not connected — link designs to findings', 'Connect', '#0b5f58', '#0b5f58'],
];

export const SCAN_STATS = [
  { n: 12, label: 'Must fix so far', color: '#96231c' },
  { n: 19, label: 'Should fix', color: '#7a4e0a' },
  { n: 4, label: 'Journeys walked', color: '#0b5f58' },
  { n: 6, label: 'Pages we could not reach', color: '#55636b' },
];

export const COVER_STATS = [
  { n: 15, label: 'Screens designed', color: '#0b5f58' },
  { n: 5, label: 'Modals designed', color: '#0b5f58' },
  { n: 11, label: 'States designed', color: '#0b5f58' },
  { n: 25, label: 'Actions specified', color: '#0b5f58' },
  { n: 13, label: 'Explicitly out of scope', color: '#96231c' },
];

export type CoverTone = 'done' | 'scope' | 'hide';

export const COVER_GROUPS: Array<{
  label: string;
  rows: Array<[name: string, covers: string, where: string, tone: CoverTone, status: string]>;
}> = [
  {
    label: 'AGENCY LEVEL — WORKSPACE SCOPE',
    rows: [
      ['Portfolio', '34 client sites as a worklist, sorted by legal exposure. KPI tiles above. The 8 rows shown are representative, not exhaustive.', 'Portfolio', 'done', 'DESIGNED'],
      ['Client peek modal', 'Cut in the ease-of-use pass — a row opens the client directly. The table’s score, delta and flag columns cover comparing without entering.', '—', 'hide', 'CUT'],
      ['Find a client (header search)', 'Collapsed trigger (⌘K or click) expands to a field with a results panel: name or domain match, must-fix count and verdict per row, Esc or ✕ closes. With no query it lists the clients that need work first. Clients only — not findings or reports.', 'Header → Find a client', 'done', 'DESIGNED'],
      ['Portfolio · first-run empty state', 'No clients yet: what the first run does and the single CTA to add a site.', 'Tweaks → First-run workspace', 'done', 'DESIGNED'],
      ['Reports library', 'Everything issued, its type, access state and who opened it.', 'Reports', 'done', 'DESIGNED'],
      ['Report builder', 'Audience-driven builder with live paper preview per report.', 'Reports → Open', 'done', 'DESIGNED'],
      ['Client link (read-only)', 'What the client sees at a shared link, per client. Dismissals hidden.', 'Reports → Link on any row', 'done', 'DESIGNED'],
      ['Activity (all clients)', 'Audit trail with per-client filter, undo per action.', 'Activity', 'done', 'DESIGNED'],
      ['Workspace settings', 'People and roles, connected tools, report defaults.', 'Settings', 'done', 'DESIGNED'],
    ],
  },
  {
    label: 'CLIENT LEVEL — INSIDE ONE CLIENT',
    rows: [
      ['Overview', 'Verdict, score ring, run-to-run diff (tiles click through to Findings), blocking work, journeys, run history, coverage.', 'Click any portfolio row', 'done', 'DESIGNED'],
      ['Journeys', 'Flow strips with status ribbon; long journeys collapse clean runs.', 'Client → Journeys', 'done', 'DESIGNED'],
      ['Findings list', 'All findings with severity, criterion, front/back end, pages, status. Clean clients get an all-clear state instead.', 'Client → Findings', 'done', 'DESIGNED'],
      ['Finding detail', 'Authored for all 26 findings: plain language, journey it blocks, owning file, before/after code, occurrences, history.', 'Findings → any row, any client', 'done', 'DESIGNED'],
      ['Client reports', 'The reports issued for this client, and the generate entry point.', 'Client → Reports', 'done', 'DESIGNED'],
      ['Client activity', 'The same audit trail scoped to this client, filter hidden.', 'Client → Activity', 'done', 'DESIGNED'],
      ['Client settings', 'Crawl scope, standard and thresholds, schedule and sign-in.', 'Client → Settings', 'done', 'DESIGNED'],
      ['Annotated ledger', 'The overlay view of findings on the live page. Separate file.', 'Field Ledger v4', 'done', 'DESIGNED'],
    ],
  },
  {
    label: 'MODALS',
    rows: [
      ['Generate a report', 'Audience, run, standard, sections, delivery, verdict warning.', 'Client → Generate report', 'done', 'DESIGNED'],
      ['Add a client site', 'Client, URL, standard, schedule, backend and journey setup. “Start the first run” lands on the new client’s Overview in its scanning state.', 'Header → Add a client site', 'done', 'DESIGNED'],
      ['Dismiss with a reason', 'Five reasons, required note, warning that the verdict does not change.', 'Finding detail → Dismiss', 'done', 'DESIGNED'],
      ['Undo a decision', 'What is being reverted, its effect, and that the log keeps both entries.', 'Activity → Undo this', 'done', 'DESIGNED'],
      ['Invite someone', 'Email, four roles with what each sees, client scoping.', 'Settings → People → Invite', 'done', 'DESIGNED'],
    ],
  },
  {
    label: 'STATES',
    rows: [
      ['Scan in progress', 'Progress, live counts, current URL. Findings readable as they land.', 'States', 'done', 'DESIGNED'],
      ['First run, no data', 'What the first run does and how long it takes. Wired as the real Portfolio empty state.', 'States · Portfolio via Tweaks', 'done', 'DESIGNED'],
      ['All clear', 'Clean verdict plus the honest 40% caveat and a manual-review offer.', 'States', 'done', 'DESIGNED'],
      ['Run failed', 'What failed, that old results are untouched, retry and allow-list.', 'States', 'done', 'DESIGNED'],
      ['Partial coverage', 'Auth-walled pages named and excluded rather than passed.', 'States', 'done', 'DESIGNED'],
      ['Overview · nothing blocking', 'Green variant of the blocking panel.', 'Cedar & Co → Overview', 'done', 'DESIGNED'],
      ['Overview · no journeys', 'Empty state with a record-a-journey CTA. Also on the Journeys tab.', 'Fern & Foster → Overview', 'done', 'DESIGNED'],
      ['Findings · filter empty', 'Client has findings, none in the chosen bucket. Offers “Show everything open”.', 'Halcyon Bank → Findings → Dismissed', 'done', 'DESIGNED'],
      ['Activity · filter empty', 'Nobody touched this client in the window.', 'Cedar & Co → Activity', 'done', 'DESIGNED'],
      ['Report link expired / revoked', 'Access column states in the library.', 'Reports', 'done', 'DESIGNED'],
      ['Test account · 4 states', 'Working, password expired, sign-in failed, none set. Amber states carry a nav badge.', 'Acme (expired), Brightside (failed), Halcyon (working), Cedar (none)', 'done', 'DESIGNED'],
    ],
  },
  {
    label: 'ACTION INVENTORY — EVERY CONTROL AND WHAT IT DOES',
    rows: [
      ['AA mark', 'Returns to Portfolio from anywhere, workspace or client scope.', 'Header', 'done', 'WIRED'],
      ['Find a client / ⌘K', 'Expands the field, focuses it, filters clients by name or domain. A result enters that client and closes the panel. Esc or ✕ closes.', 'Header', 'done', 'WIRED'],
      ['Add a client site', 'Opens the setup modal. “Start the first run” adds the site, enters it, and confirms by toast.', 'Header', 'done', 'WIRED'],
      ['Avatar', 'Presence only — shows who is signed in on hover. No menu; account actions belong to auth, which is out of scope.', 'Header', 'scope', 'DISPLAY'],
      ['Sort / owner / pages / status / people / range', 'Each opens a real menu, shows a tick on the current choice, applies the label and closes. Clicking anywhere else closes it.', 'Portfolio, Findings, Activity', 'done', 'WIRED'],
      ['KPI tiles', 'Read-only summary of the whole portfolio. Not clickable by design — the table below is the worklist.', 'Portfolio', 'scope', 'DISPLAY'],
      ['Client row', 'Enters that client at Overview. The chevron is affordance only, not a separate target.', 'Portfolio', 'done', 'WIRED'],
      ['Re-run now / Try again now', 'Queues a run for this client and confirms by toast. Existing results stay untouched until the run lands.', 'Client bar, Run failed', 'done', 'WIRED'],
      ['Compare runs · All N runs', 'Both confirm the comparison they would open. The run-diff screen itself is out of scope for v1.', 'Overview', 'done', 'WIRED'],
      ['Diff tiles · blocking rows · journey cards', 'Diff tiles open the findings list; a blocking row opens that exact finding; a journey card opens Journeys.', 'Overview', 'done', 'WIRED'],
      ['Severity filters', 'Filter the findings table in place. Counts on each chip are live. Empty result offers “Show everything open”.', 'Findings', 'done', 'WIRED'],
      ['Mark as fixed', 'Sets the finding to “Retest due” — it stays open and counted until the next run confirms it. Reflected everywhere immediately.', 'Finding detail', 'done', 'WIRED'],
      ['Dismiss with a reason', 'Requires a reason and a note, then moves the finding to Dismissed, drops it from open counts, and logs it. The verdict does not change.', 'Finding detail', 'done', 'WIRED'],
      ['Copy the fix · Send to Jira · View in ledger', 'Each confirms its outcome by toast. Jira ticket creation is vendor-owned beyond that point.', 'Finding detail', 'done', 'WIRED'],
      ['Open · Link · Copy · Revoke', 'Open loads that report in the builder. Link previews the client’s read-only view. Copy and Revoke confirm by toast.', 'Reports library', 'done', 'WIRED'],
      ['Audience picker', 'Switches the report between legal, developer and executive: the preview, title, kicker and section list all change with it, and the report is marked unsaved.', 'Report builder', 'done', 'WIRED'],
      ['What goes in · Standard', 'Both are derived, not input — the audience decides the sections, the client’s contract decides the standard. Shown so the reader can see why the report looks the way it does.', 'Report builder', 'scope', 'DERIVED'],
      ['Download PDF · Re-issue', 'Download confirms; Re-issue clears the unsaved-changes banner and confirms that the client link now shows this version.', 'Report builder', 'done', 'WIRED'],
      ['Undo this', 'Opens the confirm dialog, then flips the row to “Undone” and adds a second log entry rather than erasing the first.', 'Activity', 'done', 'WIRED'],
      ['Export log', 'Confirms a CSV export of the current filter.', 'Activity', 'done', 'WIRED'],
      ['Every toggle', 'All switches are real: link options, notifications, report defaults, delivery, backend testing, AI suggestions. State persists while you move around the tool.', 'Settings, modals', 'done', 'WIRED'],
      ['Skip-path chips', 'The ✕ removes the pattern and confirms it will be crawled next run. “+ add a pattern” explains the format.', 'Client settings → Scanning', 'done', 'WIRED'],
      ['Invite someone · Change · Edit · Configure', 'Invite sends and confirms pending state. The rest confirm what will happen and when it takes effect.', 'Settings', 'done', 'WIRED'],
      ['Interface size', 'Applies immediately to the whole tool, per person, and never changes a report.', 'Settings → Display', 'done', 'WIRED'],
      ['Toast', 'One pattern for every confirmation: what happened, in plain language. Auto-dismisses after four seconds, or ✕ to close.', 'Everywhere', 'done', 'WIRED'],
    ],
  },
  {
    label: 'DELIBERATELY NOT DESIGNED — DO NOT INVENT',
    rows: [
      ['Sign-in, SSO, password reset', 'Auth is out of scope for this redesign.', '—', 'scope', 'OUT OF SCOPE'],
      ['Billing and contracts', 'Handled in the agency’s finance system, not here.', '—', 'scope', 'OUT OF SCOPE'],
      ['Mobile and tablet layouts', 'Desktop-only tool. Do not improvise a responsive version.', '—', 'scope', 'OUT OF SCOPE'],
      ['Email and Slack templates', 'Copy exists in Settings; the messages themselves are not designed.', '—', 'scope', 'OUT OF SCOPE'],
      ['Compare runs / all runs', 'Buttons are present on Overview. Hide them in v1.', 'Overview', 'hide', 'HIDE IN V1'],
      ['Record / edit a journey', 'Flow builder is a separate project. Hide the CTA in v1.', 'Journeys', 'hide', 'HIDE IN V1'],
      ['Book a manual review', 'Scheduling flow not designed. Hide in v1.', 'States, Overview', 'hide', 'HIDE IN V1'],
      ['Send to Jira / Configure tools', 'Third-party OAuth screens are vendor-owned. Hide in v1.', 'Finding detail, Settings', 'hide', 'HIDE IN V1'],
      ['Run-diff screen', 'Compare runs confirms the action; the side-by-side diff screen itself is not designed.', 'Overview', 'scope', 'OUT OF SCOPE'],
      ['Notifications inbox', 'Run alerts are email and Slack only. No in-app inbox, and the avatar has no menu.', 'Header', 'scope', 'OUT OF SCOPE'],
      ['Text entry behaviour', 'Fields in modals and Settings are shown at rest. Typing, validation and error states use the platform’s standard input behaviour.', 'Modals, Settings', 'scope', 'OUT OF SCOPE'],
      ['Delete or archive a client', 'Not designed. Pagination for the client table is also unspecified — v1 renders the full list.', 'Portfolio', 'scope', 'OUT OF SCOPE'],
    ],
  },
];

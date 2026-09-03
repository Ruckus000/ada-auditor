import { describe, expect, it } from 'vitest';

import { HINT_FLOOR, HINT_MARGIN, languageHint, scoreLanguages } from '../../src/domain/language-hint';
import { LANGUAGES, languageName } from '../../src/domain/languages';

/**
 * The language hint, over invented sentences only.
 *
 * Every fixture below is made up — a committee that meets on a Tuesday, in
 * nine languages. No real document's words enter a tracked file; the real
 * corpus is measured by `experiments/document-remediation/measure-language-hint.mts`
 * and reported as counts.
 */

const EN =
  'The committee will meet on the first Tuesday of the month to review the applications that were received. '
  + 'Members of the public are welcome to attend and may speak for three minutes on any item that is on the agenda. '
  + 'Copies of the report are available at the front desk.';
const ES =
  'La junta se reunirá el primer martes de cada mes para revisar las solicitudes que se recibieron. '
  + 'Los miembros del público pueden asistir y hablar durante tres minutos sobre cualquier tema que esté en la agenda. '
  + 'Las copias del informe están disponibles en la recepción.';
const FR =
  'Le conseil se réunira le premier mardi du mois pour examiner les demandes qui ont été reçues. '
  + 'Les membres du public peuvent assister à la séance et prendre la parole pendant trois minutes sur un point de l’ordre du jour. '
  + 'Des copies du rapport sont disponibles à l’accueil.';
const PT =
  'A comissão vai reunir-se na primeira terça-feira de cada mês para analisar os pedidos que foram recebidos. '
  + 'Os membros do público podem assistir e falar durante três minutos sobre qualquer assunto da agenda. '
  + 'As cópias do relatório estão disponíveis na recepção.';
const VI =
  'Ủy ban sẽ họp vào thứ ba đầu tiên của mỗi tháng để xem xét các đơn đã được nhận. '
  + 'Những người dân có thể tham dự và phát biểu trong ba phút về bất kỳ mục nào trong chương trình. '
  + 'Các bản sao của báo cáo được cung cấp tại quầy lễ tân.';
const TL =
  'Ang komite ay magpupulong sa unang Martes ng bawat buwan upang suriin ang mga aplikasyon na natanggap. '
  + 'Ang mga miyembro ng publiko ay maaaring dumalo at magsalita ng tatlong minuto tungkol sa anumang bagay na nasa agenda. '
  + 'Ang mga kopya ng ulat ay makukuha sa harap.';
const ZH = '委员会将于每月第一个星期二开会审查收到的申请。欢迎公众出席，并可就议程上的任何项目发言三分钟。报告的副本可在前台索取。';
const KO =
  '위원회는 매월 첫째 화요일에 회의를 열어 접수된 신청서를 검토합니다. '
  + '일반 시민은 회의에 참석할 수 있으며 안건에 대해 삼 분 동안 발언할 수 있습니다. 보고서 사본은 안내 데스크에서 받을 수 있습니다.';
const AR =
  'ستجتمع اللجنة في أول يوم ثلاثاء من كل شهر لمراجعة الطلبات التي تم استلامها. '
  + 'يمكن لأفراد الجمهور الحضور والتحدث لمدة ثلاث دقائق حول أي بند في جدول الأعمال. نسخ التقرير متاحة في مكتب الاستقبال.';
const JA = '委員会は毎月第一火曜日に会議を開き、受け取った申請を審査します。一般の方も出席でき、議題の項目について三分間発言できます。報告書の写しは受付で入手できます。';

/** A reading whose only text is the reading order — the shape of a document with no headings. */
function fromOrder(...texts: Array<string | null>) {
  return { title: null, headingTexts: [], order: texts.map((text) => ({ type: 'P', text })) };
}

describe('languageHint', () => {
  it.each([
    ['en', EN],
    ['es', ES],
    ['fr', FR],
    ['pt', PT],
    ['vi', VI],
    ['tl', TL],
    ['zh', ZH],
    ['ko', KO],
    ['ar', AR],
  ])('reads a %s paragraph as %s, with the evidence counted', (tag, text) => {
    const hint = languageHint(fromOrder(text));
    expect(hint).not.toBeNull();
    expect(hint!.suggested).toBe(tag);
    expect(hint!.evidence).toBeGreaterThanOrEqual(HINT_FLOOR);
    expect(hint!.evidence).toBe(scoreLanguages(fromOrder(text))[0].count);
  });

  it('suggests only a primary subtag — `en`, never `en-US` — and only tags the vocabulary names', () => {
    for (const text of [EN, ES, FR, PT, VI, TL, ZH, KO, AR]) {
      const hint = languageHint(fromOrder(text))!;
      expect(hint.suggested).not.toContain('-');
      expect(LANGUAGES.some(([tag]) => tag === hint.suggested)).toBe(true);
    }
  });

  it('reads the title and the headings as well as the reading order', () => {
    const hint = languageHint({
      title: 'Notice of the meeting of the committee of the town',
      headingTexts: [{ level: 'H1', text: 'The agenda for the month' }, { level: 'H2', text: null }],
      order: [{ type: 'Figure', text: null }],
    });
    expect(hint).toEqual({ suggested: 'en', evidence: 9 });
  });

  it('abstains under the floor: seven matches is not a suggestion, eight is', () => {
    expect(HINT_FLOOR).toBe(8);
    expect(languageHint(fromOrder(Array(7).fill('the').join(' ')))).toBeNull();
    expect(languageHint(fromOrder(Array(8).fill('the').join(' ')))).toEqual({ suggested: 'en', evidence: 8 });
  });

  it('abstains inside the margin: the winner must reach twice the runner-up', () => {
    expect(HINT_MARGIN).toBe(2);
    const the = Array(8).fill('the').join(' ');
    expect(languageHint(fromOrder(the, Array(4).fill('el').join(' ')))).toEqual({ suggested: 'en', evidence: 8 });
    expect(languageHint(fromOrder(the, Array(5).fill('el').join(' ')))).toBeNull();
  });

  it('abstains on a bilingual notice rather than pick a side', () => {
    // The commonest municipal shape after English alone: the same notice in
    // English and Spanish. Neither half is the document's language.
    expect(languageHint(fromOrder(EN, ES))).toBeNull();
  });

  it('abstains on Japanese rather than read its Han characters as Chinese', () => {
    expect(languageHint(fromOrder(JA))).toBeNull();
    expect(scoreLanguages(fromOrder(JA)).map((score) => score.tag)).toContain('ja');
  });

  it('abstains on a title alone and on nothing at all', () => {
    expect(languageHint({ title: 'Agenda', headingTexts: [], order: [] })).toBeNull();
    expect(languageHint({ title: null, headingTexts: [], order: [] })).toBeNull();
    expect(languageHint(fromOrder(null, null))).toBeNull();
  });

  it('is not fooled by case or by a decomposed accent', () => {
    // A heading in capitals, and a Portuguese "não" spelled with a combining
    // tilde, both count as the words they are.
    expect(languageHint(fromOrder('THE MINUTES OF THE MEETING OF THE BOARD AND THE COMMITTEE OF THE TOWN'))!.suggested).toBe('en');
    const decomposed = 'na\u0303o';
    expect(decomposed).not.toBe('n\u00e3o');
    expect(scoreLanguages(fromOrder(Array(8).fill(decomposed).join(' ')))).toEqual([{ tag: 'pt', count: 8 }]);
  });
});

describe('the vocabulary', () => {
  it('names every tag the hint can suggest, and falls back to the tag', () => {
    expect(languageName('es')).toBe('Spanish');
    expect(languageName('en')).toBe('English');
    expect(languageName('cy-GB')).toBe('cy-GB');
  });
});

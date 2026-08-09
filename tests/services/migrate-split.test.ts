import { describe, expect, it } from 'vitest';
import { splitStatements } from '../../scripts/migrate';

/**
 * The schema is shipped one statement per request (Neon's HTTP driver), so the
 * splitter is load-bearing: get it wrong and `npm run migrate` fails halfway
 * through, leaving a database in a state no file describes.
 */
describe('splitStatements', () => {
  it('splits plain statements', () => {
    expect(splitStatements('select 1; select 2;')).toEqual(['select 1', 'select 2']);
  });

  it('drops comment lines so a semicolon inside one cannot split a statement', () => {
    const sql = `-- a comment; with a semicolon
select 1;`;
    expect(splitStatements(sql)).toEqual(['select 1']);
  });

  it('keeps a dollar-quoted block whole', () => {
    // `add constraint` has no `if not exists`, so the schema guards it with an
    // exception handler. Splitting naively on `;` turns that one block into
    // three fragments, each a syntax error.
    const sql = `do $$ begin
  alter table runs add constraint runs_journey_fk foreign key (journey_id) references journeys (id);
exception when duplicate_object then null; end $$;
select 1;`;

    const statements = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('add constraint runs_journey_fk');
    expect(statements[0]).toContain('exception when duplicate_object');
    expect(statements[0].endsWith('end $$')).toBe(true);
    expect(statements[1]).toBe('select 1');
  });

  it('ignores a trailing statement with no terminator', () => {
    expect(splitStatements('select 1;\n\n')).toEqual(['select 1']);
  });
});

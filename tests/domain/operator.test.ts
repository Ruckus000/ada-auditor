import { afterEach, describe, expect, it } from 'vitest';
import { operatorInitials, operatorName } from '../../src/domain/operator';

describe('operatorName', () => {
  const original = process.env.AUDITOR_OPERATOR_NAME;

  afterEach(() => {
    if (original === undefined) delete process.env.AUDITOR_OPERATOR_NAME;
    else process.env.AUDITOR_OPERATOR_NAME = original;
  });

  it('uses the configured name', () => {
    process.env.AUDITOR_OPERATOR_NAME = 'Alex Reed';
    expect(operatorName()).toBe('Alex Reed');
  });

  it('falls back to a generic name rather than inventing a person', () => {
    // The prototype hardcoded "Jules Reyes" in four components, which read as
    // though the product knew who was signed in. It does not — there is one
    // shared token and no per-user identity.
    delete process.env.AUDITOR_OPERATOR_NAME;
    expect(operatorName()).toBe('Operator');
  });

  it.each(['', '   '])('treats %j as unset', (value) => {
    process.env.AUDITOR_OPERATOR_NAME = value;
    expect(operatorName()).toBe('Operator');
  });

  it('trims a padded value', () => {
    process.env.AUDITOR_OPERATOR_NAME = '  Alex Reed  ';
    expect(operatorName()).toBe('Alex Reed');
  });
});

describe('operatorInitials', () => {
  it.each([
    ['Alex Reed', 'AR'],
    ['Operator', 'O'],
    ['alex reed', 'AR'],
    ['Maria de la Cruz', 'MC'],
  ])('renders %j as %s', (name, expected) => {
    expect(operatorInitials(name)).toBe(expected);
  });

  it('degrades an avatar rather than a page on odd input', () => {
    expect(operatorInitials('   ')).toBe('O');
  });
});

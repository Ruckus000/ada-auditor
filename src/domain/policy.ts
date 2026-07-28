import type { Environment } from './contracts';

export type ActionClass =
  | 'login'
  | 'navigate'
  | 'inspect'
  | 'search'
  | 'filter'
  | 'paginate'
  | 'open-detail'
  | 'submit-safe'
  | 'mutate-test-data'
  | 'delete'
  | 'forbidden';

const allowedByEnvironment: Record<Environment, Set<ActionClass>> = {
  production: new Set(['login', 'navigate', 'inspect', 'search', 'filter', 'paginate', 'open-detail']),
  preview: new Set([
    'login',
    'navigate',
    'inspect',
    'search',
    'filter',
    'paginate',
    'open-detail',
    'submit-safe',
  ]),
  staging: new Set([
    'login',
    'navigate',
    'inspect',
    'search',
    'filter',
    'paginate',
    'open-detail',
    'submit-safe',
  ]),
  test: new Set([
    'login',
    'navigate',
    'inspect',
    'search',
    'filter',
    'paginate',
    'open-detail',
    'submit-safe',
    'mutate-test-data',
  ]),
};

const classifiedActions: Record<string, ActionClass> = {
  login: 'login',
  navigate: 'navigate',
  inspect: 'inspect',
  search: 'search',
  filter: 'filter',
  paginate: 'paginate',
  'open-detail': 'open-detail',
  'submit-safe': 'submit-safe',
  'mutate-test-data': 'mutate-test-data',
  delete: 'delete',
};

export function classifyAction(action: string): ActionClass {
  return classifiedActions[action] ?? 'forbidden';
}

export function isActionAllowed(environment: Environment, action: string): boolean {
  const actionClass = classifyAction(action);
  return actionClass !== 'forbidden' && allowedByEnvironment[environment].has(actionClass);
}

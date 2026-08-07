import { MIN_TOKEN_LENGTH, safeEqual } from './console-session';

export function extractRunToken(request: Request): string | null {
  const headerToken = request.headers.get('x-auditor-run-token');
  if (headerToken) {
    return headerToken;
  }

  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return null;
}

export function isRunAuthorized(request: Request): boolean {
  const configuredToken = process.env.AUDITOR_RUN_TOKEN;
  if (!configuredToken || configuredToken.length < MIN_TOKEN_LENGTH) {
    return false;
  }

  const providedToken = extractRunToken(request);
  if (!providedToken) {
    return false;
  }

  // Constant-time, matching how the console session validates the same secret.
  // A `===` here compared the deployment's only credential with an early-exit
  // comparison, which is a needless asymmetry when the safe helper is one
  // import away.
  return safeEqual(providedToken, configuredToken);
}

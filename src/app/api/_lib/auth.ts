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
  if (!configuredToken) {
    return false;
  }

  const providedToken = extractRunToken(request);
  return providedToken === configuredToken;
}

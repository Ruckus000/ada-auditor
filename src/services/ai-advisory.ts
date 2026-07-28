export type AiAdvisoryFinding = {
  code: 'ai-advisory';
  severity: 'advisory';
  source: 'ai-advisory';
  gateable: false;
  message: string;
  confidence: number;
};

export function createAiAdvisoryFinding(input: {
  message: string;
  confidence: number;
}): AiAdvisoryFinding {
  return {
    code: 'ai-advisory',
    severity: 'advisory',
    source: 'ai-advisory',
    gateable: false,
    ...input,
  };
}

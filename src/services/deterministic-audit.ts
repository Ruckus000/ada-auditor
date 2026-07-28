export type DeterministicFinding = {
  code: string;
  severity: 'critical' | 'major' | 'minor';
  message: string;
  source: 'deterministic';
};

export function runDeterministicAudit(input: { html: string }): DeterministicFinding[] {
  const missingImageAlt = /<img(?![^>]*alt=)/i.test(input.html);

  if (!missingImageAlt) {
    return [];
  }

  return [
    {
      code: 'missing-image-alt',
      severity: 'critical',
      message: 'Image is missing alt text.',
      source: 'deterministic',
    },
  ];
}

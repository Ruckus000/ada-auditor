import { documentStructureSchema, type DocumentStructure } from '../../domain/document-structure';
import { runStage, type StageExecutor, type StageResult } from './stage';
import type { Env, JavaRuntime } from './java-runtime';

/**
 * Reads a PDF's structure tree and reports what is in it.
 *
 * The first stage to graduate out of `experiments/document-remediation/`, and
 * deliberately the only one in this slice: it opens a document, walks the tree
 * and prints what it found. It writes no PDF, so the worst a bug here can do is
 * report the wrong numbers — where a repair stage's worst case is a delivered
 * file with a wrong claim baked into it, invisible to whoever receives it.
 *
 * Proving the boundary on the harmless stage first is the point.
 *
 * `Inspect` resolves the RoleMap as it walks, which is why this cannot be
 * replaced by scanning the raw bytes for `/H1` or `/TH` tokens: real structure
 * trees live in compressed object streams, and a grep over them returns nothing
 * while the tree is perfectly well populated.
 */
export async function inspectDocument(
  pdfPath: string,
  options: {
    root?: string;
    env?: Env;
    timeoutMs?: number;
    executor?: StageExecutor;
    runtime?: JavaRuntime;
  } = {},
): Promise<StageResult<DocumentStructure>> {
  return runStage('Inspect', [pdfPath], documentStructureSchema, options);
}

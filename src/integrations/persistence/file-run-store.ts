import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Environment } from '../../domain/contracts';
import type { RunStore, StoredRunRecord } from '../../domain/persistence';

function recordPath(storeDir: string, requestId: string): string {
  return join(storeDir, `${requestId}.json`);
}

function parseRecord(raw: string): StoredRunRecord | null {
  try {
    return JSON.parse(raw) as StoredRunRecord;
  } catch {
    return null;
  }
}

export class FileRunStore implements RunStore {
  constructor(private readonly storeDir: string) {}

  async ensureDir(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
  }

  async saveRun(record: StoredRunRecord): Promise<void> {
    await this.ensureDir();
    await writeFile(recordPath(this.storeDir, record.requestId), JSON.stringify(record, null, 2), 'utf8');
  }

  async getRun(requestId: string): Promise<StoredRunRecord | null> {
    try {
      const raw = await readFile(recordPath(this.storeDir, requestId), 'utf8');
      return parseRecord(raw);
    } catch {
      return null;
    }
  }

  async getLatestRun(
    journeyId: string,
    environment: Environment,
    excludeRequestId?: string,
  ): Promise<StoredRunRecord | null> {
    let entries: string[];
    try {
      entries = await readdir(this.storeDir);
    } catch {
      return null;
    }

    const records: StoredRunRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }

      try {
        const raw = await readFile(join(this.storeDir, entry), 'utf8');
        const record = parseRecord(raw);
        if (!record) {
          continue;
        }
        if (record.journeyId !== journeyId || record.environment !== environment) {
          continue;
        }
        if (excludeRequestId && record.requestId === excludeRequestId) {
          continue;
        }
        records.push(record);
      } catch {
        continue;
      }
    }

    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return records[0] ?? null;
  }
}

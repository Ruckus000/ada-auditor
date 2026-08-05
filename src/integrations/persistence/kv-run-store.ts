import type { Environment } from '../../domain/contracts';
import type { RunStore, StoredRunRecord } from '../../domain/persistence';

export type KvClient = {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<unknown>;
};

function runKey(requestId: string): string {
  return `run:${requestId}`;
}

function latestKey(journeyId: string, environment: Environment): string {
  return `latest:${journeyId}:${environment}`;
}

function previousKey(journeyId: string, environment: Environment): string {
  return `previous:${journeyId}:${environment}`;
}

export class KvRunStore implements RunStore {
  constructor(private readonly kv: KvClient) {}

  async saveRun(record: StoredRunRecord): Promise<void> {
    const latest = latestKey(record.journeyId, record.environment);
    const previous = previousKey(record.journeyId, record.environment);
    const currentLatest = await this.kv.get<string>(latest);

    await this.kv.set(runKey(record.requestId), record);

    if (currentLatest && currentLatest !== record.requestId) {
      await this.kv.set(previous, currentLatest);
    }

    await this.kv.set(latest, record.requestId);
  }

  async getRun(requestId: string): Promise<StoredRunRecord | null> {
    return this.kv.get<StoredRunRecord>(runKey(requestId));
  }

  async getLatestRun(
    journeyId: string,
    environment: Environment,
    excludeRequestId?: string,
  ): Promise<StoredRunRecord | null> {
    let requestId = await this.kv.get<string>(latestKey(journeyId, environment));
    const previousId = await this.kv.get<string>(previousKey(journeyId, environment));

    if (excludeRequestId && requestId === excludeRequestId) {
      requestId = previousId;
    }

    if (!requestId) {
      return null;
    }

    const record = await this.getRun(requestId);
    if (record) {
      return record;
    }

    if (previousId && previousId !== requestId) {
      return this.getRun(previousId);
    }

    return null;
  }
}

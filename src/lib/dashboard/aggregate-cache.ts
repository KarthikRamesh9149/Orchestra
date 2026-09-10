type CacheEntry<T> = {
  storedAt: number;
  value: T;
};

const MAX_AGGREGATE_CACHE_ENTRIES = 500;
const aggregateCache = new Map<string, CacheEntry<unknown>>();

function scopedKey(scope: string, key: string) {
  return `${scope}:${key}`;
}

function pruneAggregateCache() {
  if (aggregateCache.size <= MAX_AGGREGATE_CACHE_ENTRIES) {
    return;
  }

  const overflow = aggregateCache.size - MAX_AGGREGATE_CACHE_ENTRIES;
  const keys = aggregateCache.keys();
  for (let index = 0; index < overflow; index += 1) {
    const next = keys.next();
    if (next.done) break;
    aggregateCache.delete(next.value);
  }
}

export function getAggregateCache<T>(scope: string, key: string, ttlMs: number): T | null {
  const cacheKey = scopedKey(scope, key);
  const entry = aggregateCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.storedAt > ttlMs) {
    aggregateCache.delete(cacheKey);
    return null;
  }

  return entry.value as T;
}

export function setAggregateCache<T>(scope: string, key: string, value: T) {
  aggregateCache.set(scopedKey(scope, key), { storedAt: Date.now(), value });
  pruneAggregateCache();
}

export function invalidateProjectAggregateCaches(projectId: string) {
  const projectMarker = `:${projectId}:`;
  for (const key of aggregateCache.keys()) {
    if (key.includes(projectMarker)) {
      aggregateCache.delete(key);
    }
  }
}

export function clearAggregateCachesForTests() {
  aggregateCache.clear();
}

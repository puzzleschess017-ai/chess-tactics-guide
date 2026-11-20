const STORAGE_PREFIX = 'ctg_hist_v1';

export interface BucketHistoryState {
  used: string[];
  last: string | null;
}

export function getEffectiveUserKey(
  authUserId?: string | null,
  anonymousId?: string | null
): string {
  const uid = authUserId?.trim() || anonymousId?.trim();
  return uid || 'guest';
}

function buildStorageKey(namespace: string, userKey: string, bucket: string): string {
  return `${STORAGE_PREFIX}:${namespace}:${userKey}:${bucket}`;
}

export function readBucketHistory(
  namespace: string,
  userKey: string,
  bucket: string
): BucketHistoryState {
  try {
    if (typeof localStorage === 'undefined') {
      return { used: [], last: null };
    }
    const raw = localStorage.getItem(buildStorageKey(namespace, userKey, bucket));
    if (!raw) return { used: [], last: null };
    const parsed = JSON.parse(raw) as Partial<BucketHistoryState>;
    return {
      used: Array.isArray(parsed.used)
        ? parsed.used.filter((v): v is string => typeof v === 'string' && v.length > 0)
        : [],
      last: typeof parsed.last === 'string' && parsed.last.length > 0 ? parsed.last : null,
    };
  } catch {
    return { used: [], last: null };
  }
}

export function writeBucketHistory(
  namespace: string,
  userKey: string,
  bucket: string,
  state: BucketHistoryState
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(buildStorageKey(namespace, userKey, bucket), JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function recordLastItem(
  namespace: string,
  userKey: string,
  bucket: string,
  itemKey: string,
  maxUsedHistory = 200
): void {
  const current = readBucketHistory(namespace, userKey, bucket);
  const nextUsed = current.used.includes(itemKey)
    ? current.used
    : [...current.used, itemKey].slice(-maxUsedHistory);
  writeBucketHistory(namespace, userKey, bucket, {
    used: nextUsed,
    last: itemKey,
  });
}

export function pickNonRepeatingFromPool<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  namespace: string,
  userKey: string,
  bucket: string
): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty pool');
  }
  const state = readBucketHistory(namespace, userKey, bucket);
  const usedSet = new Set(state.used);
  let candidates = items.filter((item) => {
    const k = getKey(item);
    return !usedSet.has(k) && k !== state.last;
  });

  let nextUsed: string[];
  if (candidates.length > 0) {
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    const pickedKey = getKey(picked);
    nextUsed = [...state.used, pickedKey];
    writeBucketHistory(namespace, userKey, bucket, {
      used: nextUsed,
      last: pickedKey,
    });
    return picked;
  }

  // All items in this pool were seen -> reset pool cycle while avoiding immediate repeat
  const nonRepeatPool =
    items.length > 1 ? items.filter((item) => getKey(item) !== state.last) : items;
  candidates = nonRepeatPool.length > 0 ? [...nonRepeatPool] : [...items];
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const pickedKey = getKey(picked);
  writeBucketHistory(namespace, userKey, bucket, {
    used: [pickedKey],
    last: pickedKey,
  });
  return picked;
}

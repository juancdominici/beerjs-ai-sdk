import { startersSchema, type Starters } from '../shared/contracts';

const CACHE_KEY = 'beerjs:starters:v4';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000;
let request: Promise<Starters> | undefined;

export function readCachedStarters(): Starters | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (typeof cached?.expiresAt === 'number' && cached.expiresAt > Date.now()) {
      const parsed = startersSchema.safeParse(cached.starters);
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Storage can be disabled or contain invalid JSON.
  }
}

export function loadStarters(): Promise<Starters> {
  const cached = readCachedStarters();
  if (cached) return Promise.resolve(cached);

  request ??= fetch('/api/starters')
    .then(async (response) => {
      if (!response.ok) throw new Error('No se pudieron cargar los ejemplos.');
      const starters = startersSchema.parse(await response.json());
      if (response.headers.get('Cache-Control') !== 'no-store') {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({
            expiresAt: Date.now() + CACHE_DURATION_MS,
            starters,
          }));
        } catch {
          // The suggestions are usable even when storage is unavailable.
        }
      }
      return starters;
    })
    .finally(() => { request = undefined; });
  return request;
}

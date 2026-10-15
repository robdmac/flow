// REVISION: flow-v1-color-cache
//
// The view's colours as OpenTUI has them, made once while in use (pure: the
// view hands it how to make one, from the running opencode's own RGBA).

/** How many colours `colorCache` keeps before it starts afresh. */
export const COLOR_CACHE_MAX = 4096

/**
 * Each colour as OpenTUI has it, made once and kept while it's in use. Most frames repeat the last one's
 * colours, but waiting's breath, the night and a tint easing in make new ones every frame, without end
 * (earthrise reaches tens of thousands in a quarter of an hour), so past `max` it starts afresh.
 */
export function colorCache<T>(make: (c: number) => T, max = COLOR_CACHE_MAX): (c: number) => T {
  const kept = new Map<number, T>()
  return c => {
    let v = kept.get(c)
    if (v === undefined) {
      if (kept.size >= max) kept.clear()
      kept.set(c, (v = make(c)))
    }
    return v
  }
}

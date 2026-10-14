// Average-linkage agglomerative clustering over cosine similarity.
//
// Starts with every tab in its own cluster and repeatedly merges the most
// similar pair until no pair's mean pairwise similarity exceeds THRESHOLD.
// O(n^3) in the worst case, which is fine for the few hundred tabs a person
// realistically has open.

// Title+hostname embeddings are a shallow signal, so a strict threshold left
// almost every tab in its own singleton group. 0.3 merges more readily; tune
// further once you've seen it against a realistic set of open tabs.
export const THRESHOLD = 0.3;

// Embeddings are already L2-normalized, so the dot product is cosine similarity.
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * @param {number[]} ids
 * @param {Map<number, number[]>} vectors
 * @returns {number[][]} clusters of ids, largest first
 */
export function cluster(ids, vectors, threshold = THRESHOLD) {
  const n = ids.length;
  const sim = Array.from({ length: n }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sim[i][j] = sim[j][i] = dot(vectors.get(ids[i]), vectors.get(ids[j]));
    }
  }

  let groups = ids.map((_, i) => [i]);
  for (;;) {
    let best = -Infinity, bi = -1, bj = -1;
    for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        let total = 0;
        for (const i of groups[a]) for (const j of groups[b]) total += sim[i][j];
        const avg = total / (groups[a].length * groups[b].length);
        if (avg > best) [best, bi, bj] = [avg, a, b];
      }
    }
    if (best < threshold) break;
    groups[bi] = groups[bi].concat(groups[bj]);
    groups.splice(bj, 1);
  }

  return groups
    .sort((a, b) => b.length - a.length)
    .map((g) => g.map((i) => ids[i]));
}

const STOPWORDS = new Set(
  (
    // Function words.
    'the a an and or of to in on for with at by from is are be how what your you my tab page home www com org net html '
    // Generic marketing/filler words: shared across unrelated titles often
    // enough to look like a real topic match (e.g. "Free Faces" + "170,000
    // Free Fonts" sharing only "free"), without describing anything.
    + 'free best top new download now online official easy simple get make app site'
  ).split(' '),
);

/**
 * A short human label for a cluster of tabs with no shared category (see
 * categories.js, which groups categorized tabs directly): words shared by
 * several titles, or the most prominent words in a singleton's title, or the
 * common host as a last resort.
 */
export function labelFor(tabs) {
  const counts = new Map();
  const order = [];
  for (const tab of tabs) {
    const words = tab.title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    for (const w of new Set(words)) {
      if (STOPWORDS.has(w)) continue;
      if (!counts.has(w)) order.push(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const minCount = tabs.length > 1 ? 2 : 1;
  const ranked = order
    .filter((w) => counts.get(w) >= minCount)
    .sort((a, b) => counts.get(b) - counts.get(a))
    .slice(0, 3);
  if (ranked.length) return ranked.join(' · ');

  const hosts = tabs.map((t) => {
    try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  });
  const top = mode(hosts.filter(Boolean));
  return top || tabs[0]?.title || 'Other';
}

function mode(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

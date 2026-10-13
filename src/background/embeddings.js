// Sentence embeddings for tabs using all-MiniLM-L6-v2 via transformers.js.
//
// Embeddings are cached in storage keyed by a hash of the embedded text, so
// the (slow) model only runs for tabs whose title or URL changed. The model
// itself (~23 MB quantized) is downloaded from the Hugging Face hub on first
// use and then served from the Cache API.

import { env, pipeline } from '@xenova/transformers';
import { KEYS, mutate, read } from './store.js';

const MODEL = 'Xenova/all-MiniLM-L6-v2';

env.allowLocalModels = false;
env.useBrowserCache = true;
// Service workers cannot spawn the worker threads ORT uses for multithreading,
// and MV3 forbids loading the wasm binaries from a CDN.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('wasm/');

let extractorPromise = null;

function getExtractor() {
  extractorPromise ??= pipeline('feature-extraction', MODEL, { quantized: true }).catch((err) => {
    extractorPromise = null; // allow a retry, e.g. after a network failure
    throw err;
  });
  return extractorPromise;
}

export function tabText(tab) {
  let url = tab.url;
  try {
    const u = new URL(tab.url);
    url = u.hostname + u.pathname; // query strings and fragments are mostly noise
  } catch {}
  return `${tab.title} ${url}`.slice(0, 512);
}

// FNV-1a; only needs to be stable and cheap, not cryptographic.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + text.length;
}

const round = (x) => Math.round(x * 1e5) / 1e5;

/** Unit-length embeddings for arbitrary strings (not cached — callers cache if needed). */
export async function embedTexts(texts) {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return output.tolist().map((vec) => vec.map(round));
}

/**
 * Returns a Map of tabId -> unit-length embedding for the given tabs,
 * computing any that are missing. With `prune`, cache entries for any tab not
 * in `tabs` are dropped, so only pass it when `tabs` is every open tab.
 */
export async function embedTabs(tabs, { prune = false } = {}) {
  const keyed = tabs.map((tab) => ({ tab, key: hash(tabText(tab)) }));
  const cache = await read(KEYS.embeddings, {});
  const missing = keyed.filter(({ key }) => !cache[key]);

  let fresh = {};
  if (missing.length) {
    const vectors = await embedTexts(missing.map(({ tab }) => tabText(tab)));
    missing.forEach(({ key }, i) => (fresh[key] = vectors[i]));
  }

  const liveKeys = new Set(keyed.map(({ key }) => key));
  const merged = await mutate(KEYS.embeddings, {}, (current) => {
    if (!prune) return { ...current, ...fresh };
    const next = {};
    for (const key of liveKeys) {
      const vec = fresh[key] ?? current[key];
      if (vec) next[key] = vec;
    }
    return next;
  });

  return new Map(keyed.filter(({ key }) => merged[key]).map(({ tab, key }) => [tab.id, merged[key]]));
}

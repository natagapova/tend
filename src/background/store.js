// All reads and writes to chrome.storage.local go through here.
//
// Tab events fire in bursts (e.g. onCreated + onUpdated + onActivated for one
// click), and each handler does an async read-modify-write. Without
// serialization, later writes would clobber earlier ones, so every mutation is
// queued on a single promise chain.

export const KEYS = {
  tabs: 'tabs',             // { [tabId]: TabRecord }
  embeddings: 'embeddings', // { [textHash]: number[] }
  decisions: 'decisions',   // DecisionRecord[]
};

let queue = Promise.resolve();

function enqueue(fn) {
  const run = queue.then(fn);
  // Keep the chain alive even if one mutation throws.
  queue = run.catch((err) => console.error('[tend] storage mutation failed', err));
  return run;
}

export async function read(key, fallback) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

/** Atomically apply `fn(current) => next` to one storage key. */
export function mutate(key, fallback, fn) {
  return enqueue(async () => {
    const current = await read(key, fallback);
    const next = await fn(current);
    await chrome.storage.local.set({ [key]: next });
    return next;
  });
}

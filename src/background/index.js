import { KEYS, mutate, read } from './store.js';
import { reconcile, registerTabListeners } from './tracker.js';
import { embedTabs } from './embeddings.js';
import { cluster, labelFor } from './cluster.js';
import { HALF_LIFE_HOURS, relevance } from '../shared/relevance.js';

// --- Embedding runs are serialized so a popup request and a background
// --- precompute never run the model on the same tabs at once.

let embedChain = Promise.resolve();

function embedAll() {
  const run = embedChain.then(async () => {
    const tabs = Object.values(await read(KEYS.tabs, {}));
    return { tabs, vectors: await embedTabs(tabs, { prune: true }) };
  });
  embedChain = run.catch(() => {});
  return run;
}

// Warm the embedding cache shortly after tabs change so the popup opens fast.
let precomputeTimer;
function schedulePrecompute() {
  clearTimeout(precomputeTimer);
  precomputeTimer = setTimeout(() => {
    embedAll().catch((err) => console.warn('[tend] precompute failed', err));
  }, 2000);
}

// --- Listeners must be registered synchronously at top level so Chrome can
// --- wake the service worker for them.

registerTabListeners(schedulePrecompute);

chrome.runtime.onInstalled.addListener(() => reconcile().then(schedulePrecompute));
chrome.runtime.onStartup.addListener(() => reconcile().then(schedulePrecompute));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
  );
  return true; // keep the channel open for the async response
});

const handlers = {
  async getClusters() {
    // Catch up on anything missed while the worker was asleep.
    await reconcile();
    const { tabs, vectors } = await embedAll();
    const byId = new Map(tabs.map((t) => [t.id, t]));
    const ids = tabs.map((t) => t.id).filter((id) => vectors.has(id));
    const now = Date.now();

    return cluster(ids, vectors).map((memberIds, index) => {
      const members = memberIds.map((id) => byId.get(id));
      return {
        id: index,
        label: labelFor(members),
        tabs: members.map((t) => ({ ...t, relevance: relevance(t, now) })),
      };
    });
  },

  /** msg: { tabId, action: 'keep' | 'close', clusterLabel, clusterSize } */
  async decide({ tabId, action, clusterLabel, clusterSize }) {
    if (action !== 'keep' && action !== 'close') throw new Error(`Unknown action: ${action}`);
    const tab = (await read(KEYS.tabs, {}))[tabId];
    if (!tab) throw new Error('Tab is no longer open');

    const now = Date.now();
    const vectors = await embedTabs([tab]).catch(() => new Map());
    const record = {
      action,
      decidedAt: now,
      url: tab.url,
      title: tab.title,
      openedAt: tab.openedAt,
      lastFocusedAt: tab.lastFocusedAt,
      relevance: relevance(tab, now),
      halfLifeHours: HALF_LIFE_HOURS,
      clusterLabel,
      clusterSize,
      embedding: vectors.get(tabId) ?? null,
    };
    await mutate(KEYS.decisions, [], (log) => [...log, record]);

    if (action === 'close') await chrome.tabs.remove(tabId);
    return record;
  },
};

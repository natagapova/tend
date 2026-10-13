import { KEYS, mutate, read } from './store.js';
import { reconcile, registerTabListeners } from './tracker.js';
import { embedTabs } from './embeddings.js';
import { cluster, labelFor } from './cluster.js';
import { groupByCategory } from './categories.js';
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
    const now = Date.now();
    const withRelevance = (members) => members.map((t) => ({ ...t, relevance: relevance(t, now) }));

    // Tabs that match a known topic are grouped by that topic directly —
    // LeetCode and GitHub both read "Programming" regardless of how similar
    // their embeddings are. Only the leftovers (no topic match) get grouped
    // by embedding similarity.
    const { grouped, rest } = groupByCategory(tabs);
    const categoryGroups = [...grouped].map(([label, members]) => ({
      label,
      tabs: withRelevance(members),
    }));

    const restIds = rest.map((t) => t.id).filter((id) => vectors.has(id));
    const similarityGroups = cluster(restIds, vectors).map((memberIds) => {
      const members = memberIds.map((id) => byId.get(id));
      return { label: labelFor(members), tabs: withRelevance(members) };
    });

    return [...categoryGroups, ...similarityGroups]
      .sort((a, b) => b.tabs.length - a.tabs.length)
      .map((group, index) => ({ id: index, ...group }));
  },

  /**
   * msg: { tabId, action: 'close', clusterLabel, clusterSize }
   *
   * The popup only offers "close" (no "keep") — leaving a tab open already
   * means keeping it, so a separate click added nothing but asked the user
   * for dead-end confirmation. Each close is still logged as a negative
   * signal: a future feature (e.g. recommending sites, or personalizing
   * relevance/clustering) could train on what people get rid of, by cluster
   * and by how stale the tab was. Nothing reads this log yet.
   */
  async decide({ tabId, action, clusterLabel, clusterSize }) {
    if (action !== 'close') throw new Error(`Unknown action: ${action}`);
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

    await chrome.tabs.remove(tabId);
    return record;
  },
};

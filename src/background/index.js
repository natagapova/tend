import { KEYS, mutate, read } from './store.js';
import { reconcile, registerTabListeners } from './tracker.js';
import { embedTabs } from './embeddings.js';
import { cluster, labelFor } from './cluster.js';
import { groupByCategory } from './categories.js';
import { modelCategory } from './modelCategories.js';
import { llmGroupTabs } from './llm.js';
import { HALF_LIFE_HOURS, relevance } from '../shared/relevance.js';

// --- Embedding runs are serialized so a popup request and a background
// --- precompute never run the model on the same tabs at once.

let embedChain = Promise.resolve();

// A tab's title/URL often doesn't say what it's for (e.g. a font foundry
// simply named "Free Faces"). content.js reads each page's meta description
// and reports it here; this merges those into the tab records used for both
// clustering and category matching.
async function attachDescriptions(tabs) {
  const descriptions = await read(KEYS.descriptions, {});
  return tabs.map((t) => (descriptions[t.id] ? { ...t, description: descriptions[t.id] } : t));
}

function embedAll() {
  const run = embedChain.then(async () => {
    const tabs = await attachDescriptions(Object.values(await read(KEYS.tabs, {})));
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

// Keyword categories, then a free on-device model guess for whatever the
// keywords missed, then embedding-similarity clustering for whatever's still
// unplaced. Used when no LLM key is set or the LLM call failed.
async function localGroups(tabs, vectors, byId, withRelevance) {
  const { grouped, rest } = groupByCategory(tabs);

  const stillRest = [];
  for (const tab of rest) {
    const category = await modelCategory(vectors.get(tab.id));
    if (!category) {
      stillRest.push(tab);
      continue;
    }
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(tab);
  }

  const categoryGroups = [...grouped].map(([label, members]) => ({
    label,
    tabs: withRelevance(members),
  }));

  const restIds = stillRest.map((t) => t.id).filter((id) => vectors.has(id));
  const similarityGroups = cluster(restIds, vectors).map((memberIds) => {
    const members = memberIds.map((id) => byId.get(id));
    return { label: labelFor(members), tabs: withRelevance(members) };
  });

  return [...categoryGroups, ...similarityGroups];
}

// --- Listeners must be registered synchronously at top level so Chrome can
// --- wake the service worker for them.

registerTabListeners(schedulePrecompute);

chrome.runtime.onInstalled.addListener(() => reconcile().then(schedulePrecompute));
chrome.runtime.onStartup.addListener(() => reconcile().then(schedulePrecompute));

// A stored description is only valid for the page it was read from — drop it
// as soon as that tab navigates or closes, so a stale description can't be
// attributed to whatever loads next.
const dropDescription = (tabId) => mutate(KEYS.descriptions, {}, ({ [tabId]: _dropped, ...rest }) => rest);
chrome.tabs.onRemoved.addListener((tabId) => dropDescription(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if ('url' in changeInfo) dropDescription(tabId);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(
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

    // If the user has set an API key, let a real LLM read each tab's actual
    // content and group/label them by purpose — this understands things
    // keyword matching can't (e.g. a joke site is "Leisure," not whatever
    // generic words are in its title). Falls through to the local pipeline
    // below on any failure: no key set, network error, or a malformed/
    // incomplete response.
    const llmGroups = await llmGroupTabs(tabs).catch(() => null);
    const groups = llmGroups
      ? llmGroups.map(({ label, tabIds }) => ({
          label,
          tabs: withRelevance(tabIds.map((id) => byId.get(id)).filter(Boolean)),
        }))
      : await localGroups(tabs, vectors, byId, withRelevance);

    return groups
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
    const rawTab = (await read(KEYS.tabs, {}))[tabId];
    if (!rawTab) throw new Error('Tab is no longer open');
    const [tab] = await attachDescriptions([rawTab]);

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

  /** msg: { description } — sent by content.js on page load. */
  async pageDescription({ description }, sender) {
    const tabId = sender?.tab?.id;
    console.log('[tend] pageDescription received for tab', tabId, JSON.stringify(description));
    if (tabId == null || !description) return;
    await mutate(KEYS.descriptions, {}, (map) => ({ ...map, [tabId]: description }));
  },
};

// Keeps the `tabs` map in storage in sync with the browser's open tabs.
//
// TabRecord: { id, windowId, url, title, openedAt, lastFocusedAt, active }
//
// Favicons are looked up at render time via chrome://_favicon (see popup.js),
// not stored here — that avoids needing host permissions for every site's
// favicon URL and sidesteps stale/missing favIconUrl values.
//
// `lastFocusedAt` is stamped both when a tab gains focus and when it loses it,
// so a tab you read for an hour and then left reports the time you left it.

import { KEYS, mutate } from './store.js';

function toRecord(tab, now, existing) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url || tab.pendingUrl || existing?.url || '',
    title: tab.title || existing?.title || '',
    openedAt: existing?.openedAt ?? now,
    lastFocusedAt: existing?.lastFocusedAt ?? tab.lastAccessed ?? now,
    active: tab.active,
  };
}

const updateTabs = (fn) => mutate(KEYS.tabs, {}, fn);

/**
 * Rebuild the map from chrome.tabs.query(). Tab IDs are not stable across
 * browser restarts, so stale IDs are dropped. For tabs we have never seen,
 * `tab.lastAccessed` (Chrome 121+) is the best available focus estimate and
 * also stands in for the unknown open time.
 */
export async function reconcile() {
  const open = await chrome.tabs.query({});
  const now = Date.now();
  return updateTabs((tabs) => {
    const next = {};
    for (const tab of open) {
      const existing = tabs[tab.id];
      next[tab.id] = toRecord(tab, now, existing);
      if (!existing && tab.lastAccessed) next[tab.id].openedAt = tab.lastAccessed;
      if (tab.active) next[tab.id].lastFocusedAt = now;
    }
    return next;
  });
}

function onCreated(tab) {
  const now = Date.now();
  return updateTabs((tabs) => ({ ...tabs, [tab.id]: toRecord(tab, now, null) }));
}

function onUpdated(tabId, changeInfo, tab) {
  if (!('url' in changeInfo) && !('title' in changeInfo)) return;
  const now = Date.now();
  return updateTabs((tabs) => ({ ...tabs, [tabId]: toRecord(tab, now, tabs[tabId]) }));
}

function onRemoved(tabId) {
  return updateTabs(({ [tabId]: _removed, ...rest }) => rest);
}

function onReplaced(addedTabId, removedTabId) {
  return updateTabs(({ [removedTabId]: old, ...rest }) =>
    old ? { ...rest, [addedTabId]: { ...old, id: addedTabId } } : rest,
  );
}

function focus(tabId, windowId) {
  const now = Date.now();
  return updateTabs((tabs) => {
    const next = { ...tabs };
    for (const rec of Object.values(next)) {
      // The previously active tab in this window is losing focus now.
      if (rec.windowId === windowId && rec.active && rec.id !== tabId) {
        next[rec.id] = { ...rec, active: false, lastFocusedAt: now };
      }
    }
    if (next[tabId]) next[tabId] = { ...next[tabId], active: true, lastFocusedAt: now };
    return next;
  });
}

function onActivated({ tabId, windowId }) {
  return focus(tabId, windowId);
}

async function onWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) return focus(tab.id, windowId);
}

function onAttached(tabId, { newWindowId }) {
  return updateTabs((tabs) =>
    tabs[tabId] ? { ...tabs, [tabId]: { ...tabs[tabId], windowId: newWindowId } } : tabs,
  );
}

/** Must be called synchronously at service-worker top level. */
export function registerTabListeners(onChange) {
  const wrap = (fn) => async (...args) => {
    await fn(...args);
    onChange();
  };
  chrome.tabs.onCreated.addListener(wrap(onCreated));
  chrome.tabs.onUpdated.addListener(wrap(onUpdated));
  chrome.tabs.onRemoved.addListener(wrap(onRemoved));
  chrome.tabs.onReplaced.addListener(wrap(onReplaced));
  chrome.tabs.onActivated.addListener(wrap(onActivated));
  chrome.tabs.onAttached.addListener(wrap(onAttached));
  chrome.windows.onFocusChanged.addListener(wrap(onWindowFocusChanged));
}

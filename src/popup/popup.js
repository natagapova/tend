// Tabs within a cluster are listed stalest first, since those are the ones
// worth deciding about. Relevance scores come from the background worker.

import { KEYS } from '../background/store.js';

const root = document.getElementById('clusters');
const summary = document.getElementById('summary');
const clusterTpl = document.getElementById('cluster-tpl');
const tabTpl = document.getElementById('tab-tpl');

// --- AI grouping settings (Anthropic API key) ---

const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const apiKeyInput = document.getElementById('api-key-input');
const apiKeySave = document.getElementById('api-key-save');
const settingsStatus = document.getElementById('settings-status');

settingsToggle.addEventListener('click', () => {
  settingsPanel.hidden = !settingsPanel.hidden;
});

chrome.storage.local.get(KEYS.anthropicApiKey).then((result) => {
  if (result[KEYS.anthropicApiKey]) {
    apiKeyInput.placeholder = '•••• saved ••••';
    settingsStatus.textContent = 'AI grouping is on.';
  }
});

apiKeySave.addEventListener('click', async () => {
  const value = apiKeyInput.value.trim();
  await chrome.storage.local.set({ [KEYS.anthropicApiKey]: value });
  apiKeyInput.value = '';
  apiKeyInput.placeholder = value ? '•••• saved ••••' : 'sk-ant-…';
  settingsStatus.textContent = value
    ? 'Saved. Reopen this popup to regroup with AI.'
    : 'Cleared — back to local-only grouping.';
});

async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (!res?.ok) throw new Error(res?.error ?? 'No response from background worker');
  return res.result;
}

function showStatus(text, isError = false) {
  root.replaceChildren();
  const p = document.createElement('p');
  p.className = isError ? 'status error' : 'status';
  p.textContent = text;
  root.append(p);
}

// Chrome's built-in favicon service (`favicon` permission) — avoids needing
// host permissions for every site and works even for favicon-less pages.
function faviconUrl(pageUrl, size = 32) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function renderTab(tab, clusterInfo) {
  const li = tabTpl.content.firstElementChild.cloneNode(true);
  const favicon = li.querySelector('.favicon');
  const title = li.querySelector('.title');
  const titleText = li.querySelector('.title-text');
  const host = li.querySelector('.host');
  const score = li.querySelector('.score');
  const scoreFill = li.querySelector('.score-fill');
  const close = li.querySelector('.close');

  favicon.src = faviconUrl(tab.url);
  titleText.textContent = tab.title || tab.url;
  host.textContent = hostOf(tab.url);
  title.title = tab.url;
  title.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  scoreFill.style.height = `${Math.round(tab.relevance * 100)}%`;
  score.title = `Relevance ${tab.relevance.toFixed(2)} · last focused ${new Date(tab.lastFocusedAt).toLocaleString()}`;

  close.addEventListener('click', async () => {
    close.disabled = true;
    try {
      await send({ type: 'decide', tabId: tab.id, action: 'close', ...clusterInfo });
      const section = li.closest('.cluster');
      li.classList.add('closing');
      li.addEventListener('transitionend', () => {
        li.remove();
        updateCount(section);
      }, { once: true });
    } catch (err) {
      close.disabled = false;
      summary.textContent = err.message;
    }
  });
  return li;
}

function updateCount(section) {
  const n = section.querySelectorAll('.tab').length;
  if (n === 0) section.remove();
  else section.querySelector('.count').textContent = `(${n})`;
  summary.textContent = `${root.querySelectorAll('.tab').length} tabs`;
}

function render(clusters) {
  root.replaceChildren();
  let total = 0;
  for (const c of clusters) {
    const section = clusterTpl.content.firstElementChild.cloneNode(true);
    section.querySelector('.label').textContent = c.label;
    section.querySelector('.count').textContent = `(${c.tabs.length})`;
    const ul = section.querySelector('ul');
    const clusterInfo = { clusterLabel: c.label, clusterSize: c.tabs.length };
    for (const tab of [...c.tabs].sort((a, b) => a.relevance - b.relevance)) {
      ul.append(renderTab(tab, clusterInfo));
    }
    root.append(section);
    total += c.tabs.length;
  }
  summary.textContent = `${total} tabs · ${clusters.length} groups`;
}

send({ type: 'getClusters' })
  .then((clusters) => (clusters.length ? render(clusters) : showStatus('No tabs to show.')))
  .catch((err) => showStatus(`Couldn't group tabs: ${err.message}`, true));

// Tabs within a cluster are listed stalest first, since those are the ones
// worth deciding about. Relevance scores come from the background worker.

const root = document.getElementById('clusters');
const summary = document.getElementById('summary');
const clusterTpl = document.getElementById('cluster-tpl');
const tabTpl = document.getElementById('tab-tpl');

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

function renderTab(tab, clusterInfo) {
  const li = tabTpl.content.firstElementChild.cloneNode(true);
  const score = li.querySelector('.score');
  const title = li.querySelector('.title');
  const keep = li.querySelector('.keep');
  const close = li.querySelector('.close');

  score.textContent = tab.relevance.toFixed(2);
  score.title = `Last focused ${new Date(tab.lastFocusedAt).toLocaleString()}`;
  title.textContent = tab.title || tab.url;
  title.title = tab.url;
  title.addEventListener('click', () => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  });

  const decide = async (action) => {
    keep.disabled = close.disabled = true;
    try {
      await send({ type: 'decide', tabId: tab.id, action, ...clusterInfo });
      if (action === 'close') {
        const section = li.closest('.cluster');
        li.remove();
        updateCount(section);
      } else {
        li.classList.add('kept');
      }
    } catch (err) {
      keep.disabled = close.disabled = false;
      summary.textContent = err.message;
    }
  };
  keep.addEventListener('click', () => decide('keep'));
  close.addEventListener('click', () => decide('close'));
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

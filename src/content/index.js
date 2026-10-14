// Sends the page's meta description to the background worker, so
// categorization/clustering can use more than just the tab's title and URL.
// Many sites (e.g. a font foundry simply named "Free Faces") don't say what
// they're about in the title at all — the description usually does.

function pageDescription() {
  const meta =
    document.querySelector('meta[name="description" i]') ??
    document.querySelector('meta[property="og:description" i]');
  return (meta?.content ?? '').trim().slice(0, 300);
}

const description = pageDescription();
console.log('[tend] content script ran on', location.href, '— description:', JSON.stringify(description));
if (description) {
  chrome.runtime.sendMessage({ type: 'pageDescription', description }).then(
    () => console.log('[tend] description delivered to background worker'),
    (err) => console.log('[tend] failed to deliver description:', err),
  );
}

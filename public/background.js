chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

const PENDING_PREFIX = 'rewind:pending-jump:';

// Scope each navigation request to its tab. Other open ChatGPT tabs cannot consume it.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'rewind:take-pending-jump' || sender.tab?.id == null) return;
  const key = `${PENDING_PREFIX}${sender.tab.id}`;
  (async () => {
    const pending = (await chrome.storage.local.get(key))[key];
    if (!pending) return { pending: null };
    const expired = !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > 60000;
    if (expired) {
      await chrome.storage.local.remove(key);
      return { pending: null };
    }
    if (pending.conversationId !== message.conversationId) return { pending: null };
    await chrome.storage.local.remove(key);
    return { pending };
  })().then(sendResponse).catch(error => sendResponse({ error: String(error) }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  void chrome.storage.local.remove(`${PENDING_PREFIX}${tabId}`);
});

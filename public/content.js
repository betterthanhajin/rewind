(() => {
  const STORAGE_PREFIX = 'rewind:conversation:';
  const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const normalizeText = text => (text || '').replace(/\s+/g, ' ').trim();
  const conversationId = () => {
    const match = location.pathname.match(/^\/(?:g\/[^/]+\/)?c\/([^/]+)\/?$/);
    return match ? `/c/${match[1]}` : null;
  };
  const title = () => document.title.replace(/\s*[-|]\s*ChatGPT.*$/i, '').trim() || 'ChatGPT conversation';
  const hash = text => {
    let value = 0;
    for (let i = 0; i < text.length; i++) value = ((value << 5) - value + text.charCodeAt(i)) | 0;
    return (value >>> 0).toString(36);
  };

  let path = location.pathname;
  let routeVersion = 0;
  let routeReadyAt = 0;
  let saveQueue = Promise.resolve();
  let jumpVersion = 0;
  let pendingCheck = null;
  const owners = new WeakMap();

  const syncRoute = () => {
    if (path !== location.pathname) {
      path = location.pathname;
      routeVersion++;
      jumpVersion++;
      routeReadyAt = Date.now() + 700;
      window.setTimeout(() => {
        void refresh().then(handlePendingJump).catch(console.error);
      }, 750);
      return true;
    }
    return false;
  };

  const bubbles = () => {
    const primary = [...document.querySelectorAll('[data-user-message-bubble="true"]')];
    return primary.length ? primary : [...document.querySelectorAll('[data-message-author-role="user"]')];
  };
  const positionOf = bubble => {
    const elements = [bubble, bubble.closest('[data-content-search-turn-key]'),
      bubble.closest('[data-chatgpt-search-unit-key]'), bubble.closest('[data-turn-key]'),
      bubble.closest('[data-testid^="conversation-turn-"]')].filter(Boolean);
    for (const el of elements) {
      for (const name of ['data-content-search-turn-key', 'data-chatgpt-search-unit-key', 'data-turn-key', 'data-testid']) {
        const match = el.getAttribute(name)?.match(/(?:fallback-turn-|conversation-turn-)(\d+)/);
        if (match) return Number(match[1]); // Zero is a valid first turn.
      }
    }
    return null; // A visible DOM index is not a position in a virtualized conversation.
  };
  const collect = () => {
    syncRoute();
    const id = conversationId();
    if (!id || Date.now() < routeReadyAt) return [];
    const occurrences = new Map();
    const entries = [];
    for (const bubble of bubbles()) {
      const text = normalizeText(bubble.innerText || bubble.textContent);
      if (!text) continue;
      const owner = owners.get(bubble);
      // A SPA URL can change while the old conversation DOM is still mounted.
      if (owner && owner.id !== id && owner.text === text) continue;
      owners.set(bubble, { id, text });
      const turn = bubble.closest('[data-turn-key]') || bubble.closest('[data-content-search-turn-key]') ||
        bubble.closest('[data-chatgpt-search-unit-key]') || bubble.closest('[data-testid^="conversation-turn-"]') || bubble;
      const position = positionOf(bubble);
      const nativeId = bubble.closest('[data-message-id]')?.getAttribute('data-message-id');
      const turnId = turn.getAttribute('data-turn-key');
      const searchId = bubble.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids');
      const occurrence = occurrences.get(text) || 0;
      occurrences.set(text, occurrence + 1);
      const messageId = turnId || nativeId || searchId || `fallback-${position ?? 'text'}-${hash(text)}-${occurrence}`;
      const item = { id: messageId, position, title: text.length > 70 ? `${text.slice(0, 70)}...` : text, text };
      entries.push({ item, element: bubble });
    }
    return entries;
  };

  const merge = (saved, current) => {
    const map = new Map();
    for (const item of saved) {
      if (item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim()) {
        map.set(item.id, { ...item, position: Number.isFinite(item.position) ? item.position : null });
      }
    }
    for (const item of current) {
      // Migrate old fallback IDs when a stable DOM ID becomes available.
      const aliases = [...map.values()].filter(old => old.id !== item.id && old.id.startsWith('fallback-') &&
        normalizeText(old.text) === item.text && old.position === item.position);
      if (aliases.length === 1) map.delete(aliases[0].id);
      map.set(item.id, item);
    }
    return [...map.values()].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
      .map((item, index) => ({ ...item, index: index + 1 }));
  };

  const saveCurrentItems = () => {
    const task = async () => {
      const entries = collect();
      const id = conversationId();
      const version = routeVersion;
      if (!id || Date.now() < routeReadyAt || !entries.length) return null;
      // Capture all metadata before async reads; never combine two routes.
      const snapshot = { id, title: title(), url: `${location.origin}${location.pathname}`, items: entries.map(e => e.item) };
      const key = `${STORAGE_PREFIX}${id}`;
      const legacyKey = `${STORAGE_PREFIX}${location.pathname}`;
      const data = await chrome.storage.local.get([...new Set([key, legacyKey])]);
      syncRoute();
      if (version !== routeVersion || conversationId() !== id) return null;
      const previous = data[key] ?? data[legacyKey];
      const saved = Array.isArray(previous) ? previous : Array.isArray(previous?.items) ? previous.items : [];
      const items = merge(saved, snapshot.items);
      const conversation = { ...snapshot, items, updatedAt: previous?.updatedAt ?? Date.now() };
      if (previous?.id !== id || previous?.title !== snapshot.title || previous?.url !== snapshot.url ||
          JSON.stringify(previous?.items) !== JSON.stringify(items)) {
        conversation.updatedAt = Date.now();
        await chrome.storage.local.set({ [key]: conversation });
      }
      return conversation;
    };
    const next = saveQueue.then(task, task);
    saveQueue = next.catch(() => {});
    return next;
  };

  const findTarget = (entries, target) => {
    const exact = entries.find(e => e.item.id === target.id && (!target.text || e.item.text === normalizeText(target.text)));
    if (exact) return exact.element;
    // Stable IDs can change across ChatGPT DOM versions. Only use unambiguous text fallback.
    if (!target.text) return null;
    const matches = entries.filter(e => e.item.text === normalizeText(target.text));
    if (matches.length === 1) return matches[0].element;
    const samePosition = matches.filter(e => e.item.position !== null && e.item.position === target.position);
    return samePosition.length === 1 ? samePosition[0].element : null;
  };
  const scrollContainer = () => {
    const known = document.querySelector('[data-app-action="timeline-scroll"]') || document.querySelector('.thread-scroll-container');
    if (known) return known;
    let el = bubbles()[0]?.parentElement;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
      el = el.parentElement;
    }
    return document.scrollingElement;
  };
  const reveal = element => {
    element.scrollIntoView({ behavior: 'auto', block: 'center' });
    const old = element.style.outline;
    element.style.outline = '2px solid rgba(80, 80, 80, 0.55)';
    window.setTimeout(() => { element.style.outline = old; }, 1400);
  };

  const findAndScroll = async (requested, expectedId = conversationId()) => {
    syncRoute();
    const version = routeVersion;
    const token = ++jumpVersion;
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const onKey = event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', 'Escape', ' '].includes(event.key)) cancel();
    };
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('touchstart', cancel, { passive: true });
    window.addEventListener('keydown', onKey);
    const active = () => {
      syncRoute();
      return !cancelled && token === jumpVersion && version === routeVersion && conversationId() === expectedId;
    };
    try {
      let target = typeof requested === 'string' ? { id: requested } : requested;
      if (!expectedId || !target || typeof target.id !== 'string') return false;
      const conversation = await saveCurrentItems();
      if (!target.text) target = conversation?.items.find(item => item.id === target.id) || target;
      const deadline = Date.now() + 15000;
      let entries = collect();
      // Wait for the destination conversation to render before attempting a jump.
      while (active() && !entries.length && Date.now() < deadline) {
        await sleep(150);
        entries = collect();
      }
      if (!active()) return false;
      let found = findTarget(entries, target);
      if (found) { reveal(found); return true; }
      const container = scrollContainer();
      if (!container) return false;
      const positions = entries.map(e => e.item.position).filter(p => p !== null);
      // One direction per click avoids the previous back-and-forth scrolling loop.
      const direction = Number.isFinite(target.position) && positions.length && target.position > Math.max(...positions) ? 1 : -1;
      let unchanged = 0;
      let signature = '';
      const scrollBehavior = container.style.scrollBehavior;
      container.style.scrollBehavior = 'auto';
      try {
        for (let step = 0; step < 70 && active() && Date.now() < deadline; step++) {
          const before = container.scrollTop;
          if (step === 0 && target.position === 0) {
            container.scrollTo({ top: 0, behavior: 'instant' });
          } else {
            container.scrollBy({ top: direction * Math.max(200, container.clientHeight * 0.7), behavior: 'instant' });
          }
          await sleep(180);
          if (!active()) return false;
          entries = collect();
          found = findTarget(entries, target);
          if (found) { reveal(found); void saveCurrentItems().catch(console.error); return true; }
          const nextSignature = entries.map(e => e.item.id).join('|');
          unchanged = Math.abs(container.scrollTop - before) < 1 && signature === nextSignature ? unchanged + 1 : 0;
          signature = nextSignature;
          if (unchanged >= 8) break; // Allow lazy rendering at the boundary, then stop.
        }
      } finally {
        container.style.scrollBehavior = scrollBehavior;
      }
      return false;
    } finally {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.removeEventListener('keydown', onKey);
    }
  };

  const handlePendingJump = () => {
    if (pendingCheck) return pendingCheck;
    pendingCheck = (async () => {
      const id = conversationId();
      if (!id) return;
      const response = await chrome.runtime.sendMessage({ type: 'rewind:take-pending-jump', conversationId: id });
      if (!response?.pending) return;
      const success = await findAndScroll(response.pending.item, id);
      await chrome.runtime.sendMessage({ type: 'rewind:jump-result', success }).catch(() => {});
    })().catch(console.error).finally(() => { pendingCheck = null; });
    return pendingCheck;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'rewind:get-outline') {
      saveCurrentItems().then(conversation => sendResponse({ conversation, items: conversation?.items ?? [] }))
        .catch(error => sendResponse({ conversation: null, error: String(error) }));
      return true;
    }
    if (message.type === 'rewind:scroll-to') {
      findAndScroll(message.item ?? message.id, message.conversationId ?? conversationId())
        .then(success => sendResponse({ success })).catch(error => sendResponse({ success: false, error: String(error) }));
      return true;
    }
  });

  const refresh = async () => {
    await saveCurrentItems();
    await chrome.runtime.sendMessage({ type: 'rewind:outline-updated' }).catch(() => {});
  };
  let updateTimer;
  const observer = new MutationObserver(mutations => {
    if (!mutations.some(m => m.type === 'characterData' || m.addedNodes.length || m.removedNodes.length)) return;
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(() => { void refresh().catch(console.error); }, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.setInterval(syncRoute, 300);
  // Exactly one initialization; no duplicate index writes or pending-jump consumers.
  void refresh().then(handlePendingJump).catch(console.error);
})();

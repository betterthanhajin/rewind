export type OutlineItem = {
  id: string;
  index: number;
  position: number | null;
  title: string;
  text: string;
};

export type Conversation = {
  id: string;
  title: string;
  url: string;
  updatedAt: number;
  items: OutlineItem[];
};

export type SearchResult = {
  conversation: Conversation;
  item: OutlineItem | null;
};

export const STORAGE_PREFIX = 'rewind:conversation:';

export function conversationPath(value: string): string | null {
  try {
    const url = new URL(value, 'https://chatgpt.com');
    if (!['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/(?:g\/[^/]+\/)?c\/([^/]+)\/?$/);
    return match ? `/c/${match[1]}` : null;
  } catch {
    return null;
  }
}

export function readConversations(data: Record<string, unknown>): Conversation[] {
  const byConversation = new Map<string, Conversation>();
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith(STORAGE_PREFIX) || !value || typeof value !== 'object') continue;
    const record = value as Partial<Conversation>;
    const id = conversationPath(key.slice(STORAGE_PREFIX.length));
    if (!id || !Array.isArray(record.items) || conversationPath(record.id ?? '') !== id) continue;
    const items = new Map<string, OutlineItem>();
    for (const raw of record.items) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.text !== 'string' || !raw.text.trim()) continue;
      const text = raw.text.replace(/\s+/g, ' ').trim();
      const position = typeof raw.position === 'number' && Number.isFinite(raw.position) ? raw.position : null;
      items.set(raw.id, { id: raw.id, text, title: text.length > 70 ? `${text.slice(0, 70)}...` : text,
        position, index: 0 });
    }
    if (!items.size) continue;
    const previous = byConversation.get(id);
    const merged = new Map(previous?.items.map(item => [item.id, item]));
    for (const item of items.values()) merged.set(item.id, item);
    const ordered = [...merged.values()].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
      .map((item, index) => ({ ...item, index: index + 1 }));
    const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0;
    const latest = previous && previous.updatedAt > updatedAt ? previous : record;
    byConversation.set(id, { id, title: latest.title || 'ChatGPT conversation',
      url: conversationPath(latest.url ?? '') === id ? latest.url! : `https://chatgpt.com${id}`,
      updatedAt: Math.max(updatedAt, previous?.updatedAt ?? 0), items: ordered });
  }
  return [...byConversation.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function searchConversations(conversations: Conversation[], query: string): SearchResult[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return [];
  return conversations.flatMap<SearchResult>(conversation => {
    const matches = conversation.items.filter(item => item.text.toLocaleLowerCase().includes(keyword));
    if (matches.length) return matches.map(item => ({ conversation, item }));
    // A title match is a single conversation result, not every unrelated question.
    return conversation.title.toLocaleLowerCase().includes(keyword) ? [{ conversation, item: null }] : [];
  });
}

// Calendar days in the user's local timezone: today plus the preceding six days.
export function recentVisits<T extends { lastVisitTime: number }>(items: T[], now = Date.now()): T[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return items.filter(item => Number.isFinite(item.lastVisitTime) && item.lastVisitTime >= start.getTime() && item.lastVisitTime <= now)
    .sort((a, b) => b.lastVisitTime - a.lastVisitTime);
}

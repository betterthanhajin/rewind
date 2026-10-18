import { conversationPath } from './conversations';

export type HistoryConversation = {
  id: string;
  title: string;
  url: string;
  lastVisitTime: number;
};

export async function getChatGPTHistory(): Promise<HistoryConversation[]> {
  // Older titles stay searchable; only Recently Visited uses the seven-day filter.
  const groups = await Promise.all(['chatgpt.com', 'chat.openai.com'].map(text =>
    chrome.history.search({ text, startTime: 0, maxResults: 5000 })));
  const map = new Map<string, HistoryConversation>();
  for (const item of groups.flat()) {
    if (!item.url) continue;
    const id = conversationPath(item.url);
    if (!id) continue;
    const lastVisitTime = item.lastVisitTime ?? 0;
    if ((map.get(id)?.lastVisitTime ?? -1) > lastVisitTime) continue;
    map.set(id, {
      id, url: item.url, lastVisitTime,
      title: item.title?.replace(/\s*[-|]\s*ChatGPT.*$/i, '').trim() || 'ChatGPT conversation',
    });
  }
  return [...map.values()].sort((a, b) => b.lastVisitTime - a.lastVisitTime);
}

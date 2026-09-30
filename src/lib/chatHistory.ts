export type HistoryConversation = {
  id: string;
  title: string;
  url: string;
  lastVisitTime: number;
};

const searchHistory = (
  text: string
): Promise<chrome.history.HistoryItem[]> => {
  return new Promise((resolve) => {
    chrome.history.search(
      {
        text,
        startTime: 0,
        maxResults: 5000,
      },
      (results) => {
        resolve(results);
      }
    );
  });
};

const getConversationPath = (
  urlString: string
): string | null => {
  try {
    const url = new URL(urlString);

    if (
      url.hostname !== "chatgpt.com" &&
      url.hostname !== "chat.openai.com"
    ) {
      return null;
    }

    if (!url.pathname.startsWith("/c/")) {
      return null;
    }

    return url.pathname;
  } catch {
    return null;
  }
};

export const getChatGPTHistory =
  async (): Promise<HistoryConversation[]> => {
    const [chatgpt, legacy] =
      await Promise.all([
        searchHistory("chatgpt.com/c/"),
        searchHistory("chat.openai.com/c/"),
      ]);

    const map =
      new Map<string, HistoryConversation>();

    [...chatgpt, ...legacy].forEach(
      (item) => {
        if (!item.url) {
          return;
        }

        const id =
          getConversationPath(item.url);

        if (!id) {
          return;
        }

        const existing =
          map.get(id);

        const lastVisitTime =
          item.lastVisitTime ?? 0;

        if (
          existing &&
          existing.lastVisitTime >
            lastVisitTime
        ) {
          return;
        }

        map.set(id, {
          id,

          url:
            item.url,

          title:
            item.title
              ?.replace(
                /\s*[-|]\s*ChatGPT.*$/i,
                ""
              )
              .trim() ||
            "ChatGPT conversation",

          lastVisitTime,
        });
      }
    );

    return Array.from(
      map.values()
    ).sort(
      (a, b) =>
        b.lastVisitTime -
        a.lastVisitTime
    );
  };
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import "./App.css";

type OutlineItem = {
  id: string;
  index: number;
  position: number;
  title: string;
  text: string;
};

type Conversation = {
  id: string;
  title: string;
  url: string;
  updatedAt: number;
  items: OutlineItem[];
};

type SearchResult = {
  conversation: Conversation;
  item: OutlineItem;
};

const STORAGE_PREFIX =
  "rewind:conversation:";

const PENDING_JUMP_KEY =
  "rewind:pending-jump";

function App() {
  const [
    currentConversation,
    setCurrentConversation,
  ] =
    useState<Conversation | null>(
      null
    );

  const [
    conversations,
    setConversations,
  ] = useState<Conversation[]>([]);

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const loadStoredConversations =
    () => {
      chrome.storage.local.get(
        null,
        (data) => {
          const result =
            Object.entries(data)
              .filter(([key]) =>
                key.startsWith(
                  STORAGE_PREFIX
                )
              )
              .map(
                ([, value]) =>
                  value as Conversation
              )
              .filter(
                (conversation) =>
                  conversation &&
                  Array.isArray(
                    conversation.items
                  )
              )
              .sort(
                (a, b) =>
                  b.updatedAt -
                  a.updatedAt
              );

          setConversations(
            result
          );
        }
      );
    };

  const loadCurrentConversation =
    () => {
      chrome.tabs.query(
        {
          active: true,
          currentWindow: true,
        },

        ([tab]) => {
          if (!tab?.id) {
            setLoading(false);
            return;
          }

          chrome.tabs.sendMessage(
            tab.id,

            {
              type:
                "rewind:get-outline",
            },

            (response) => {
              if (
                chrome.runtime
                  .lastError
              ) {
                setLoading(false);
                return;
              }

              setCurrentConversation(
                response?.conversation ??
                  null
              );

              setLoading(false);

              loadStoredConversations();
            }
          );
        }
      );
    };

  useEffect(() => {
    const timer =
      window.setTimeout(() => {
        loadCurrentConversation();
        loadStoredConversations();
      }, 0);

    const messageListener = (
      message: {
        type?: string;
      }
    ) => {
      if (
        message.type ===
        "rewind:outline-updated"
      ) {
        loadCurrentConversation();
        loadStoredConversations();
      }
    };

    const storageListener = (
      changes: {
        [key: string]:
          chrome.storage.StorageChange;
      }
    ) => {
      const changed =
        Object.keys(
          changes
        ).some((key) =>
          key.startsWith(
            STORAGE_PREFIX
          )
        );

      if (changed) {
        loadStoredConversations();
      }
    };

    chrome.runtime.onMessage.addListener(
      messageListener
    );

    chrome.storage.onChanged.addListener(
      storageListener
    );

    return () => {
      window.clearTimeout(
        timer
      );

      chrome.runtime.onMessage.removeListener(
        messageListener
      );

      chrome.storage.onChanged.removeListener(
        storageListener
      );
    };
  }, []);

  const jumpCurrent = (
    id: string
  ) => {
    chrome.tabs.query(
      {
        active: true,
        currentWindow: true,
      },

      ([tab]) => {
        if (!tab?.id) {
          return;
        }

        chrome.tabs.sendMessage(
          tab.id,
          {
            type:
              "rewind:scroll-to",
            id,
          }
        );
      }
    );
  };

  const openSearchResult =
    async (
      result: SearchResult
    ) => {
      /**
       * 현재 대화라면 바로 이동
       */
      if (
        result.conversation.id ===
        currentConversation?.id
      ) {
        jumpCurrent(
          result.item.id
        );

        return;
      }

      const [tab] =
        await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

      if (!tab?.id) {
        return;
      }

      /**
       * 이동 후 어떤 메시지를
       * 찾아갈지 저장
       */
      await chrome.storage.local.set({
        [PENDING_JUMP_KEY]: {
          conversationId:
            result.conversation.id,

          messageId:
            result.item.id,

          createdAt:
            Date.now(),
        },
      });

      await chrome.tabs.update(
        tab.id,
        {
          url:
            result.conversation.url,
        }
      );
    };

  const searchResults =
    useMemo(() => {
      const keyword =
        search
          .trim()
          .toLowerCase();

      if (!keyword) {
        return [];
      }

      const results:
        SearchResult[] = [];

      conversations.forEach(
        (conversation) => {
          conversation.items.forEach(
            (item) => {
              if (
                item.text
                  .toLowerCase()
                  .includes(
                    keyword
                  )
              ) {
                results.push({
                  conversation,
                  item,
                });
              }
            }
          );
        }
      );

      return results;
    }, [
      conversations,
      search,
    ]);

  if (loading) {
    return (
      <main className="rewind">
        <div className="status">
          Loading Rewind...
        </div>
      </main>
    );
  }

  return (
    <main className="rewind">
      <header>
        <div className="logo">
          <span className="logo-icon">
            ↩
          </span>

          <div>
            <h1>Rewind</h1>

            <p>
              Find what you already
              discussed.
            </p>
          </div>
        </div>
      </header>

      <input
        className="search"
        placeholder="Search all conversations..."
        value={search}
        onChange={(event) =>
          setSearch(
            event.target.value
          )
        }
      />

      {!search && (
        <>
          <div className="section-title">
            THIS CONVERSATION
          </div>

          <div className="meta">
            {currentConversation
              ?.items.length ?? 0}{" "}
            questions
          </div>

          <section className="outline">
            {currentConversation
              ?.items.map(
                (item) => (
                  <button
                    key={
                      item.id
                    }
                    className="message"
                    onClick={() =>
                      jumpCurrent(
                        item.id
                      )
                    }
                  >
                    <span className="number">
                      {
                        item.index
                      }
                    </span>

                    <span className="title">
                      {
                        item.title
                      }
                    </span>
                  </button>
                )
              )}
          </section>
        </>
      )}

      {search && (
        <>
          <div className="section-title">
            SEARCH RESULTS
          </div>

          <div className="meta">
            {
              searchResults.length
            }{" "}
            results
          </div>

          <section className="results">
            {searchResults.map(
              (
                result,
                index
              ) => (
                <button
                  key={`${result.conversation.id}-${result.item.id}-${index}`}
                  className="search-result"
                  onClick={() =>
                    openSearchResult(
                      result
                    )
                  }
                >
                  <span className="result-chat">
                    {
                      result
                        .conversation
                        .title
                    }
                  </span>

                  <span className="result-text">
                    {
                      result
                        .item
                        .title
                    }
                  </span>
                </button>
              )
            )}

            {searchResults.length ===
              0 && (
              <div className="empty">
                No conversations found.
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default App;
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import "./App.css";

import {
  getChatGPTHistory,
  type HistoryConversation,
} from "./lib/chatHistory";

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

const getCurrentTab =
  async () => {
    const [tab] =
      await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

    return tab;
  };

const getStoredConversations =
  async (): Promise<Conversation[]> => {
    const data =
      await chrome.storage.local.get(
        null
      );

    return Object.entries(data)
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
        (
          conversation
        ): conversation is Conversation =>
          Boolean(
            conversation &&
              Array.isArray(
                conversation.items
              )
          )
      )
      .sort(
        (a, b) =>
          b.updatedAt -
          a.updatedAt
      );
  };

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

  const [
    historyConversations,
    setHistoryConversations,
  ] = useState<
    HistoryConversation[]
  >([]);

  const [search, setSearch] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const refreshConversations =
    useCallback(async () => {
      const stored =
        await getStoredConversations();

      setConversations(stored);
    }, []);

  const refreshHistory =
    useCallback(async () => {
      try {
        const history =
          await getChatGPTHistory();

        setHistoryConversations(
          history
        );
      } catch (error) {
        console.error(
          "[Rewind] history error:",
          error
        );
      }
    }, []);

  const refreshCurrentConversation =
    useCallback(async () => {
      const tab =
        await getCurrentTab();

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
        async (response) => {
          if (
            chrome.runtime.lastError
          ) {
            setCurrentConversation(
              null
            );

            setLoading(false);

            return;
          }

          setCurrentConversation(
            response?.conversation ??
              null
          );

          await refreshConversations();

          setLoading(false);
        }
      );
    }, [
      refreshConversations,
    ]);

  useEffect(() => {
    const timer =
      window.setTimeout(() => {
        void refreshCurrentConversation();
        void refreshConversations();
        void refreshHistory();
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
        void refreshCurrentConversation();
        void refreshHistory();
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
        void refreshConversations();
      }
    };

    chrome.runtime.onMessage.addListener(
      messageListener
    );

    chrome.storage.onChanged.addListener(
      storageListener
    );

    return () => {
      window.clearTimeout(timer);

      chrome.runtime.onMessage.removeListener(
        messageListener
      );

      chrome.storage.onChanged.removeListener(
        storageListener
      );
    };
  }, [
    refreshCurrentConversation,
    refreshConversations,
    refreshHistory,
  ]);

  const jumpCurrent =
    async (
      id: string
    ) => {
      const tab =
        await getCurrentTab();

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
    };

  const openUrl =
    async (
      url: string
    ) => {
      const tab =
        await getCurrentTab();

      if (!tab?.id) {
        return;
      }

      await chrome.tabs.update(
        tab.id,
        {
          url,
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

  /**
   * 브라우저 기록에는 있지만
   * Rewind에는 아직 저장되지 않은 대화
   */
  const unindexedConversations =
    useMemo(() => {
      const indexedIds =
        new Set(
          conversations.map(
            (conversation) =>
              conversation.id
          )
        );

      return historyConversations.filter(
        (conversation) =>
          !indexedIds.has(
            conversation.id
          )
      );
    }, [
      conversations,
      historyConversations,
    ]);

  const totalQuestions =
    useMemo(
      () =>
        conversations.reduce(
          (
            total,
            conversation
          ) =>
            total +
            conversation.items
              .length,
          0
        ),
      [conversations]
    );

  const otherConversations =
    useMemo(
      () =>
        conversations.filter(
          (conversation) =>
            conversation.id !==
            currentConversation?.id
        ),
      [
        conversations,
        currentConversation,
      ]
    );

  const formatDate = (
    timestamp: number
  ) => {
    if (!timestamp) {
      return "";
    }

    return new Intl.DateTimeFormat(
      "ko-KR",
      {
        month: "short",
        day: "numeric",
      }
    ).format(
      new Date(timestamp)
    );
  };

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
        type="search"
        placeholder="Search your memory..."
        value={search}
        onChange={(event) =>
          setSearch(
            event.target.value
          )
        }
      />

      <div className="stats">
        <div className="stat">
          <strong>
            {
              conversations.length
            }
          </strong>

          <span>
            conversations
          </span>
        </div>

        <div className="stat">
          <strong>
            {totalQuestions}
          </strong>

          <span>
            questions
          </span>
        </div>
      </div>

      {search ? (
        <>
          <div className="section-heading">
            <span>
              SEARCH RESULTS
            </span>

            <span>
              {
                searchResults.length
              }
            </span>
          </div>

          <section className="results">
            {searchResults.map(
              (result) => (
                <button
                  key={`${result.conversation.id}-${result.item.id}`}
                  type="button"
                  className="search-result"
                  onClick={() => {
                    if (
                      result
                        .conversation
                        .id ===
                      currentConversation
                        ?.id
                    ) {
                      void jumpCurrent(
                        result.item
                          .id
                      );

                      return;
                    }

                    void openUrl(
                      result
                        .conversation
                        .url
                    );
                  }}
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
                      result.item
                        .title
                    }
                  </span>
                </button>
              )
            )}

            {searchResults.length ===
              0 && (
              <div className="empty">
                저장된 대화에서는
                검색 결과가 없습니다.
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="section-heading">
            <span>
              THIS CONVERSATION
            </span>

            <span>
              {currentConversation
                ?.items.length ?? 0}
            </span>
          </div>

          <section className="outline">
            {currentConversation
              ?.items.map(
                (item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="message"
                    onClick={() =>
                      void jumpCurrent(
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

          <div className="section-heading indexed-heading">
            <span>
              INDEXED
            </span>

            <span>
              {
                otherConversations.length
              }
            </span>
          </div>

          <section className="conversation-list">
            {otherConversations.map(
              (
                conversation
              ) => (
                <button
                  key={
                    conversation.id
                  }
                  type="button"
                  className="conversation-card"
                  onClick={() =>
                    void openUrl(
                      conversation.url
                    )
                  }
                >
                  <span className="memory-state">
                    ✓
                  </span>

                  <div className="conversation-main">
                    <span className="conversation-title">
                      {
                        conversation.title
                      }
                    </span>

                    <span className="conversation-meta">
                      {
                        conversation
                          .items
                          .length
                      }{" "}
                      questions
                    </span>
                  </div>

                  <span className="conversation-date">
                    {formatDate(
                      conversation.updatedAt
                    )}
                  </span>
                </button>
              )
            )}
          </section>

          <div className="section-heading indexed-heading">
            <span>
              RECENTLY VISITED
            </span>

            <span>
              {
                unindexedConversations.length
              }
            </span>
          </div>

          <section className="conversation-list">
            {unindexedConversations
              .slice(0, 50)
              .map(
                (
                  conversation
                ) => (
                  <button
                    key={
                      conversation.id
                    }
                    type="button"
                    className="conversation-card unindexed"
                    onClick={() =>
                      void openUrl(
                        conversation.url
                      )
                    }
                  >
                    <span className="memory-state">
                      ○
                    </span>

                    <div className="conversation-main">
                      <span className="conversation-title">
                        {
                          conversation.title
                        }
                      </span>

                      <span className="conversation-meta">
                        Open to index
                      </span>
                    </div>

                    <span className="conversation-date">
                      {formatDate(
                        conversation.lastVisitTime
                      )}
                    </span>
                  </button>
                )
              )}

            {unindexedConversations.length ===
              0 && (
              <div className="empty">
                최근 방문 기록에서
                추가할 ChatGPT 대화가
                없습니다.
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default App;
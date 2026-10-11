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

/**
 * 현재 활성화된 Chrome 탭
 */
const getCurrentTab = async () => {
  const [tab] =
    await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

  return tab;
};

/**
 * Rewind가 기억한 대화 전체
 */
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
              typeof conversation ===
                "object" &&
              Array.isArray(
                conversation.items
              )
          )
      )
      .sort(
        (a, b) =>
          (b.updatedAt ?? 0) -
          (a.updatedAt ?? 0)
      );
  };

function App() {
  /**
   * 현재 ChatGPT 대화
   */
  const [
    currentConversation,
    setCurrentConversation,
  ] =
    useState<Conversation | null>(
      null
    );

  /**
   * Rewind가 이미 기억한 대화
   */
  const [
    conversations,
    setConversations,
  ] = useState<Conversation[]>([]);

  /**
   * Chrome 방문 기록에 있는
   * ChatGPT 대화
   */
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

  /**
   * =========================
   * 저장된 대화 새로 읽기
   * =========================
   */
  const refreshConversations =
    useCallback(async () => {
      try {
        const stored =
          await getStoredConversations();

        setConversations(stored);
      } catch (error) {
        console.error(
          "[Rewind] storage error:",
          error
        );
      }
    }, []);

  /**
   * =========================
   * Chrome History 읽기
   * =========================
   */
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

  /**
   * =========================
   * 현재 ChatGPT 대화 읽기
   * =========================
   */
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
          /**
           * ChatGPT가 아닌 페이지거나
           * content.js가 없는 경우
           */
          if (
            chrome.runtime
              .lastError
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

  /**
   * =========================
   * 최초 초기화 / 이벤트 등록
   * =========================
   */
  useEffect(() => {
    /**
     * Effect 내부 즉시 state update
     * eslint 경고 방지
     */
    const timer =
      window.setTimeout(() => {
        void refreshCurrentConversation();
        void refreshConversations();
        void refreshHistory();
      }, 0);

    /**
     * content.js에서
     * 대화 내용이 변경됨
     */
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

    /**
     * chrome.storage.local 변경
     */
    const storageListener = (
      changes: {
        [key: string]:
          chrome.storage.StorageChange;
      }
    ) => {
      const rewindChanged =
        Object.keys(
          changes
        ).some((key) =>
          key.startsWith(
            STORAGE_PREFIX
          )
        );

      if (rewindChanged) {
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

  /**
   * =========================
   * 현재 대화 질문으로 이동
   * =========================
   */
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

  /**
   * =========================
   * 특정 ChatGPT 대화 열기
   * =========================
   */
  const openUrl =
    async (
      url: string
    ) => {
      if (!url) {
        return;
      }

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

  /**
   * =========================
   * 이미 인덱싱된 질문 검색
   * =========================
   */
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
              const questionMatch =
                item.text
                  .toLowerCase()
                  .includes(
                    keyword
                  );

              /**
               * 대화 제목도 검색
               */
              const conversationMatch =
                conversation.title
                  .toLowerCase()
                  .includes(
                    keyword
                  );

              if (
                questionMatch ||
                conversationMatch
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
   * =========================
   * 아직 인덱싱되지 않은
   * 과거 ChatGPT 대화 제목 검색
   * =========================
   */
  const unindexedSearchResults =
    useMemo(() => {
      const keyword =
        search
          .trim()
          .toLowerCase();

      if (!keyword) {
        return [];
      }

      const indexedIds =
        new Set(
          conversations.map(
            (conversation) =>
              conversation.id
          )
        );

      return historyConversations.filter(
        (conversation) => {
          /**
           * 이미 Rewind가 기억함
           */
          if (
            indexedIds.has(
              conversation.id
            )
          ) {
            return false;
          }

          /**
           * Chrome 방문기록의
           * ChatGPT 대화 제목 검색
           */
          return conversation.title
            .toLowerCase()
            .includes(keyword);
        }
      );
    }, [
      conversations,
      historyConversations,
      search,
    ]);

  /**
   * =========================
   * 아직 인덱싱되지 않은
   * 방문 기록 전체
   * =========================
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

  /**
   * 현재 대화 제외
   */
  const otherConversations =
    useMemo(() => {
      return conversations.filter(
        (conversation) =>
          conversation.id !==
          currentConversation?.id
      );
    }, [
      conversations,
      currentConversation,
    ]);

  /**
   * 전체 질문 수
   */
  const totalQuestions =
    useMemo(() => {
      return conversations.reduce(
        (
          total,
          conversation
        ) =>
          total +
          conversation.items.length,
        0
      );
    }, [conversations]);

  /**
   * 전체 검색 결과 수
   */
  const totalSearchResults =
    searchResults.length +
    unindexedSearchResults.length;

  /**
   * 날짜
   */
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

  /**
   * =========================
   * Loading
   * =========================
   */
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
      {/* =====================
          HEADER
         ===================== */}

      <header>
        <div className="logo">
          <span className="logo-icon">
            ↩
          </span>

          <div>
            <h1>
              Rewind
            </h1>

            <p>
              Find what you already
              discussed.
            </p>
          </div>
        </div>
      </header>

      {/* =====================
          SEARCH
         ===================== */}

      <input
        className="search"
        type="search"
        placeholder="Search your memory..."
        value={search}
        onChange={(event) => {
          setSearch(
            event.target.value
          );
        }}
      />

      {/* =====================
          STATS
         ===================== */}

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

      {/* =====================
          검색 중
         ===================== */}

      {search ? (
        <>
          <div className="section-heading">
            <span>
              SEARCH RESULTS
            </span>

            <span>
              {
                totalSearchResults
              }
            </span>
          </div>

          {/* =====================
              INDEXED 검색 결과
             ===================== */}

          {searchResults.length >
            0 && (
            <>
              <div className="search-group-title">
                ✓ INDEXED
              </div>

              <section className="results">
                {searchResults.map(
                  (
                    result,
                    index
                  ) => (
                    <button
                      key={`${result.conversation.id}-${result.item.id}-${index}`}
                      type="button"
                      className="search-result"
                      onClick={() => {
                        /**
                         * 현재 대화
                         */
                        if (
                          result
                            .conversation
                            .id ===
                          currentConversation
                            ?.id
                        ) {
                          void jumpCurrent(
                            result
                              .item
                              .id
                          );

                          return;
                        }

                        /**
                         * 다른 대화
                         */
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
                          result
                            .item
                            .title
                        }
                      </span>

                      <span className="result-date">
                        {formatDate(
                          result
                            .conversation
                            .updatedAt
                        )}
                      </span>
                    </button>
                  )
                )}
              </section>
            </>
          )}

          {/* =====================
              NOT INDEXED 검색 결과
             ===================== */}

          {unindexedSearchResults.length >
            0 && (
            <>
              <div className="search-group-title unindexed-title">
                ○ NOT INDEXED YET
              </div>

              <section className="results">
                {unindexedSearchResults.map(
                  (
                    conversation
                  ) => (
                    <button
                      key={
                        conversation.id
                      }
                      type="button"
                      className="search-result unindexed-result"
                      onClick={() => {
                        void openUrl(
                          conversation.url
                        );
                      }}
                    >
                      <span className="result-chat">
                        과거 ChatGPT 대화
                      </span>

                      <span className="result-text">
                        {
                          conversation.title
                        }
                      </span>

                      <span className="open-to-index">
                        열어서 Rewind에
                        기억시키기 →
                      </span>

                      <span className="result-date">
                        {formatDate(
                          conversation.lastVisitTime
                        )}
                      </span>
                    </button>
                  )
                )}
              </section>
            </>
          )}

          {/* 검색 결과 없음 */}

          {totalSearchResults ===
            0 && (
            <div className="empty">
              검색 결과가
              없습니다.
            </div>
          )}
        </>
      ) : (
        <>
          {/* =====================
              현재 대화
             ===================== */}

          <div className="section-heading">
            <span>
              THIS CONVERSATION
            </span>

            <span>
              {currentConversation
                ?.items.length ??
                0}
            </span>
          </div>

          <section className="outline">
            {currentConversation
              ?.items.map(
                (item) => (
                  <button
                    key={
                      item.id
                    }
                    type="button"
                    className="message"
                    onClick={() => {
                      void jumpCurrent(
                        item.id
                      );
                    }}
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

            {!currentConversation
              ?.items.length && (
              <div className="empty">
                아직 저장된 질문이
                없습니다.
              </div>
            )}
          </section>

          {/* =====================
              INDEXED
             ===================== */}

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
                  onClick={() => {
                    void openUrl(
                      conversation.url
                    );
                  }}
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

            {otherConversations.length ===
              0 && (
              <div className="empty">
                아직 다른 대화를
                기억하지 않았습니다.
              </div>
            )}
          </section>

          {/* =====================
              방문했지만 아직
              인덱싱 안 된 대화
             ===================== */}

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
                    onClick={() => {
                      void openUrl(
                        conversation.url
                      );
                    }}
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
                추가로 인덱싱할
                최근 ChatGPT 대화가
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
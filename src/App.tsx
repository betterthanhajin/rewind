import { useEffect, useMemo, useState } from "react";
import "./App.css";

type OutlineItem = {
  id: string;
  index: number;
  title: string;
  text: string;
};

type OutlineResponse = {
  items?: OutlineItem[];
};

function App() {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    /**
     * 현재 ChatGPT 탭에서 질문 목록 가져오기
     */
    const loadOutline = () => {
      chrome.tabs.query(
        {
          active: true,
          currentWindow: true,
        },
        ([tab]) => {
          if (!tab?.id) {
            setLoading(false);
            setError("현재 탭을 찾을 수 없습니다.");
            return;
          }

          chrome.tabs.sendMessage(
            tab.id,
            {
              type: "rewind:get-outline",
            },
            (response: OutlineResponse | undefined) => {
              /**
               * content script가 없는 페이지에서
               * sendMessage를 호출하면 여기로 들어옴
               */
              if (chrome.runtime.lastError) {
                setItems([]);
                setLoading(false);

                setError(
                  "ChatGPT 페이지에서 Rewind를 사용할 수 있습니다."
                );

                return;
              }

              setItems(response?.items ?? []);
              setLoading(false);
              setError("");
            }
          );
        }
      );
    };

    /**
     * content.js에서
     *
     * rewind:outline-updated
     *
     * 이벤트가 오면 질문 목록 다시 읽기
     */
    const handleMessage = (message: { type?: string }) => {
      if (message.type === "rewind:outline-updated") {
        loadOutline();
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    /**
     * Effect 실행 중 바로 React state를
     * 변경하지 않도록 이벤트 큐 이후 최초 로드
     */
    const timer = window.setTimeout(() => {
      loadOutline();
    }, 0);

    return () => {
      window.clearTimeout(timer);

      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  /**
   * 선택한 질문 위치로 이동
   */
  const jumpToMessage = (id: string) => {
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
            type: "rewind:scroll-to",
            id,
          },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Rewind scroll error:",
                chrome.runtime.lastError.message
              );

              return;
            }

            if (!response?.success) {
              console.warn(
                "Rewind: 해당 메시지를 찾을 수 없습니다."
              );
            }
          }
        );
      }
    );
  };

  /**
   * 검색
   */
  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) {
      return items;
    }

    return items.filter((item) =>
      item.text.toLowerCase().includes(keyword)
    );
  }, [items, search]);

  return (
    <main className="rewind">
      <header>
        <div className="logo">
          <span className="logo-icon">↩</span>

          <div>
            <h1>Rewind</h1>

            <p>
              Never lose a conversation again.
            </p>
          </div>
        </div>
      </header>

      <div className="search-wrapper">
        <input
          className="search"
          type="text"
          placeholder="Search this conversation..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </div>

      {loading && (
        <div className="status">
          Loading conversation...
        </div>
      )}

      {!loading && error && (
        <div className="status error">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="meta">
            {search
              ? `${filteredItems.length} / ${items.length} questions`
              : `${items.length} questions`}
          </div>

          <section className="outline">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="message"
                onClick={() => {
                  jumpToMessage(item.id);
                }}
              >
                <span className="number">
                  {item.index}
                </span>

                <span className="title">
                  {item.title}
                </span>
              </button>
            ))}

            {items.length === 0 && (
              <div className="empty">
                아직 찾은 질문이 없습니다.
              </div>
            )}

            {items.length > 0 &&
              filteredItems.length === 0 && (
                <div className="empty">
                  검색 결과가 없습니다.
                </div>
              )}
          </section>
        </>
      )}
    </main>
  );
}

export default App;
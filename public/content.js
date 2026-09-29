(() => {
  console.log("[Rewind] v0.4 loaded");

  const STORAGE_PREFIX = "rewind:conversation:";
  const PENDING_JUMP_KEY = "rewind:pending-jump";

  const sleep = (ms) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

  const getConversationId = () => {
    return location.pathname;
  };

  const getConversationKey = () => {
    return `${STORAGE_PREFIX}${getConversationId()}`;
  };

  const getConversationTitle = () => {
    const title = document.title
      .replace(/\s*[-|]\s*ChatGPT.*$/i, "")
      .trim();

    return title || "Untitled conversation";
  };

  const getConversationUrl = () => {
    return `${location.origin}${location.pathname}`;
  };

  const hashString = (value) => {
    let hash = 0;

    for (let i = 0; i < value.length; i++) {
      hash =
        (hash << 5) -
        hash +
        value.charCodeAt(i);

      hash |= 0;
    }

    return Math.abs(hash).toString(36);
  };

  const getScrollContainer = () => {
    return (
      document.querySelector(
        '[data-app-action="timeline-scroll"]'
      ) ||
      document.querySelector(
        ".thread-scroll-container"
      )
    );
  };

  const findUserMessages = () => {
    return Array.from(
      document.querySelectorAll(
        '[data-user-message-bubble="true"]'
      )
    );
  };

  const getTurnElement = (bubble) => {
    return (
      bubble.closest("[data-turn-key]") ||
      bubble.closest(
        "[data-content-search-turn-key]"
      ) ||
      bubble.closest(
        "[data-chatgpt-search-unit-key]"
      ) ||
      bubble
    );
  };

  const getMessageText = (bubble) => {
    return (
      bubble.innerText
        ?.trim()
        .replace(/\s+/g, " ") || ""
    );
  };

  const parsePosition = (value) => {
    if (!value) {
      return null;
    }

    const match =
      value.match(/fallback-turn-(\d+)/);

    if (!match) {
      return null;
    }

    return Number(match[1]);
  };

  const getPosition = (
    bubble,
    fallbackIndex
  ) => {
    const elements = [
      bubble,
      bubble.closest(
        "[data-content-search-turn-key]"
      ),
      bubble.closest(
        "[data-chatgpt-search-unit-key]"
      ),
      bubble.closest("[data-turn-key]"),
    ].filter(Boolean);

    for (const element of elements) {
      const candidates = [
        element.getAttribute(
          "data-content-search-turn-key"
        ),
        element.getAttribute(
          "data-chatgpt-search-unit-key"
        ),
      ];

      for (const candidate of candidates) {
        const position =
          parsePosition(candidate);

        if (position !== null) {
          return position;
        }
      }
    }

    return fallbackIndex;
  };

  const getMessageId = (
    turn,
    bubble,
    text,
    position
  ) => {
    const turnKey =
      turn.getAttribute("data-turn-key");

    if (turnKey) {
      return turnKey;
    }

    const messageContainer =
      bubble.closest(
        "[data-chatgpt-search-message-ids]"
      );

    const messageId =
      messageContainer?.getAttribute(
        "data-chatgpt-search-message-ids"
      );

    if (messageId) {
      return messageId;
    }

    return `fallback-${position}-${hashString(
      text
    )}`;
  };

  const getCurrentItems = () => {
    const bubbles =
      findUserMessages();

    return bubbles
      .map((bubble, index) => {
        const text =
          getMessageText(bubble);

        if (!text) {
          return null;
        }

        const turn =
          getTurnElement(bubble);

        const position =
          getPosition(
            bubble,
            index
          );

        const id =
          getMessageId(
            turn,
            bubble,
            text,
            position
          );

        turn.dataset.rewindId = id;

        turn.dataset.rewindPosition =
          String(position);

        return {
          id,
          position,

          title:
            text.length > 70
              ? `${text.slice(0, 70)}...`
              : text,

          text,
        };
      })
      .filter(Boolean);
  };

  /**
   * 기존 저장 데이터 읽기
   *
   * v0.2 / v0.3 배열 형식도 호환
   */
  const getSavedConversation =
    async () => {
      const key =
        getConversationKey();

      const result =
        await chrome.storage.local.get(
          key
        );

      const value =
        result[key];

      /**
       * 이전 버전 데이터
       */
      if (Array.isArray(value)) {
        return {
          id: getConversationId(),
          title:
            getConversationTitle(),
          url: getConversationUrl(),
          updatedAt: Date.now(),
          items: value,
        };
      }

      return (
        value ?? {
          id: getConversationId(),
          title:
            getConversationTitle(),
          url: getConversationUrl(),
          updatedAt: Date.now(),
          items: [],
        }
      );
    };

  const saveCurrentItems =
    async () => {
      /**
       * /c/...가 아닌 페이지에서도
       * 동작은 하지만 새 채팅은
       * URL 확정 후 저장되는 게 가장 안정적
       */
      const key =
        getConversationKey();

      const currentItems =
        getCurrentItems();

      const conversation =
        await getSavedConversation();

      const map =
        new Map();

      conversation.items.forEach(
        (item) => {
          map.set(item.id, item);
        }
      );

      currentItems.forEach(
        (item) => {
          map.set(item.id, item);
        }
      );

      const items =
        Array.from(map.values())
          .sort(
            (a, b) =>
              a.position -
              b.position
          )
          .map((item, index) => ({
            ...item,
            index: index + 1,
          }));

      const updatedConversation = {
        id: getConversationId(),

        title:
          getConversationTitle(),

        url:
          getConversationUrl(),

        updatedAt:
          Date.now(),

        items,
      };

      await chrome.storage.local.set({
        [key]: updatedConversation,
      });

      return updatedConversation;
    };

  const findMountedTarget = (id) => {
    return Array.from(
      document.querySelectorAll(
        "[data-rewind-id]"
      )
    ).find(
      (element) =>
        element.dataset.rewindId === id
    );
  };

  const getMountedPositionRange =
    () => {
      const items =
        getCurrentItems();

      if (!items.length) {
        return null;
      }

      const positions =
        items
          .map(
            (item) =>
              item.position
          )
          .filter(
            Number.isFinite
          );

      if (!positions.length) {
        return null;
      }

      return {
        min:
          Math.min(...positions),

        max:
          Math.max(...positions),
      };
    };

  const revealTarget = (
    target
  ) => {
    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    const oldOutline =
      target.style.outline;

    const oldRadius =
      target.style.borderRadius;

    target.style.outline =
      "2px solid rgba(80, 80, 80, 0.55)";

    target.style.borderRadius =
      "12px";

    window.setTimeout(() => {
      target.style.outline =
        oldOutline;

      target.style.borderRadius =
        oldRadius;
    }, 1400);
  };

const findAndScrollToMessage = async (id) => {
  await saveCurrentItems();

  const target =
    findMountedTarget(id);

  if (!target) {
    console.log(
      "[Rewind] target is not currently mounted:",
      id
    );

    return false;
  }

  revealTarget(target);

  return true;
};

  /**
   * 다른 채팅 검색결과를 눌렀을 경우
   * 페이지 이동 후 자동 점프
   */
const handlePendingJump = async () => {
  const result =
    await chrome.storage.local.get(
      PENDING_JUMP_KEY
    );

  const pending =
    result[PENDING_JUMP_KEY];

  if (!pending) {
    return;
  }

  if (
    pending.conversationId !==
    getConversationId()
  ) {
    return;
  }

  /**
   * 중요:
   * 실행 전에 먼저 제거해서
   * 실패하더라도 반복 실행되지 않게 함
   */
  await chrome.storage.local.remove(
    PENDING_JUMP_KEY
  );

  await sleep(700);

  const success =
    await findAndScrollToMessage(
      pending.messageId
    );

  console.log(
    "[Rewind] pending jump:",
    success ? "success" : "target not mounted"
  );
};

  chrome.runtime.onMessage.addListener(
    (
      message,
      _sender,
      sendResponse
    ) => {
      if (
        message.type ===
        "rewind:get-outline"
      ) {
        saveCurrentItems()
          .then((conversation) => {
            sendResponse({
              conversation,
              items:
                conversation.items,
            });
          });

        return true;
      }

      if (
        message.type ===
        "rewind:scroll-to"
      ) {
        findAndScrollToMessage(
          message.id
        ).then((success) => {
          sendResponse({
            success,
          });
        });

        return true;
      }
    }
  );

  let updateTimer;

  const observer =
    new MutationObserver(
      (mutations) => {
        const changed =
          mutations.some(
            (mutation) =>
              mutation.addedNodes
                .length ||
              mutation.removedNodes
                .length
          );

        if (!changed) {
          return;
        }

        clearTimeout(
          updateTimer
        );

        updateTimer =
          setTimeout(
            async () => {
              try {
                await saveCurrentItems();

                chrome.runtime
                  .sendMessage({
                    type:
                      "rewind:outline-updated",
                  })
                  .catch(() => {});
              } catch (error) {
                console.error(
                  "[Rewind]",
                  error
                );
              }
            },
            400
          );
      }
    );

  observer.observe(
    document.body,
    {
      childList: true,
      subtree: true,
    }
  );

  saveCurrentItems()
    .then(() => {
      handlePendingJump();
    })
    .catch(console.error);

    /**
 * 최초 대화 저장
 */
saveCurrentItems()
  .then(() => {
    handlePendingJump();
  })
  .catch(console.error);


/**
 * ======================================================
 * ChatGPT SPA 대화 변경 감지
 *
 * /c/AAAA
 *      ↓
 * /c/BBBB
 *
 * ChatGPT는 페이지 전체 reload 없이
 * 대화만 바꾸므로 pathname 변경을 감지해야 한다.
 * ======================================================
 */

let lastPathname = location.pathname;

const handleConversationChange = async () => {
  const currentPathname = location.pathname;

  if (currentPathname === lastPathname) {
    return;
  }

  const previousPathname = lastPathname;

  lastPathname = currentPathname;

  console.log(
    "[Rewind] conversation changed:",
    previousPathname,
    "→",
    currentPathname
  );

  /**
   * ChatGPT가 새 대화 DOM을 렌더링할 시간
   */
  await sleep(1000);

  try {
    const conversation =
      await saveCurrentItems();

    console.log(
      "[Rewind] indexed conversation:",
      conversation.title,
      conversation.items.length,
      "questions"
    );

    chrome.runtime
      .sendMessage({
        type: "rewind:outline-updated",
      })
      .catch(() => {});

    await handlePendingJump();
  } catch (error) {
    console.error(
      "[Rewind] conversation change error:",
      error
    );
  }
};


/**
 * ChatGPT 내부 라우팅은 구현이 바뀔 수 있으므로
 * 단순 pathname 감시를 fallback으로 사용
 */
window.setInterval(() => {
  if (
    location.pathname !==
    lastPathname
  ) {
    handleConversationChange();
  }
}, 500);

})();

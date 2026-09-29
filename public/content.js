(() => {
  console.log("[Rewind] content script loaded");

  /**
   * 현재 화면에 렌더링된 사용자 메시지 찾기
   */
  const findUserMessages = () => {
    return Array.from(
      document.querySelectorAll(
        '[data-user-message-bubble="true"]'
      )
    );
  };

  /**
   * 사용자 메시지가 속한 전체 conversation turn 찾기
   */
  const getTurnElement = (bubble) => {
    return (
      bubble.closest("[data-turn-key]") ||
      bubble.closest("[data-content-search-turn-key]") ||
      bubble.closest("[data-chatgpt-search-unit-key]") ||
      bubble
    );
  };

  /**
   * 사용자 질문 내용
   */
  const getMessageText = (bubble) => {
    return (
      bubble.innerText
        ?.trim()
        .replace(/\s+/g, " ") || ""
    );
  };

  /**
   * Rewind 목차 생성
   */
  const getOutline = () => {
    const bubbles = findUserMessages();

    console.log(
      `[Rewind] user messages found: ${bubbles.length}`
    );

    const items = [];

    bubbles.forEach((bubble, index) => {
      const turn = getTurnElement(bubble);

      const text = getMessageText(bubble);

      if (!text) {
        return;
      }

      /**
       * ChatGPT 자체 turn-key가 있으면 사용
       */
      const turnKey =
        turn.getAttribute("data-turn-key") ||
        `rewind-${index}`;

      /**
       * 우리가 이동할 수 있도록 DOM에도 저장
       */
      turn.dataset.rewindId = turnKey;

      items.push({
        id: turnKey,
        index: index + 1,
        title:
          text.length > 70
            ? `${text.slice(0, 70)}...`
            : text,
        text,
      });
    });

    return items;
  };

  /**
   * 질문 클릭 → 해당 위치로 이동
   */
  const scrollToMessage = (id) => {
    const elements = document.querySelectorAll(
      "[data-rewind-id]"
    );

    const target = Array.from(elements).find(
      (element) =>
        element.dataset.rewindId === id
    );

    if (!target) {
      console.warn(
        "[Rewind] target not found:",
        id
      );

      return false;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    /**
     * 이동한 위치 잠깐 강조
     */
    const previousOutline =
      target.style.outline;

    const previousRadius =
      target.style.borderRadius;

    target.style.outline =
      "2px solid rgba(120, 120, 120, 0.45)";

    target.style.borderRadius =
      "12px";

    window.setTimeout(() => {
      target.style.outline =
        previousOutline;

      target.style.borderRadius =
        previousRadius;
    }, 1200);

    return true;
  };

  /**
   * Side Panel → content.js 메시지 수신
   */
  chrome.runtime.onMessage.addListener(
    (message, _sender, sendResponse) => {
      if (
        message.type ===
        "rewind:get-outline"
      ) {
        const items = getOutline();

        sendResponse({
          items,
        });

        return true;
      }

      if (
        message.type ===
        "rewind:scroll-to"
      ) {
        const success =
          scrollToMessage(message.id);

        sendResponse({
          success,
        });

        return true;
      }
    }
  );

  /**
   * ChatGPT SPA DOM 변화 감지
   */
  let updateTimer;

  const observer = new MutationObserver(
    (mutations) => {
      const changed = mutations.some(
        (mutation) =>
          mutation.addedNodes.length > 0 ||
          mutation.removedNodes.length > 0
      );

      if (!changed) {
        return;
      }

      window.clearTimeout(updateTimer);

      updateTimer = window.setTimeout(
        () => {
          const count =
            findUserMessages().length;

          console.log(
            `[Rewind] DOM updated: ${count} user messages`
          );

          chrome.runtime
            .sendMessage({
              type:
                "rewind:outline-updated",
            })
            .catch(() => {
              // Rewind 패널이 닫혀있으면 무시
            });
        },
        400
      );
    }
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  console.log(
    "[Rewind] observer started"
  );
})();
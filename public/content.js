(() => {
  let idSequence = 0;

  function createId() {
    idSequence += 1;

    return `rewind-${idSequence}`;
  }

  function getMessageContainer(messageElement) {
    return (
      messageElement.closest("article") ||
      messageElement.closest('[data-testid^="conversation-turn"]') ||
      messageElement.parentElement
    );
  }

  function getOutline() {
    const userMessages = document.querySelectorAll(
      '[data-message-author-role="user"]'
    );

    return Array.from(userMessages)
      .map((messageElement, index) => {
        const container = getMessageContainer(messageElement);

        if (!container) {
          return null;
        }

        if (!container.dataset.rewindId) {
          container.dataset.rewindId = createId();
        }

        const text = messageElement.textContent
          ?.trim()
          .replace(/\s+/g, " ");

        if (!text) {
          return null;
        }

        return {
          id: container.dataset.rewindId,

          index: index + 1,

          title:
            text.length > 60
              ? `${text.substring(0, 60)}...`
              : text,

          text
        };
      })
      .filter(Boolean);
  }

  function scrollToMessage(id) {
    const target = document.querySelector(
      `[data-rewind-id="${CSS.escape(id)}"]`
    );

    if (!target) {
      return false;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    return true;
  }

  chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

      if (message.type === "rewind:get-outline") {

        sendResponse({
          items: getOutline()
        });

        return;
      }

      if (message.type === "rewind:scroll-to") {

        const success = scrollToMessage(
          message.id
        );

        sendResponse({
          success
        });
      }
    }
  );

  let updateTimer;

  const observer = new MutationObserver(() => {

    clearTimeout(updateTimer);

    updateTimer = setTimeout(() => {

      chrome.runtime
        .sendMessage({
          type: "rewind:outline-updated"
        })
        .catch(() => {});

    }, 400);

  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

})();
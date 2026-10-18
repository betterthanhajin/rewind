import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { getChatGPTHistory, type HistoryConversation } from './lib/chatHistory';
import { conversationPath, readConversations, recentVisits, searchConversations, STORAGE_PREFIX,
  type Conversation, type OutlineItem } from './lib/conversations';

const getCurrentTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const createPendingJump = (conversationId: string, item: OutlineItem) => ({ conversationId, item, createdAt: Date.now() });
const formatDate = (time: number) => Number.isFinite(time) && time > 0
  ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' }).format(time) : '';

function App() {
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyConversations, setHistoryConversations] = useState<HistoryConversation[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef(0);

  const refreshConversations = useCallback(async () => {
    try { setConversations(readConversations(await chrome.storage.local.get(null))); }
    catch { setNotice('저장된 대화를 읽지 못했습니다. Rewind를 다시 열어주세요.'); }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      setHistoryConversations(await getChatGPTHistory());
      setNow(Date.now());
    } catch { setNotice('방문 기록을 읽지 못했습니다. 확장 프로그램의 history 권한을 확인해주세요.'); }
  }, []);

  const refreshCurrentConversation = useCallback(async () => {
    const request = ++requestId.current;
    try {
      const tab = await getCurrentTab();
      const id = conversationPath(tab?.url ?? '');
      if (tab?.id == null || !id) {
        if (request === requestId.current) setCurrentConversation(null);
        return;
      }
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'rewind:get-outline' });
      const active = await getCurrentTab();
      if (request !== requestId.current || active?.id !== tab.id || conversationPath(active.url ?? '') !== id) return;
      setCurrentConversation(response?.conversation?.id === id ? response.conversation : null);
    } catch {
      if (request === requestId.current) setCurrentConversation(null);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshAll = () => {
      void refreshCurrentConversation();
      void refreshConversations();
      void refreshHistory();
    };
    const timer = window.setTimeout(refreshAll, 0);
    const clock = window.setInterval(() => { void refreshHistory(); }, 60000);
    const onMessage = (message: { type?: string; success?: boolean; reason?: string }) => {
      if (message.type === 'rewind:outline-updated') {
        void refreshCurrentConversation();
        void refreshConversations();
      }
      if (message.type === 'rewind:jump-result') {
        setNotice(message.success ? '' : '질문 위치를 찾지 못했습니다. 대화 로딩이 끝난 뒤 다시 눌러주세요.');
      }
    };
    const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && Object.keys(changes).some(key => key.startsWith(STORAGE_PREFIX))) {
        void refreshConversations();
      }
    };
    const onActivated = () => { setCurrentConversation(null); refreshAll(); };
    const onUpdated = (_tabId: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (change.url || change.status === 'complete')) {
        if (change.url) setCurrentConversation(null);
        refreshAll();
      }
    };
    chrome.runtime.onMessage.addListener(onMessage);
    chrome.storage.onChanged.addListener(onStorage);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.history.onVisited.addListener(refreshHistory);
    const invalidateRequests = () => { requestId.current += 1; };
    return () => {
      invalidateRequests();
      window.clearTimeout(timer);
      window.clearInterval(clock);
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.storage.onChanged.removeListener(onStorage);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.history.onVisited.removeListener(refreshHistory);
    };
  }, [refreshCurrentConversation, refreshConversations, refreshHistory]);

  const openConversation = async (conversation: { id: string; url: string }, item?: OutlineItem | null) => {
    setNotice('');
    const id = conversationPath(conversation.url);
    if (!id || id !== conversation.id) {
      setNotice('유효한 대화 주소가 없습니다.');
      return;
    }
    let pendingKey: string | null = null;
    try {
      const tab = await getCurrentTab();
      if (tab?.id == null) throw new Error('No active tab');
      pendingKey = `rewind:pending-jump:${tab.id}`;
      if (item && conversationPath(tab.url ?? '') === id) {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'rewind:scroll-to', conversationId: id, item,
        });
        if (!response?.success) setNotice('질문 위치를 찾지 못했습니다. 대화 로딩이 끝난 뒤 다시 눌러주세요.');
        return;
      }
      if (item) {
        await chrome.storage.local.set({ [pendingKey]: createPendingJump(id, item) });
      } else {
        await chrome.storage.local.remove(pendingKey);
      }
      await chrome.tabs.update(tab.id, { url: conversation.url });
    } catch {
      if (pendingKey) await chrome.storage.local.remove(pendingKey).catch(() => {});
      setNotice('이동하지 못했습니다. 확장을 업데이트했다면 ChatGPT 탭을 새로고침해주세요.');
    }
  };

  const keyword = search.trim();
  const searchResults = useMemo(() => searchConversations(conversations, search), [conversations, search]);
  const indexedIds = useMemo(() => new Set(conversations.map(c => c.id)), [conversations]);
  const unindexed = useMemo(() => historyConversations.filter(c => !indexedIds.has(c.id)), [historyConversations, indexedIds]);
  const unindexedSearchResults = useMemo(() => keyword
    ? unindexed.filter(c => c.title.toLocaleLowerCase().includes(keyword.toLocaleLowerCase())) : [], [unindexed, keyword]);
  const recent = useMemo(() => recentVisits(unindexed, now), [unindexed, now]);
  const otherConversations = conversations.filter(c => c.id !== currentConversation?.id);
  const totalQuestions = conversations.reduce((total, c) => total + c.items.length, 0);

  if (loading) return <main className="rewind"><div className="status">Loading Rewind...</div></main>;

  return <main className="rewind">
    <header><div className="logo"><span className="logo-icon">↩</span><div>
      <h1>Rewind</h1><p>Find what you already discussed.</p>
    </div></div></header>
    <input className="search" type="search" aria-label="Search your memory" placeholder="Search your memory..."
      value={search} onChange={event => setSearch(event.target.value)} />
    <div className="stats">
      <div className="stat"><strong>{conversations.length}</strong><span>conversations</span></div>
      <div className="stat"><strong>{totalQuestions}</strong><span>questions</span></div>
    </div>
    {notice && <div className="notice" role="status">{notice}</div>}
    {keyword ? <>
      <div className="section-heading"><span>SEARCH RESULTS</span><span>{searchResults.length + unindexedSearchResults.length}</span></div>
      {searchResults.length > 0 && <>
        <div className="search-group-title">✓ INDEXED</div>
        <section className="results">{searchResults.map(({ conversation, item }) =>
          <button key={`${conversation.id}:${item?.id ?? 'title'}`} type="button" className="search-result"
            onClick={() => void openConversation(conversation, item)}>
            <span className="result-chat">{conversation.title}</span>
            <span className="result-text">{item?.title ?? conversation.title}</span>
            <span className="open-to-index">{item ? '질문으로 이동 →' : '대화 제목 일치 · 대화 열기 →'}</span>
            <span className="result-date">{formatDate(conversation.updatedAt)}</span>
          </button>)}</section>
      </>}
      {unindexedSearchResults.length > 0 && <>
        <div className="search-group-title unindexed-title">○ NOT INDEXED YET</div>
        <section className="results">{unindexedSearchResults.map(conversation =>
          <button key={conversation.id} type="button" className="search-result unindexed-result"
            onClick={() => void openConversation(conversation)}>
            <span className="result-chat">과거 ChatGPT 대화</span>
            <span className="result-text">{conversation.title}</span>
            <span className="open-to-index">열어서 Rewind에 기억시키기 →</span>
            <span className="result-date">{formatDate(conversation.lastVisitTime)}</span>
          </button>)}</section>
      </>}
      {!searchResults.length && !unindexedSearchResults.length && <div className="empty">검색 결과가 없습니다.</div>}
    </> : <>
      <div className="section-heading"><span>THIS CONVERSATION</span><span>{currentConversation?.items.length ?? 0}</span></div>
      <section className="outline">{currentConversation?.items.map(item =>
        <button key={item.id} type="button" className="message" onClick={() => void openConversation(currentConversation, item)}>
          <span className="number">{item.index}</span><span className="title">{item.title}</span>
        </button>)}
        {!currentConversation?.items.length && <div className="empty">아직 저장된 질문이 없습니다.</div>}
      </section>
      <div className="section-heading indexed-heading"><span>INDEXED</span><span>{otherConversations.length}</span></div>
      <section className="conversation-list">{otherConversations.map(conversation =>
        <button key={conversation.id} type="button" className="conversation-card" onClick={() => void openConversation(conversation)}>
          <span className="memory-state">✓</span>
          <div className="conversation-main"><span className="conversation-title">{conversation.title}</span>
            <span className="conversation-meta">{conversation.items.length} questions</span></div>
          <span className="conversation-date">{formatDate(conversation.updatedAt)}</span>
        </button>)}
        {!otherConversations.length && <div className="empty">아직 다른 대화를 기억하지 않았습니다.</div>}
      </section>
      <div className="section-heading indexed-heading"><span>RECENTLY VISITED · 7 DAYS</span><span>{recent.length}</span></div>
      <section className="conversation-list">{recent.map(conversation =>
        <button key={conversation.id} type="button" className="conversation-card unindexed" onClick={() => void openConversation(conversation)}>
          <span className="memory-state">○</span>
          <div className="conversation-main"><span className="conversation-title">{conversation.title}</span>
            <span className="conversation-meta">Open to index</span></div>
          <span className="conversation-date">{formatDate(conversation.lastVisitTime)}</span>
        </button>)}
        {!recent.length && <div className="empty">최근 7일간 추가로 인덱싱할 대화가 없습니다.</div>}
      </section>
    </>}
  </main>;
}

export default App;

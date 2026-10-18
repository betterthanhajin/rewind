import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationPath, readConversations, recentVisits, searchConversations } from '../src/lib/conversations.ts';

const items = [
  { id: 'first', position: 0, index: 1, text: '첫 번째 질문', title: '첫 번째 질문' },
  { id: 'second', position: 2, index: 2, text: 'DB LOCK 설명', title: 'DB LOCK 설명' },
];
const conversation = { id: '/c/demo', title: 'JDBC 공부', url: 'https://chatgpt.com/c/demo', updatedAt: 123, items };

test('title match returns one conversation, not all unrelated questions', () => {
  const results = searchConversations([conversation], ' jdbc ');
  assert.equal(results.length, 1);
  assert.equal(results[0].item, null);
});
test('question match returns only matching questions, including index zero', () => {
  assert.equal(searchConversations([conversation], '첫 번째')[0].item.position, 0);
  assert.equal(searchConversations([conversation], 'lock')[0].item.id, 'second');
  assert.deepEqual(searchConversations([conversation], '  '), []);
});
test('title and question overlap does not flood the result list', () => {
  assert.equal(searchConversations([{ ...conversation, title: 'DB LOCK 대화' }], 'lock').length, 1);
});
test('invalid routes, empty records and malformed questions are excluded', () => {
  const data = {
    'rewind:conversation:/': { ...conversation, id: '/' },
    'rewind:conversation:/c/empty': { ...conversation, id: '/c/empty', items: [] },
    'rewind:conversation:/c/demo': { ...conversation, items: [...items, null, { id: 'bad' }, items[0]] },
  };
  const result = readConversations(data);
  assert.equal(result.length, 1);
  assert.equal(result[0].items.length, 2);
  assert.equal(result[0].items[0].position, 0);
});
test('project and normal URLs share the canonical conversation ID', () => {
  assert.equal(conversationPath('https://chatgpt.com/g/project/c/demo?x=1'), '/c/demo');
  assert.equal(conversationPath('https://example.com/c/demo'), null);
  assert.equal(conversationPath('https://chatgpt.com/'), null);
});
test('today plus six calendar days; boundary included, older/future/invalid excluded', () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  const start = new Date(2026, 9, 12).getTime();
  const data = [start - 1, start, now, now + 1, NaN, 0].map(lastVisitTime => ({ lastVisitTime }));
  assert.deepEqual(recentVisits(data, now).map(x => x.lastVisitTime), [now, start]);
});
test('recent window rolls forward at midnight', () => {
  const visit = new Date(2026, 9, 12, 12).getTime();
  assert.equal(recentVisits([{ lastVisitTime: visit }], new Date(2026, 9, 18, 23, 59).getTime()).length, 1);
  assert.equal(recentVisits([{ lastVisitTime: visit }], new Date(2026, 9, 19).getTime()).length, 0);
});

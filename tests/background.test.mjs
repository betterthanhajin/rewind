import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

function setup(data) {
  let listener;
  const context = { console, Date, chrome: {
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: { onRemoved: { addListener() {} } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: {
      get: async key => ({ [key]: data[key] }),
      remove: async key => { delete data[key]; },
    } },
  } };
  vm.runInNewContext(fs.readFileSync(new URL('../public/background.js', import.meta.url), 'utf8'), context);
  return (tabId, conversationId) => new Promise(resolve => listener(
    { type: 'rewind:take-pending-jump', conversationId }, { tab: { id: tabId } }, resolve));
}
test('pending first question is consumed once by the correct tab and conversation', async () => {
  const pending = { conversationId: '/c/demo', item: { id: 'first', position: 0 }, createdAt: Date.now() };
  const data = { 'rewind:pending-jump:1': pending };
  const take = setup(data);
  assert.equal((await take(2, '/c/demo')).pending, null);
  assert.equal((await take(1, '/c/other')).pending, null);
  assert.equal((await take(1, '/c/demo')).pending.item.position, 0);
  assert.equal((await take(1, '/c/demo')).pending, null);
});
test('expired pending jumps never trigger unexpected navigation', async () => {
  const data = { 'rewind:pending-jump:1': { conversationId: '/c/demo', createdAt: Date.now() - 61000 } };
  assert.equal((await setup(data)(1, '/c/demo')).pending, null);
  assert.equal(Object.keys(data).length, 0);
});

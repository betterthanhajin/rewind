// Run after npm run build. Requires Playwright and an installed Chromium.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.REWIND_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.REWIND_CHROMIUM ? { executablePath: process.env.REWIND_CHROMIUM } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'],
});
const results = [];
const check = async (name, run) => { await run(); results.push(name); console.log(`PASS ${name}`); };
const item = n => ({ id: `msg-${n}`, index: n + 1, position: n * 2, title: `Question ${n}`, text: `Question ${n}` });
const fixture = `<!doctype html><html><head><title>Fixture ChatGPT</title></head><body>
<div class="thread-scroll-container" style="height:400px;width:600px;overflow:auto;position:relative">
<div style="height:10000px;position:relative" id="space"><div id="messages"></div></div></div>
<script>
window.prefix = 'Question';
window.renderMessages = () => {
 const box = document.querySelector('.thread-scroll-container');
 const first = Math.floor(box.scrollTop / 400);
 document.getElementById('messages').innerHTML = Array.from({length:3},(_,i)=>first+i).filter(n=>n<25).map(n=>
 '<article data-turn-key="msg-'+n+'" data-content-search-turn-key="fallback-turn-'+(n*2)+'" style="position:absolute;top:'+(n*400)+'px;height:300px;width:550px">'+
 '<div data-user-message-bubble="true">'+window.prefix+' '+n+'</div></article>').join('');
};
document.querySelector('.thread-scroll-container').addEventListener('scroll',window.renderMessages);
document.querySelector('.thread-scroll-container').scrollTop=7600;
window.renderMessages();
</script></body></html>`;

async function contentPage({ source = 'public/content.js', pending = false } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://chatgpt.com/c/demo');
  await page.evaluate(({ items, pending }) => {
    window.data = { 'rewind:conversation:/c/demo': {
      id:'/c/demo', title:'Fixture ChatGPT', url:location.href, updatedAt:1, items,
    } };
    window.pending = pending ? { conversationId:'/c/demo', item:items[0], createdAt:Date.now() } : null;
    window.jumpResults=[];window.takeCount=0;window.contentListeners=[];
    window.chrome = {
      storage:{ local: {
        get:async keys => {
          await Promise.resolve();
          const selected=keys==null?window.data:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,window.data[k]]));
          return structuredClone(selected);
        },
        set:async values => {Object.assign(window.data,structuredClone(values));},
        remove:async key => {delete window.data[key];},
      } },
      runtime:{
        onMessage:{addListener:fn=>window.contentListeners.push(fn)},
        sendMessage:async message=>{
          if(message.type==='rewind:take-pending-jump'){
            window.takeCount++;const pending=window.pending;window.pending=null;return {pending};
          }
          if(message.type==='rewind:jump-result')window.jumpResults.push(message);
          return {};
        },
      },
    };
    window.sendToContent=message=>new Promise(resolve=>window.contentListeners[0](message,{},resolve));
  }, { items:Array.from({length:25},(_,n)=>item(n)), pending });
  await page.addScriptTag({ path:path.resolve(root,source) });
  await page.waitForTimeout(100);
  return { page, context };
}
try {
  if (process.env.REWIND_ORIGINAL_CONTENT) {
    await check('original code reproduces the offscreen first-question failure', async () => {
      const {page,context}=await contentPage({source:process.env.REWIND_ORIGINAL_CONTENT});
      const response=await page.evaluate(()=>window.sendToContent({type:'rewind:scroll-to',id:'msg-0'}));
      assert.equal(response.success,false);
      await context.close();
    });
  }
  await check('offscreen position zero is found and highlighted without repeated jumps', async () => {
    const {page,context}=await contentPage();
    const response=await page.evaluate(item=>window.sendToContent({type:'rewind:scroll-to',conversationId:'/c/demo',item}),item(0));
    assert.equal(response.success,true);
    const position=await page.locator('.thread-scroll-container').evaluate(el=>el.scrollTop);
    assert.ok(position<100);
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('.thread-scroll-container').evaluate(el=>el.scrollTop),position);
    await context.close();
  });
  await check('offscreen middle question is found by a bounded directional search', async () => {
    const {page,context}=await contentPage();
    const response=await page.evaluate(item=>window.sendToContent({type:'rewind:scroll-to',conversationId:'/c/demo',item}),item(10));
    assert.equal(response.success,true);
    assert.ok(await page.getByText('Question 10',{exact:true}).isVisible());
    await context.close();
  });
  await check('pending jump from another conversation reaches first question exactly once', async () => {
    const {page,context}=await contentPage({pending:true});
    await page.waitForFunction(()=>window.jumpResults.length>0);
    assert.equal(await page.evaluate(()=>window.jumpResults[0].success),true);
    assert.equal(await page.evaluate(()=>window.takeCount),1);
    assert.equal(await page.locator('.thread-scroll-container').evaluate(el=>el.scrollTop),0);
    await context.close();
  });
  await check('SPA transition never saves the previous DOM under a new conversation ID', async () => {
    const {page,context}=await contentPage();
    await page.evaluate(()=>history.pushState({},'', '/c/new'));
    await page.evaluate(()=>window.sendToContent({type:'rewind:get-outline'}));
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(()=>window.data['rewind:conversation:/c/new']),undefined);
    await page.evaluate(()=>{window.prefix='New question';document.title='New conversation';window.renderMessages();});
    const response=await page.evaluate(()=>window.sendToContent({type:'rewind:get-outline'}));
    assert.equal(response.conversation.id,'/c/new');
    assert.ok(response.conversation.items.every(i=>i.text.startsWith('New question')));
    assert.ok((await page.evaluate(()=>window.data['rewind:conversation:/c/demo'].items)).every(i=>i.text.startsWith('Question')));
    await context.close();
  });
  await check('home page is excluded from the index', async () => {
    const {page,context}=await contentPage();
    await page.evaluate(()=>history.pushState({},'', '/'));
    const response=await page.evaluate(()=>window.sendToContent({type:'rewind:get-outline'}));
    assert.equal(response.conversation,null);
    assert.equal(await page.evaluate(()=>window.data['rewind:conversation:/']),undefined);
    await context.close();
  });

  await check('built side panel: title/question results, first-item navigation and seven-day history', async () => {
    const context=await browser.newContext({timezoneId:'Asia/Seoul'});
    const page=await context.newPage();
    await page.route('http://rewind.test/**',route=>{
      const url=new URL(route.request().url());
      const file=path.join(root,'dist',url.pathname==='/'?'index.html':url.pathname.slice(1));
      const contentType=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
      return route.fulfill({contentType,body:fs.readFileSync(file)});
    });
    await page.addInitScript(()=>{
      const event=()=>({addListener(){},removeListener(){}});
      const items=[{id:'zero',index:1,position:0,text:'첫 번째 질문',title:'첫 번째 질문'},
        {id:'one',index:2,position:2,text:'다른 질문',title:'다른 질문'}];
      const now=Date.now();const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-6);
      window.data={
        'rewind:conversation:/c/other':{id:'/c/other',title:'JDBC 공부',url:'https://chatgpt.com/c/other',updatedAt:now,items},
      };
      window.activeTab={id:7,url:'https://chatgpt.com/c/current',active:true};
      window.updates=[];window.messages=[];
      window.chrome={
        storage:{local:{get:async()=>window.data,set:async values=>Object.assign(window.data,values),remove:async key=>delete window.data[key]},onChanged:event()},
        runtime:{onMessage:event()},
        tabs:{query:async()=>[window.activeTab],update:async(id,change)=>{window.updates.push({id,...change});return window.activeTab;},
          sendMessage:async(id,message)=>{window.messages.push(message);return {conversation:{id:'/c/current',title:'Current',url:window.activeTab.url,items:[],updatedAt:now}};},
          onActivated:event(),onUpdated:event()},
        history:{onVisited:event(),search:async()=>[
          {url:'https://chatgpt.com/c/recent',title:'Recent',lastVisitTime:now-1000},
          {url:'https://chatgpt.com/c/boundary',title:'Boundary',lastVisitTime:start.getTime()},
          {url:'https://chatgpt.com/c/old',title:'Older history',lastVisitTime:start.getTime()-1},
        ]},
      };
    });
    await page.goto('http://rewind.test/');
    await page.getByText('RECENTLY VISITED · 7 DAYS').waitFor();
    assert.equal(await page.locator('.conversation-card.unindexed').count(),2);
    await page.getByRole('searchbox').fill('JDBC');
    assert.equal(await page.locator('.search-result').count(),1);
    assert.ok(await page.getByText('대화 제목 일치 · 대화 열기 →').isVisible());
    await page.getByRole('searchbox').fill('첫 번째');
    assert.equal(await page.locator('.search-result').count(),1);
    await page.locator('.search-result').click();
    const pending=await page.evaluate(()=>window.data['rewind:pending-jump:7']);
    assert.equal(pending.item.position,0);
    assert.equal(pending.item.id,'zero');
    assert.equal(await page.evaluate(()=>window.updates[0].url),'https://chatgpt.com/c/other');
    await page.getByRole('searchbox').fill('Older history');
    assert.equal(await page.locator('.search-result').count(),1);
    await context.close();
  });
  console.log(`Browser checks passed: ${results.length}`);
} finally { await browser.close(); }

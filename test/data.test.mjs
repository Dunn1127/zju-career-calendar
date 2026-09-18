import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fetchAllListings, monthsInWindow, request, sourceUrl} from '../scripts/lib/source.mjs';
import {parseDetail, normalizeEvent, plainText} from '../scripts/lib/normalize.mjs';
import {collectToFile} from '../scripts/lib/collect.mjs';
import {overlaps,eventStatus} from '../site/lib/domain.mjs';
import {futureFavoriteEvents} from '../site/lib/favorites.mjs';
import {createIcs} from '../site/lib/calendar.mjs';
const raw={ID:'a',YWLX:'xjh',MC:'测试宣讲',RQ:'2026-09-18'};
const item={id:'xjh:a',rawId:'a',type:'xjh',title:raw.MC,startTimeFormat:raw.RQ,url:'https://www.career.zju.edu.cn/jyxt/sczp/xjhgl/ckXjhgwXq.zf?xjhbh=a'};
const html=(title='测试宣讲',time='2026-09-18 10:00')=>`<div class="con-sec"><div class="con-tit">${title}</div><input id="xjhsjdmc" value="09:00-12:00"><div class="con-info"><span>紫金港校区尧坤楼215</span><span>${time}</span><span class="dif">发布时间2026-09-01 09:30</span></div><h3 class="dwxx-tit">测试公司</h3><div class="con-comk"><div class="con-comtit">招聘公告(简章)</div><div class="con-con">软件岗位，计算机专业<script>unsafe()</script></div></div></div>`;
test('monthly coverage crosses year boundaries and preserves all supported types',async()=>{
  assert.deepEqual(monthsInWindow('2026-12-28','2027-01-05'),['2026-12','2027-01']);
  const calls=[];
  const r=await fetchAllListings({start:'2026-09-28',end:'2026-10-03',post:async path=>{calls.push(path);return {code:0,result:path.endsWith('09')?[raw,{...raw,YWLX:'kzxjh'},{...raw,YWLX:'zph'},{...raw,YWLX:'zhzpxx'},raw]:[]};}});
  assert.equal(calls.length,2);assert.equal(r.list.length,3);assert.equal(new Set(r.list.map(e=>e.id)).size,3);
  await assert.rejects(fetchAllListings({start:'2026-09-18',end:'2026-09-20',post:async()=>({code:0,result:[raw,{...raw,RQ:'2026-09-19'}]})}),/Conflicting/);
  await assert.rejects(fetchAllListings({start:'2026-09-18',end:'2026-09-20',post:async()=>({code:0,result:[{...raw,RQ:'2026-99-99'}]})}));
});
test('public detail parser does not infer end time from hidden venue bookings',()=>{
  const d=parseDetail(html(),'xjh');assert.equal(d.startAt,'2026-09-18T10:00:00+08:00');assert.equal(d.endAt,null);assert.equal(d.campus,'紫金港校区');
  assert.ok(d.description.includes('计算机'));assert.ok(!d.description.includes('unsafe'));assert.equal(d.jobs.length,0);
  const fair=parseDetail(html('双选会','2026-09-18 10:00 ~2026-09-18 12:00'),'zph');assert.equal(fair.endAt,'2026-09-18T12:00:00+08:00');
  const online=parseDetail('<div class="con-tit">线上宣讲</div><div class="jbsj">举办时间：2026-09-18 18:30-19:30</div>','kzxjh');assert.equal(online.endAt,'2026-09-18T19:30:00+08:00');assert.equal(online.campus,'线上活动');
  assert.ok(sourceUrl({...item,type:'kzxjh'}).includes('/kzxjh/ckKzXjhgwXq.zf'));
  assert.ok(!plainText('联系邮箱：x@example.com\n电话13812345678').includes('13812345678'));
});
test('explicit cancellation disables conflicts and exports; detail failure keeps prior data',()=>{
  const old=normalizeEvent(item,{html:html('测试宣讲','2026-09-18 10:00-12:00')},null,'2026-09-17T00:00:00Z');
  const cancelled=normalizeEvent({...item,title:'（取消）测试宣讲'},undefined,old,'2026-09-18T00:00:00Z');
  assert.equal(cancelled.availability,'cancelled');assert.equal(cancelled.detailStatus,'stale');assert.equal(cancelled.startAt,old.startAt);
  assert.equal(eventStatus(cancelled),'cancelled');assert.equal(overlaps(old,cancelled),false);
  assert.deepEqual(futureFavoriteEvents([{event:cancelled}],Date.parse('2026-09-01')),[]);
  assert.throws(()=>createIcs([cancelled]),/取消/);
  const moved=normalizeEvent(item,{html:html('测试宣讲','2026-09-18 11:00-13:00')},old,'2026-09-18T00:00:00Z');assert.ok(moved.changes.includes('time'));
});
test('failed month leaves snapshot intact; disappeared activities are missing, not cancelled',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'zju-calendar-'));const path=join(dir,'events.json');
  try{
    await collectToFile({snapshotPath:path,now:'2026-09-18T00:00:00Z',post:async p=>({code:0,result:p.endsWith('09')?[raw]:[]}),detailFetcher:async()=>({html:html()})});
    const before=await readFile(path,'utf8');
    await assert.rejects(collectToFile({snapshotPath:path,now:'2026-09-18T00:00:00Z',post:async()=>{throw new Error('offline');}}));
    assert.equal(await readFile(path,'utf8'),before);
    const next=await collectToFile({snapshotPath:path,now:'2026-09-18T01:00:00Z',post:async()=>({code:0,result:[]})});
    assert.equal(next.events[0].availability,'missing');
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('transport retries transient failures and retains underlying diagnostics',async()=>{
  let n=0;const text=await request('/test',{sleep:async()=>{},fetchImpl:async()=>{if(++n<3)throw new TypeError('network',{cause:{code:'ECONNRESET'}});return new Response('ok');}});assert.equal(n,3);assert.equal(text,'ok');
});

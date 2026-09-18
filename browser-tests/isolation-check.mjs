import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {shanghaiDate} from '../site/lib/domain.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:960}});
const results=[];
async function select(page,event) {
  await page.locator('#kind-filter').selectOption('all');
  for(let i=0;i<4 && !await page.locator(`[data-date="${event.date}"]`).count();i++) {
    const first=await page.locator('[data-date]').first().getAttribute('data-date');
    await page.locator(event.date<first?'#previous-week':'#next-week').click();
  }
  await page.locator(`[data-date="${event.date}"]`).click();
}
try {
  const pages=[];
  for(const school of ['dlut','zju']) {
    const page=await context.newPage();
    await page.goto(`https://dunn1127.github.io/${school}-career-calendar/`);
    await expect(page.locator('#sync-meta')).toContainText('最近成功同步');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const data=await page.evaluate(async school=>{const cache=await caches.open(`${school}-calendar-data-v1`);return (await cache.match(new URL('./data/events.json',location.href))).json();},school);
    const event=data.events.find(e=>e.date>shanghaiDate() && e.availability==='listed');
    assert.ok(event);await select(page,event);
    await page.locator(`[data-favorite-id="${event.id}"]`).click();
    await expect(page.locator('#favorite-total')).toHaveText('1');
    pages.push({school,page,data});
  }
  const stored=await pages[1].page.evaluate(()=>({a:JSON.parse(localStorage.getItem('dlut-career-calendar:favorites:v1')),b:JSON.parse(localStorage.getItem('zju-career-calendar:favorites:v1'))}));
  assert.equal(stored.a.length,1);assert.equal(stored.b.length,1);assert.notEqual(stored.a[0].id,stored.b[0].id);
  const scopes=await pages[1].page.evaluate(async()=> (await navigator.serviceWorker.getRegistrations()).map(r=>r.scope));
  assert.ok(scopes.some(s=>s.endsWith('/dlut-career-calendar/')));assert.ok(scopes.some(s=>s.endsWith('/zju-career-calendar/')));
  const cacheNames=await pages[1].page.evaluate(()=>caches.keys());
  assert.ok(cacheNames.some(s=>s.startsWith('dlut-calendar-shell-')));assert.ok(cacheNames.some(s=>s.startsWith('zju-calendar-shell-')));
  const {page,data}=pages[1];
  for(const event of [data.events.find(e=>e.availability==='cancelled'),data.events.find(e=>e.startAt&&!e.endAt&&e.availability==='listed')]) {
    assert.ok(event);await select(page,event);await page.locator(`[data-event-id="${event.id}"]`).first().click();
    await expect(page.getByRole('button',{name:'导出单场日历',exact:true})).toBeDisabled();
    if(event.availability==='cancelled') await expect(page.locator('.detail-panel')).toContainText('已取消');
    await page.keyboard.press('Escape');
  }
  await context.setOffline(true);
  for(const {school,page} of pages){await page.reload();await expect(page.locator('#sync-meta')).toContainText('最近成功同步');await expect(page.locator('#favorite-total')).toHaveText('1');assert.match(await page.title(),school==='zju'?/浙大/:/大工/);results.push(`${school}: independent favorites, worker scope, cache and offline reload`);}
  await mkdir('../.omo/evidence/zju',{recursive:true});
  await writeFile('../.omo/evidence/zju/isolation.json',JSON.stringify({testedAt:new Date().toISOString(),results,scopes,cacheNames,cancellation:'PASS',missingEnd:'PASS'},null,2));
  console.log('PASS: both live sites keep separate favorites and caches; cancellation and incomplete-time export disabled');
}finally{await browser.close();}

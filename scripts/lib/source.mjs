import {addDays} from '../../site/lib/domain.mjs';
export const SCHOOL = 'https://www.career.zju.edu.cn';
const routes = {xjh:['/jyxt/sczp/xjhgl/ckXjhgwXq.zf','xjhbh'],kzxjh:['/jyxt/sczp/kzxjh/ckKzXjhgwXq.zf','xjhbh'],zph:['/jyxt/sczp/zphgl/ckZphsqdw.zf','zphbh']};
export async function request(path, {fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetchImpl(new URL(path,SCHOOL),{signal:AbortSignal.timeout(25000)});
      if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.retryable=response.status>=500;throw error;}
      return await response.text();
    } catch(error) {
      if(attempt===2 || !(error.retryable || ['TypeError','TimeoutError','AbortError'].includes(error.name))) throw new Error(`${path}: ${error.message} ${error.cause?.code??''}`,{cause:error});
      await sleep(1000*(attempt+1));
    }
  }
}
export const postJson = async path => JSON.parse(await request(path));
export function monthsInWindow(start,end) {
  addDays(start,0);addDays(end,0);
  if(end<start) throw new Error('Invalid window');
  const months=new Set();
  for(let date=start;date<=end;date=addDays(date,1)) months.add(date.slice(0,7));
  return [...months];
}
export function sourceUrl(item) {
  const [path,param]=routes[item.type];
  return `${SCHOOL}${path}?${param}=${encodeURIComponent(item.rawId)}`;
}
export async function fetchAllListings({post=postJson,start,end=addDays(start,20)}) {
  const entries=new Map();
  for(const month of monthsInWindow(start,end)) {
    const payload=await post(`/v5-api/jyxt/wzsy/cxZprlList.zf?rq=${month}`);
    if(Number(payload?.code)!==0 || !Array.isArray(payload?.result)) throw new Error(`Invalid calendar month ${month}`);
    for(const raw of payload.result) {
      if(!routes[raw.YWLX]) continue;
      if(!raw.ID || !raw.MC || typeof raw.RQ!=='string') throw new Error('Invalid calendar event');
      addDays(raw.RQ,0);
      if(!raw.RQ.startsWith(month)) throw new Error('Calendar month mismatch');
      const item={id:`${raw.YWLX}:${raw.ID}`,rawId:String(raw.ID),type:raw.YWLX,title:raw.MC,startTimeFormat:raw.RQ};
      const old=entries.get(item.id);
      if(old && (old.startTimeFormat!==item.startTimeFormat || old.title!==item.title)) throw new Error('Conflicting duplicate event');
      item.url=sourceUrl(item);entries.set(item.id,item);
    }
  }
  return {list:[...entries.values()],count:entries.size};
}
export async function fetchDetail(item,{get=request}={}) {
  const html=await get(sourceUrl(item));
  if(!html.includes('con-tit') || !html.includes('con-sec')) throw new Error('Invalid public detail page');
  return {html};
}

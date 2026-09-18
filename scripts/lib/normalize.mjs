import {load} from 'cheerio';
export const kindOf = type => ({xjh:'talk',kzxjh:'talk',zph:'fair'}[type]??'other');
export function plainText(value) {
  const $=load(String(value??''));
  $('script,style,noscript,svg,iframe,form').remove();
  $('br').replaceWith('\n');$('p,div,li,tr,h1,h2,h3,h4,h5,h6').append('\n');
  return $.root().text().replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'')
    .replace(/(?:\+?86[\s-]?)?1[3-9]\d{9}\b/g,'').replace(/\b0\d{2,3}[\s-]?\d{7,8}\b/g,'')
    .replace(/(?:联系人|联系电话|联系邮箱)[：:]?[^\n。；;]*/g,'').replace(/[^\S\n]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function stamp(date,time) {
  if(!date || !/^\d{2}:\d{2}$/.test(time??'') || +time.slice(0,2)>23 || +time.slice(3)>59) return null;
  const result=`${date}T${time}:00+08:00`;
  return Number.isFinite(Date.parse(result))?result:null;
}
export function parseDetail(html,type) {
  const $=load(html);
  const title=plainText($('.con-tit').first().text());
  if(!title) throw new Error('Detail title missing');
  const online=type==='kzxjh';
  const info=online ? $('.jbsj').first().text() : $('.con-info').first().children('span').not('.dif').map((i,e)=>$(e).text()).get().join(' ');
  const dates=info.match(/\d{4}-\d{2}-\d{2}/g)??[];
  const times=info.match(/\d{2}:\d{2}(?::\d{2})?/g)??[];
  const startAt=stamp(dates[0],times[0]?.slice(0,5));
  // Hidden room-booking slots are not assumed to be event durations.
  const candidate=stamp(dates[1]??dates[0],times[1]?.slice(0,5));
  const endAt=startAt && candidate && Date.parse(candidate)>Date.parse(startAt)?candidate:null;
  const venue=online?'线上活动':plainText($('.con-info').first().children('span').not('.dif').first().text());
  const campus=online?'线上活动':(venue.match(/(紫金港|玉泉|西溪|华家池|之江|海宁|舟山|宁波)(?:校区|国际校区)?/)?.[1]??'');
  const companyNode=$('.dwxx-tit').first().clone();companyNode.find('.con-jrzb').remove();
  const sections={};
  $('.con-comk').each((i,e)=>{sections[plainText($(e).find('.con-comtit').first().text())]=plainText($(e).find('.con-con').first().html());});
  const facts=$('.dwxx-info').first().children('span').map((i,e)=>plainText($(e).text())).get().filter(Boolean);
  return {title,startAt,endAt,date:dates[0],venue,campus:campus?(campus==='线上活动'?campus:`${campus}校区`):'校区待确认',
    building:venue.match(/(.{1,25}?(?:楼|中心|苑)[A-Z0-9一二三四五六七八九十号幢]*)/)?.[1]??'',
    company:plainText(companyNode.text()),companyInfo:{nature:facts[0]??'',scale:facts[2]??'',website:'',introduction:sections['企业简介']??''},
    jobs:[],participants:[],description:sections['招聘公告(简章)']??Object.values(sections).filter(Boolean).join('\n\n')};
}
export function normalizeEvent(item,detail,old,now) {
  const parsed=detail?parseDetail(detail.html,item.type):null;
  const current=parsed??old??{};
  const title=plainText(parsed?.title??item.title);
  const startAt=current.startAt??null,endAt=current.endAt??null,venue=current.venue??'';
  const changes=old?[...(old.changes??[])]:['new'];let previous=old?.previous;
  if(old && parsed) {
    if(old.startAt!==startAt || old.endAt!==endAt){if(!changes.includes('time'))changes.push('time');previous??={startAt:old.startAt,endAt:old.endAt,venue:old.venue};}
    if(old.venue!==venue){if(!changes.includes('venue'))changes.push('venue');previous??={startAt:old.startAt,endAt:old.endAt,venue:old.venue};}
  }
  const cancelled=/取消/.test(item.title) || /取消/.test(title);
  return {id:`${kindOf(item.type)}:${item.id}`,kind:kindOf(item.type),title,company:current.company??'',
    startAt,endAt,date:parsed?.date??item.startTimeFormat,venue,campus:current.campus??(item.type==='kzxjh'?'线上活动':'校区待确认'),building:current.building??'',sourceUrl:item.url,
    companyInfo:current.companyInfo??{},jobs:current.jobs??[],participants:current.participants??[],description:current.description??'',
    detailStatus:parsed?'ok':old?'stale':'unavailable',availability:cancelled?'cancelled':'listed',
    firstSeenAt:old?.firstSeenAt??now,lastSeenAt:now,changes,...(previous?{previous}:{})};
}

import type {Banner,Page,PageRule,PromoDoc,PromoSettings,Seen,Targeting} from './types.ts'

/** Never shown, whatever a banner says: the control room, test pages, and The Worker's game run (rule 28). */
export const NEVER_ON=['/admin','/api']
export const DEFAULTS:PromoSettings={enabled:true,delaySec:3,showSec:7,gapSec:45,maxPerSession:3,pageRules:[]}
const pathStarts=(path:string,prefix:string)=>prefix==='/'?(path==='/'||path===''):path===prefix||path.startsWith(prefix.endsWith('/')?prefix:prefix+'/')

export function pageOf(club:string|null,path:string):Page{
 if(club)return {kind:'club',club,path}
 if(path==='/'||path==='')return {kind:'home'}
 return {kind:'other',path}
}
export const pageKey=(p:Page)=>p.kind==='home'?'home':p.kind==='club'?`club:${p.club}`:'other'

/** may this banner appear on this page by its own targeting? */
export function pageAllows(t:Targeting,p:Page):boolean{
 const path=p.kind==='home'?'/':p.path
 if(NEVER_ON.some(x=>pathStarts(path,x)))return false
 if(t.exclude.some(x=>pathStarts(path,x)))return false
 if(p.kind==='home')return t.home
 if(p.kind==='club')return t.allClubs||t.clubs.includes(p.club)
 return t.other||t.paths.some(x=>pathStarts(path,x))
}
/** the per-page rule: a club's own row beats "clubs", which beats nothing */
export function ruleFor(rules:readonly PageRule[],p:Page):PageRule|null{
 const find=(k:string)=>rules.find(r=>r.page===k)??null
 return p.kind==='home'?find('home'):p.kind==='club'?find(`club:${p.club}`)??find('clubs'):find('other')
}

/** Israel's clock, whatever the viewer's: schedule is judged where the audience is */
export function israelClock(now:number):{dow:number;hour:number;day:string}{
 const f=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',weekday:'short',hour:'2-digit',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now))
 const g=(t:string)=>f.find(x=>x.type===t)?.value??''
 const dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday'))
 return {dow,hour:Number(g('hour')),day:`${g('year')}-${g('month')}-${g('day')}`}
}
export function inWindow(b:Banner,now:number):boolean{
 if(b.startsAt&&now<Date.parse(b.startsAt))return false
 if(b.endsAt&&now>Date.parse(b.endsAt))return false
 const c=israelClock(now)
 if(b.days.length&&!b.days.includes(c.dow))return false
 const {fromHour:a,toHour:z}=b
 if(a===z)return true // 0–0 (or any equal pair) = all day
 return a<z?(c.hour>=a&&c.hour<z):(c.hour>=a||c.hour<z) // 22→6 wraps midnight
}

export type Viewer={israel:boolean}
/** every banner that may be put in front of this viewer on this page right now, before frequency caps */
export function eligible(doc:Pick<PromoDoc,'settings'|'banners'>,page:Page,now:number,v:Viewer):Banner[]{
 if(!doc.settings.enabled)return []
 const rule=ruleFor(doc.settings.pageRules,page)
 if(rule?.mode==='off')return []
 return doc.banners.filter(b=>b.enabled&&(b.audience==='all'||v.israel)&&pageAllows(b.targeting,page)&&inWindow(b,now)&&(!rule||rule.mode!=='only'||rule.only.includes(b.id)))
}

/** frequency caps: per session, per Israel day, and a cooldown between two showings of one banner */
export function capped(b:Banner,seen:Seen,session:Seen,now:number):boolean{
 if(b.maxPerSession>0&&(session[b.id]?.n??0)>=b.maxPerSession)return true
 const s=seen[b.id],day=israelClock(now).day
 if(s){
  if(b.maxPerDay>0&&s.day===day&&s.dn>=b.maxPerDay)return true
  if(b.cooldownMin>0&&now-s.last<b.cooldownMin*60000)return true
 }
 return false
}
/**
 * The rotation. Weight is the owner's dial; a banner this device has never seen is twice as likely, each showing today
 * thins it, and the one shown last is passed over whenever another is available — so two banners alternate, three cycle.
 */
export function pickBanner(list:readonly Banner[],seen:Seen,lastId:string|null,now:number,rand:()=>number):Banner|null{
 const day=israelClock(now).day
 const pool=list.length>1?list.filter(b=>b.id!==lastId):[...list]
 const use=pool.length?pool:[...list]
 const w=use.map(b=>{const s=seen[b.id];return Math.max(0,b.weight)*(s?1:2)/(1+(s&&s.day===day?s.dn:0))})
 const total=w.reduce((a,b)=>a+b,0);if(use.length===0||total<=0)return null
 let r=rand()*total;for(let i=0;i<use.length;i++){r-=w[i]!;if(r<0)return use[i]!}
 return use[use.length-1]!
}
export const delayOf=(b:Banner,s:PromoSettings)=>(b.delaySec??s.delaySec)*1000
export const showOf=(b:Banner,s:PromoSettings)=>(b.showSec??s.showSec)*1000

/** the link carries where it was seen, so the other app can tell a banner visit from any other */
/** a banner that points back into this site: same tab, no tracking parameters */
export const isOwn=(b:Banner)=>{try{return new URL(b.href).hostname==='dubid.dubelteam.com'}catch{return false}}
export function outbound(b:Banner,p:Page):string{
 try{const u=new URL(b.href);if(u.hostname==='dubid.dubelteam.com')return b.href;u.searchParams.set('utm_source','dubid');u.searchParams.set('utm_medium','banner');u.searchParams.set('utm_campaign',b.id);u.searchParams.set('utm_content',p.kind==='club'?p.club:p.kind);return u.toString()}catch{return b.href}
}


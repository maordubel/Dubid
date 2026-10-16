/**
 * The owner's own advertising: 320×50 banners for his other apps, slid up from the bottom of the screen.
 * Pure types and rules — no server, no DOM — so the server layout, the browser and the control room judge a banner by the SAME code.
 */
export type Audience='all'|'israel'
export type Targeting={home:boolean;allClubs:boolean;clubs:string[];other:boolean;paths:string[];exclude:string[]}
export type Banner={
 id:string;name:string;enabled:boolean
 href:string;alt:string;img1x:string;img2x:string
 audience:Audience;targeting:Targeting
 startsAt:string|null;endsAt:string|null
 days:number[];fromHour:number;toHour:number
 delaySec:number|null;showSec:number|null
 weight:number;maxPerSession:number;maxPerDay:number;cooldownMin:number
 note:string
}
export type PageRule={page:string;mode:'auto'|'off'|'only';only:string[]}
export type PromoSettings={enabled:boolean;delaySec:number;showSec:number;gapSec:number;maxPerSession:number;pageRules:PageRule[]}
export type PromoAudit={at:string;by:string;what:string}
export type PromoDoc={v:1;settings:PromoSettings;banners:Banner[];audit:PromoAudit[]}
/** where a viewer is: the home page, a club (its id), or any other page of the site */
export type Page={kind:'home'}|{kind:'club';club:string;path:string}|{kind:'other';path:string}
export type Seen={[id:string]:{n:number;last:number;day:string;dn:number}}

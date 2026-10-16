import type {Banner,PromoDoc} from './types.ts'
const base={enabled:true,audience:'all' as const,startsAt:null,endsAt:null,days:[],fromHour:0,toHour:0,delaySec:null,showSec:null,weight:10,maxPerSession:1,maxPerDay:0,cooldownMin:30,note:''}
/** The owner's three first banners (14.10.2026). The control room edits them from here; a store with no file starts as this. */
export const SEED_BANNERS:Banner[]=[
 {...base,id:'offsides',name:'Offsides',href:'https://offsides.dubelteam.com',alt:'Play Offsides! A different kind of game.',img1x:'/ads/offsides-1x.webp',img2x:'/ads/offsides-2x.webp',
  targeting:{home:true,allClubs:true,clubs:[],other:true,paths:[],exclude:[]},note:'Every page.'},
 {...base,id:'takemeout',name:'TakeMeOut',href:'https://takemeout.dubelteam.com',alt:'TakeMeOut — flying abroad? The nightlife guide.',img1x:'/ads/takemeout-1x.webp',img2x:'/ads/takemeout-2x.webp',
  targeting:{home:true,allClubs:true,clubs:[],other:true,paths:[],exclude:[]},note:'Every page.'},
 {...base,id:'dubid',name:'Dubid (Hebrew)',href:'https://dubid.dubelteam.com',alt:'Dubid — פנטזי קצת שונה. כל מחזור משחק חדש!',img1x:'/ads/dubid-1x.webp',img2x:'/ads/dubid-2x.webp',
  targeting:{home:false,allClubs:false,clubs:['hapoel-tel-aviv','hapoel-petah-tikva'],other:false,paths:[],exclude:[]},note:'Hebrew banner — Hapoel Tel Aviv and Hapoel Petah Tikva only.'},
]
const SITE='https://fanlife.dubelteam.com'
const own=(id:string,name:string,path:string,alt:string,exclude:string[]):Banner=>({...base,id,name,href:`${SITE}${path}`,alt,img1x:`/ads/${id}-1x.webp`,img2x:`/ads/${id}-2x.webp`,
 targeting:{home:true,allClubs:true,clubs:[],other:true,paths:[],exclude},note:'In-house: one of the three features we market. Hidden on its own pages.'})
/** Added 14.10.2026: the three flagship features in the house style, and the fuckyou banner for every page. */
export const SEED_ADDED:Banner[]=[
 own('manager','Legends Manager','/all-football/legends','Legends Manager — build your club’s all-time legends side.',['/all-football/legends']),
 own('market','Shirt market','/market','Swap the shirt — the FAN LIFE shirt market.',['/market','/closet','/auction']),
 own('life','LIFE','/#life','Life! — live one fan’s seasons.',['/']),
 {...base,id:'fuckyou',name:'FUCK YOU (fuckyou.dubelteam.com)',href:'https://fuckyou.dubelteam.com',alt:'Say it. Don’t send it. — play now.',img1x:'/ads/fuckyou-1x.webp',img2x:'/ads/fuckyou-2x.webp',
  targeting:{home:true,allClubs:true,clubs:[],other:true,paths:[],exclude:[]},note:'Every page.'},
]
export const SEED_DOC:PromoDoc={v:1,settings:{enabled:true,delaySec:3,showSec:7,gapSec:45,maxPerSession:3,pageRules:[]},banners:[...SEED_BANNERS,...SEED_ADDED],audit:[]}

import { useEffect, useMemo, useRef, useState } from "react";

const DURATION = 150;
const CASE = "36";

type Shot = { start:number; end:number; route:string; eyebrow:string; title:string; body:string; align?:"left"|"right"; scale?:number; x?:number; y?:number };

function basePath(){const r=(import.meta.env.VITE_BASENAME||"").trim();return !r||r==="/"?"":`/${r.replace(/^\/+|\/+$/g,"")}`}

const VO = [
  "Medical imaging contains extraordinary detail. But finding what matters can still mean moving between disconnected tools, views, and reports.",
  "BodyMaps brings the workflow together. Search a growing library of CT scans, open a case, and move through axial, coronal, and sagittal views in one connected workspace.",
  "Segmentation turns those slices into anatomy. Organs can be explored in three dimensions while measurements and editing tools stay close to the image.",
  "Cases can be compared side by side, helping differences in anatomy and quantitative measurements become easier to see.",
  "BodyMaps also brings artificial intelligence into the workspace, so imaging, anatomy, and clinical context can be explored without leaving the case.",
  "And when the analysis is finished, the report does more than list measurements. It walks through what was found, what looks normal, and what deserves attention.",
  "For patients and families, Share Report turns that result into a focused, de-identified summary that can be opened from a link and brought directly into a conversation with a doctor.",
  "From discovery, to visualization, to understanding and communication: BodyMaps is building one map for the entire imaging journey."
];

export default function AwardDemoPage(){
 const base=useMemo(basePath,[]);
 const shots:Shot[]=useMemo(()=>[
  {start:0,end:8,route:"",eyebrow:"JOHNS HOPKINS UNIVERSITY",title:"See the body.\nUnderstand the story.",body:"BodyMaps",scale:1},
  {start:8,end:25,route:"/dashboard",eyebrow:"DISCOVER",title:"A library built\nfor exploration.",body:"Search and open real CT cases from the current BodyMaps dashboard.",align:"left",scale:1.03},
  {start:25,end:50,route:`/case/${CASE}`,eyebrow:"VISUALIZE",title:"Three planes.\nOne anatomy.",body:"Move through the real Case 36 viewer.",align:"right",scale:1.02},
  {start:50,end:68,route:`/case/${CASE}`,eyebrow:"RECONSTRUCT",title:"From slices\nto structure.",body:"3D anatomy, segmentation, measurement and editing live beside the scan.",align:"left",scale:1.06,x:-1,y:-1},
  {start:68,end:84,route:"/compare?a=36&b=182",eyebrow:"COMPARE",title:"Case by case.\nSide by side.",body:"The actual BodyMaps comparison workflow.",align:"right",scale:1.01},
  {start:84,end:101,route:`/case/${CASE}`,eyebrow:"ASK",title:"AI, inside\nthe workspace.",body:"Explore anatomy and context without leaving the case.",align:"left",scale:1.035},
  {start:101,end:124,route:`/case/${CASE}`,eyebrow:"UNDERSTAND",title:"A report you can\nactually follow.",body:"Findings, measurements and next steps become a guided story.",align:"right",scale:1.02},
  {start:124,end:144,route:`/share/demo-case-36`,eyebrow:"SHARE REPORT",title:"From the scan\nto the conversation.",body:"A focused patient summary designed to travel with a link.",align:"left",scale:1},
  {start:144,end:150,route:"",eyebrow:"BODYMAPS",title:"One map for the\nimaging journey.",body:"Medical imaging, mapped.",scale:1},
 ],[]);
 const [sec,setSec]=useState(0),[playing,setPlaying]=useState(false),[loaded,setLoaded]=useState(false),[muted,setMuted]=useState(false);
 const started=useRef(0),raf=useRef<number|null>(null),speech=useRef<SpeechSynthesisUtterance|null>(null);
 const shot=shots.find(s=>sec>=s.start&&sec<s.end)||shots[shots.length-1];
 const src=shot.route?`${base}${shot.route}`:"";
 useEffect(()=>{if(!playing)return;const tick=()=>{const s=Math.min(DURATION,(performance.now()-started.current)/1000);setSec(s);if(s<DURATION)raf.current=requestAnimationFrame(tick);else setPlaying(false)};raf.current=requestAnimationFrame(tick);return()=>{if(raf.current)cancelAnimationFrame(raf.current)}},[playing]);
 const narrate=()=>{if(!("speechSynthesis" in window)||muted)return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(VO.join(" "));u.rate=.94;u.pitch=.94;u.volume=1;const voices=window.speechSynthesis.getVoices();u.voice=voices.find(v=>/Samantha|Ava|Serena|Daniel|Alex/i.test(v.name))||voices.find(v=>v.lang.startsWith("en"))||null;speech.current=u;window.speechSynthesis.speak(u)};
 const start=()=>{started.current=performance.now();setSec(0);setPlaying(true);narrate()};
 useEffect(()=>()=>window.speechSynthesis?.cancel(),[]);
 return <main className="award"><style>{CSS}</style>
   {src&&<div className="product" style={{transform:`scale(${shot.scale||1}) translate(${shot.x||0}%,${shot.y||0}%)`}}><iframe key={src} src={src} onLoad={()=>setLoaded(true)} title="BodyMaps product"/></div>}
   {!src&&<div className="black"/>}
   <div className="grade"/><div className="bars top"/><div className="bars bottom"/>
   <section className={`copy ${shot.align||"center"}`} key={`${shot.start}-${shot.title}`}><small>{shot.eyebrow}</small><h1>{shot.title.split("\n").map((x,i)=><span key={i}>{x}</span>)}</h1><p>{shot.body}</p></section>
   {playing&&<><div className="time">{Math.floor(sec/60)}:{String(Math.floor(sec%60)).padStart(2,"0")}</div><div className="progress"><i style={{width:`${sec/DURATION*100}%`}}/></div></>}
   {!playing&&sec===0&&<div className="gate"><div><img src={`${base}/bodymaps-logo.svg`} /><small>2:30 AWARD FILM</small><h2>BodyMaps.</h2><p>This cut drives the current product itself. Turn on system audio before screen recording.</p><button onClick={start}>PLAY WITH NARRATION</button><button className="quiet" onClick={()=>{setMuted(true);started.current=performance.now();setPlaying(true)}}>Play silent</button></div></div>}
   {!playing&&sec>=DURATION&&<button className="replay" onClick={start}>Replay</button>}
   {playing&&<button className="mute" onClick={()=>{setMuted(v=>!v);window.speechSynthesis.cancel()}}>{muted?"Narration off":"Narration on"}</button>}
 </main>
}

const CSS=`
*{box-sizing:border-box}html,body,#root,.App{margin:0;width:100%;height:100%;overflow:hidden}.award{position:fixed;inset:0;background:#030405;color:white;overflow:hidden;font-family:Inter,-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif}.product{position:absolute;inset:0;transition:transform 2.2s cubic-bezier(.16,1,.3,1),filter 1s ease;transform-origin:center}.product iframe{width:100%;height:100%;border:0;pointer-events:none}.black{position:absolute;inset:0;background:radial-gradient(circle at 50% 42%,#101318,#020304 55%)}.grade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.48),transparent 32%,transparent 68%,rgba(0,0,0,.48));z-index:4}.bars{position:absolute;left:0;right:0;height:4.2vh;background:#020304;z-index:7}.bars.top{top:0}.bars.bottom{bottom:0}.copy{position:absolute;z-index:10;max-width:720px;animation:enter 1s cubic-bezier(.16,1,.3,1) both;text-shadow:0 4px 35px rgba(0,0,0,.95)}.copy.left{left:5.5vw;top:16vh;text-align:left}.copy.right{right:5.5vw;bottom:13vh;text-align:right}.copy.center{left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;max-width:1000px}.copy small{display:block;font-size:11px;letter-spacing:.22em;font-weight:800;color:rgba(255,255,255,.62);margin-bottom:14px}.copy h1{font-size:clamp(58px,7vw,112px);line-height:.88;letter-spacing:-.07em;margin:0;font-weight:850}.copy h1 span{display:block}.copy p{font-size:15px;line-height:1.55;color:rgba(255,255,255,.67);max-width:470px;margin-top:22px}.copy.right p{margin-left:auto}.copy.center p{margin-left:auto;margin-right:auto}.gate{position:absolute;inset:0;z-index:50;background:#020304;display:flex;align-items:center;justify-content:center;text-align:center}.gate>div{width:560px}.gate img{width:70px;height:70px;display:block;margin:0 auto 28px}.gate small{letter-spacing:.22em;color:#666}.gate h2{font-size:78px;letter-spacing:-.07em;margin:12px 0}.gate p{color:#888;line-height:1.6}.gate button,.replay{border:0;border-radius:999px;background:white;color:#111;padding:14px 23px;font-weight:800;margin:10px 5px}.gate .quiet{background:#17191d;color:#aaa}.progress{position:absolute;left:0;right:0;bottom:0;height:3px;z-index:30}.progress i{height:100%;display:block;background:white}.time{position:absolute;z-index:30;right:18px;bottom:13px;font-size:10px;color:#777}.mute{position:absolute;z-index:30;left:18px;bottom:13px;background:rgba(0,0,0,.55);color:#aaa;border:1px solid #333;border-radius:999px;padding:7px 10px;font-size:10px}.replay{position:absolute;z-index:60;left:50%;bottom:25px;transform:translateX(-50%)}@keyframes enter{from{opacity:0;filter:blur(10px);transform:translateY(28px)}to{opacity:1;filter:blur(0);transform:translateY(0)}}
`;

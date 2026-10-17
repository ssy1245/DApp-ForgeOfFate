import { useEffect, useState } from 'react';

type Props={busy:boolean;maxLevel:number;heatStrikes:number;weapon?:{id:string;name:string;level:number;status:string};onAction:(label:string,path:string,body?:any)=>Promise<void>};
export default function CheatPanel({busy,maxLevel,heatStrikes,weapon,onAction}:Props){
 const [open,setOpen]=useState(true),[resource,setResource]=useState('all'),[amount,setAmount]=useState(1000),[count,setCount]=useState(3),[level,setLevel]=useState(0),[quality,setQuality]=useState('普通'),[editLevel,setEditLevel]=useState(0);
 useEffect(()=>setEditLevel(weapon?.level??0),[weapon?.id,weapon?.level]);
 const valid=(n:number,min:number,max:number)=>Number.isInteger(n)&&n>=min&&n<=max;
 const editable=!busy&&weapon?.status==='active';
 return <section className="cheat-panel" aria-label="测试账号作弊菜单">
  <button className="cheat-heading" aria-expanded={open} onClick={()=>setOpen(!open)}><span>⚙ 作弊菜单 <small>仅测试账号 · 可无限次使用</small></span><span>{open?'收起':'展开'}</span></button>
  {open&&<><p className="cheat-intro">刷出的剑与调整过的剑均保留 DEMO 标记；普通账号无法使用这些功能。</p>
   <div className="cheat-grid">
    <div className="cheat-section"><h3>无限补给</h3><p>再领三把基础剑和一份每日资源，不占当天正常领取次数。</p><button className="secondary" disabled={busy} onClick={()=>onAction('刷每日补给','/cheats/daily')}>再领 3 把基础剑 ＋ 每日资源</button>
     <label>资源种类<select value={resource} onChange={e=>setResource(e.target.value)}>{[['all','全部资源'],['ap','行动点'],['materials','材料'],['shields','保护符'],['coins','游戏金币']].map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
     <label>添加数量<input type="number" min={1} max={1000000} step={1} value={amount} onChange={e=>setAmount(e.target.valueAsNumber)}/></label><button className="secondary" disabled={busy||!valid(amount,1,1000000)} onClick={()=>onAction('刷资源','/cheats/resources',{resource,amount})}>添加资源</button>
    </div>
    <div className="cheat-section"><h3>批量刷剑</h3><label>品质<select value={quality} onChange={e=>setQuality(e.target.value)}><option>普通</option><option>精良</option></select></label><label>初始等级<input type="number" min={0} max={maxLevel} value={level} onChange={e=>setLevel(e.target.valueAsNumber)}/></label><div className="cheat-presets">{[0,3,50,maxLevel].filter((v,i,a)=>a.indexOf(v)===i).map(n=><button key={n} className="quiet" onClick={()=>setLevel(n)}>+{n}</button>)}</div><label>数量（每批 1–100 把）<input type="number" min={1} max={100} value={count} onChange={e=>setCount(e.target.valueAsNumber)}/></label><button className="secondary" disabled={busy||!valid(count,1,100)||!valid(level,0,maxLevel)} onClick={()=>onAction('刷剑','/cheats/weapons',{count,level,quality})}>刷出 {valid(count,1,100)?count:'—'} 把剑</button></div>
    <div className="cheat-section"><h3>调整当前剑</h3><p>{weapon?`${weapon.name} +${weapon.level}`:'先选择或刷出一把剑'} · 仅可修改未封存武器</p><label>目标等级<input type="number" min={0} max={maxLevel} value={editLevel} onChange={e=>setEditLevel(e.target.valueAsNumber)}/></label><button className="secondary" disabled={!editable||!valid(editLevel,0,maxLevel)} onClick={()=>onAction('调整等级',`/cheats/weapons/${weapon!.id}`,{level:editLevel})}>设为指定等级</button><button className="secondary" disabled={!editable} onClick={()=>onAction('立即加热',`/cheats/weapons/${weapon!.id}`,{heated:true})}>立即烧红 · 可敲 {heatStrikes} 锤</button><button className="quiet" disabled={!editable} onClick={()=>onAction('耗尽热量',`/cheats/weapons/${weapon!.id}`,{heated:false})}>耗尽热量（测试熔炉）</button><button className="secondary" disabled={!editable} onClick={()=>onAction('设置无敌',`/cheats/weapons/${weapon!.id}`,{protected_left:100})}>免损毁 100 锤</button><button className="quiet" disabled={!editable} onClick={()=>onAction('移除无敌',`/cheats/weapons/${weapon!.id}`,{protected_left:0})}>移除免损毁保护</button></div>
   </div>
  </>}
 </section>;
}

import {useEffect, useRef} from 'react';
import {LanguageSwitch, useI18n} from './i18n';
import {swordBranches} from './swordTiers';
import './weaponRoutePrompt.css';

export type RouteOffer = {player:string; weaponId:string; level:number; branch:string;changed:true;reached_level:number;chance:number};

export default function WeaponRoutePrompt({offer,onContinue}:{offer:RouteOffer;onContinue:()=>void}) {
 const {t,name}=useI18n();
 const dialog=useRef<HTMLDialogElement>(null), keep=useRef<HTMLButtonElement>(null);
 const route=swordBranches.find(item=>item.id===offer.branch)!;
 useEffect(()=>{
  const panel=dialog.current!;
  panel.showModal();keep.current?.focus();
  return()=>panel.close();
 },[]);
 return <dialog ref={dialog} className="weapon-route-prompt" data-route={route.id}
  aria-labelledby="route-prompt-title" aria-describedby="route-prompt-description route-prompt-warning"
  onCancel={event=>{event.preventDefault();onContinue();}}>
  <div className="route-prompt-top"><span>FORGE OF FATE</span><LanguageSwitch/></div>
  <div className="route-prompt-mark" aria-hidden="true">+{route.unlock_level}</div>
  <p className="route-prompt-eyebrow">{t`+${route.unlock_level} 突变判定 · ${Math.round(offer.chance*100)}%`}</p>
  <h2 id="route-prompt-title">{t`突变成功 · ${name(route)}`}</h2>
  <p id="route-prompt-description">{t('本次结果已保存。刷新、重试或降级后重新升级，都不会重复判定。')}</p>
  <div className="route-prompt-levels">
   <div><span>{t('本次强化结果')}</span><strong>+{offer.reached_level}</strong></div>
   <span className="route-prompt-arrow" aria-hidden="true">→</span>
   <div><span>{name(route)}</span><strong>+{offer.level}</strong></div>
  </div>
  <p id="route-prompt-warning" className="route-prompt-warning">{t`已从 +${route.unlock_level} 开始新的路线，最高 +${route.max_level}。此后不再参与任何路线突变判定。`}</p>
  <div className="route-prompt-actions">
   <button ref={keep} className="primary" onClick={onContinue}>{t('继续锻造')}</button>
  </div>
 </dialog>;
}

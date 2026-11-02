import {useI18n} from './i18n';
import {IronAmount} from './IronIcon';
import WardIcon from './WardIcon';

type Weapon={level:number;status:string;heat_charges:number;protected_left:number;strikes:number};
type Props={weapon?:Weapon;maxLevel:number;mintLevel:number;probabilities:Record<string,number>;
 heatCost:number;strikeCost:number;heatSeconds:number;heatStrikes:number;protectionTrigger:number;
 shield:boolean;canToggleShield:boolean;onShield:(value:boolean)=>void;
 heatDisabled:boolean;strikeDisabled:boolean;heatShortage:string;strikeShortage:string;warming:boolean;hot:boolean;
 onHeat:()=>void;onStrike:()=>void};

export default function ForgeActions({weapon,maxLevel,mintLevel,probabilities,heatCost,strikeCost,heatSeconds,heatStrikes,protectionTrigger,shield,canToggleShield,onShield,heatDisabled,strikeDisabled,heatShortage,strikeShortage,warming,hot,onHeat,onStrike}:Props){
 const {t}=useI18n();
 const active=weapon?.status==='active',capped=!!weapon&&weapon.level>=maxLevel;
 const outcomes=[['double',t('大成功'),'+2'],['up',t('成功'),'+1'],['down',t('降级'),'−1'],['destroy',t('永久损毁'),'×'],...(probabilities.saved?[['saved',t('保护后不变'),'—']]:[])];
 return <div className="forge-actions">
  <div className="forge-levels"><div className="forge-current-level"><span>{t('当前等级')}</span><strong>{weapon?`+${weapon.level}`:'—'}</strong></div><div><span>{t('上链门槛')}</span><strong>+{mintLevel}</strong></div><div><span>{t('路线等级上限')}</span><strong>+{maxLevel}</strong></div></div>
  <div className="forge-level-track" aria-hidden="true"><span style={{width:`${Math.min((weapon?.level??0)/mintLevel*100,100)}%`}}/></div>
  <div className="probability-title"><span>{t('下一锤的命运')}</span><small>{t(capped?'已达到路线等级上限':active?'当前武器概率':'先取出一把武器')}</small></div>
  <div className="probabilities">{outcomes.map(([id,label,symbol])=><div key={id} className={`prob ${id}`}><span><b aria-hidden="true">{symbol}</b>{label}</span><strong>{active&&!capped?`${((probabilities[id]??0)*100).toFixed(1)}%`:'—'}</strong></div>)}</div>
  <div className="forge-costs" aria-label={t('当前锻造成本')}>
   <div data-cost="heat"><span>{t('每次加热')}</span>{active?<IronAmount amount={heatCost}/>:<strong>—</strong>}<small>{t`${heatSeconds} 秒 · 可敲 ${heatStrikes} 锤`}</small></div>
   <div data-cost="strike"><span>{t('每次敲击')}</span>{active?<IronAmount amount={strikeCost}/>:<strong>—</strong>}<small>{t('按当前武器阶段计费')}</small></div>
  </div>
  <label className="shield-toggle"><input type="checkbox" checked={shield} aria-keyshortcuts="Q" disabled={!canToggleShield} onChange={e=>onShield(e.target.checked)}/><span><b>{t('启用保护符 · Q')}</b><small>{t('仅挡住损毁时消耗 1 张，仍可能降级')}</small></span><span className="shield-icon"><WardIcon size="medium"/></span></label>
  {weapon&&<div className={`stage-info${weapon.protected_left?' protected':''}`}>{weapon.protected_left?t`✦ 无敌阶段 · 剩余 ${weapon.protected_left} 锤免损毁`:t`距离免损毁阶段还需 ${Math.max(0,protectionTrigger-weapon.strikes)} 锤`}</div>}
  <div className="forge-action-buttons">
   <button className="secondary heat-button" disabled={heatDisabled||!!heatShortage} onClick={onHeat}><span className="forge-action-number" aria-hidden="true">01</span><span>{capped?t('已达到路线等级上限'):heatShortage?t('铁块不足，无法加热'):warming?t('加热中…'):hot?t`热量剩余 ${weapon!.heat_charges} 锤`:t('送入熔炉加热')}</span><span aria-hidden="true">♨</span></button>
   <button className="primary strike" disabled={strikeDisabled} onClick={onStrike}><span className="forge-action-number" aria-hidden="true">02</span><span>{t('⚒ 敲下命运之锤')}</span><span aria-hidden="true">↗</span></button>
  </div>
  {strikeShortage&&<small className="risk-note" role="alert">{t(strikeShortage)}</small>}
  <details className="forge-rules"><summary>{t('消耗与损毁说明')}</summary><small className="risk-note">{t('单锤成本随武器阶段变化，突变或降级后会重新计算，以当前显示为准。')}</small><small className="risk-note">{t('每次敲击都会消耗铁块，降级、保护生效与损毁也照常扣除。损毁会永久失去当前武器及已投入资源。')}</small></details>
 </div>;
}

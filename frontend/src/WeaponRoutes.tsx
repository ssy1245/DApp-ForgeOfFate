import {useI18n} from './i18n';
import {swordBranches} from './swordTiers';
import './weaponRoutes.css';
export default function WeaponRoutes({weapon,busy,onChoose}:{weapon?:{branch?:string;branch_locked?:boolean;level:number;status:string};busy:boolean;onChoose:(branch:string)=>void}){
 const {t,name}=useI18n();const current=weapon?.branch||'longsword';
 const fixed=!!weapon&&(weapon.branch_locked||current!=='longsword');
 return <section className="weapon-routes" aria-label={t('选择武器路线')}>
  <h3>{t('选择武器路线')}</h3>
  <p>{t(!weapon?'先从领剑处或仓库取出一把骑士剑，再加热、敲击升级。':fixed?'路线已固定，继续强化当前武器即可；不能转回骑士剑或切换其他路线。':'骑士剑是起点：升到 +5 可转刺剑；想要巨剑，就先保持骑士剑并升到 +10。')}</p>
  <div className="route-options">{swordBranches.map(route=>{
   const selected=!!weapon&&current===route.id,base=route.id==='longsword';
   const allowed=!!weapon&&weapon.status==='active'&&!fixed&&current==='longsword'&&weapon.level>=route.unlock_level&&weapon.level<=swordBranches[0].max_level;
   return <article key={route.id} className={`route-option${selected?' selected':''}`} data-route={route.id} data-current={selected}>
    <div><strong>{name(route)}</strong><span>{selected?t('当前路线'):base?t('初始路线'):t`+${route.unlock_level} 解锁`}</span></div>
    <small>{base?t('直接强化，无需转换。'):t`转换后从 +${route.unlock_level} 开始`}{' · '}{t`最高 +${route.max_level}`}</small>
    {!base&&!fixed&&weapon&&weapon.level<route.unlock_level&&<small>{t`还需强化 ${route.unlock_level-weapon.level} 级`}</small>}
    {!base&&<button className="secondary" disabled={busy||!allowed||selected} onClick={()=>onChoose(route.id)}>{t(selected?'路线已选择':fixed?'不可再切换':route.id==='rapier'?'转为刺剑':'转为巨剑')}</button>}
   </article>;
  })}</div>
  <p className="route-warning">{t('只能选择一次。转刺剑重置为 +5，转巨剑重置为 +10；当前更高的等级不会保留。')}</p>
 </section>;
}

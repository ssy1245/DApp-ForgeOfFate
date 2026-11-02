import {useI18n} from './i18n';
import {swordBranches} from './swordTiers';
import './weaponRoutes.css';
export default function WeaponRoutes({weapon,chances}:{weapon?:{branch?:string;branch_locked?:boolean;level:number;status:string;mutation_checked_level?:number};chances?:Record<string,number>}){
 const {t,name}=useI18n();const current=weapon?.branch||'longsword';
 const fixed=!!weapon&&(weapon.branch_locked||current!=='longsword');
 return <section className="weapon-routes" aria-label={t('武器突变路线')}>
  <h3>{t('武器突变路线')}</h3>
  <p>{t(!weapon?'先从领剑处或仓库取出一把骑士剑，再加热、敲击升级。':fixed?'路线已固定，继续强化即可；此后不再参与任何路线突变判定。':'骑士剑首次达到或跨过 +5 判定刺剑；仍是骑士剑时，首次达到或跨过 +10 判定巨剑。')}</p>
  <div className="route-options">{swordBranches.map(route=>{
   const selected=!!weapon&&current===route.id,base=route.id==='longsword';
   const checked=!!weapon&&Math.max(weapon.mutation_checked_level??0,weapon.level)>=route.unlock_level;
   return <article key={route.id} className={`route-option${selected?' selected':''}`} data-route={route.id} data-current={selected}>
    <div><strong>{name(route)}</strong><span>{selected?t('当前路线'):base?t('初始路线'):t`首次 +${route.unlock_level}`}</span></div>
    <small>{base?t('未突变时保持骑士剑。'):t`突变成功率 ${Math.round((chances?.[route.id]??0)*100)}% · 从 +${route.unlock_level} 开始`}{' · '}{t`最高 +${route.max_level}`}</small>
    {!base&&!selected&&<small>{t(fixed?'不会再次判定':checked?'本门槛已结束':'只判定一次，跳级也会触发。')}</small>}
   </article>;
  })}</div>
  <p className="route-warning">{t('每把武器最多判定两次，不能手动切换。降级、重试和重启不会重抽；突变后路线永久固定。')}</p>
 </section>;
}

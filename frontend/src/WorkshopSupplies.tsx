import {useI18n} from './i18n';
import IronIcon from './IronIcon';
import WardIcon from './WardIcon';
import {GoldAmount} from './GoldIcon';
import WeaponArtwork from './WeaponArtwork';
import './workshopSupplies.css';

type Prices={coin_sword_level?:number;coin_sword_price?:number;material_pack_size?:number;material_pack_price?:number;shield_pack_size?:number;shield_pack_price?:number};
type Props={balance?:Prices;coins:number;disabled:boolean;canClaimDemo:boolean;demoDisabled:boolean;
 onBuy:(item:'sword'|'iron'|'ward')=>void;onDemo:()=>void};

export default function WorkshopSupplies({balance,coins,disabled,canClaimDemo,demoDisabled,onBuy,onDemo}:Props){
 const {t,number}=useI18n();
 const level=balance?.coin_sword_level??0;
 const goods=[
  {id:'sword' as const,title:t('普通剑'),quantity:t`初始 +${level}`,price:balance?.coin_sword_price??2500,
   description:t('一把新剑，开启下一段锻造。'),label:t`购买 +${level} 普通剑`,className:'sword-pack-button',
   art:<WeaponArtwork weapon={{branch:'longsword',level}}/>},
  {id:'iron' as const,title:t('铁块'),quantity:t`每包 ${balance?.material_pack_size??20} 块`,price:balance?.material_pack_price??5000,
   description:t('用于加热、敲击与锻造新剑。'),label:t`补充 ${balance?.material_pack_size??20} 铁块`,className:'material-pack-button',art:<IronIcon size="large"/>},
  {id:'ward' as const,title:t('保护符'),quantity:t`每包 ${balance?.shield_pack_size??1} 张`,price:balance?.shield_pack_price??2500,
   description:t('挡住一次损毁，仍可能降级。'),label:t`购买 ${balance?.shield_pack_size??1} 张保护符`,className:'ward-pack-button',art:<WardIcon size="large"/>},
 ];
 return <section className="bottom-panels workshop-supplies" aria-label={t('工坊补给')}>
  <header className="supplies-heading"><div><span className="supplies-eyebrow">FORGE OF FATE · SUPPLIES</span><h3>{t('工坊补给')}</h3><p>{t('使用游戏金币购买铁块、普通剑或保护符。')}</p></div><div className="supplies-balance"><span>{t('可用游戏金币')}</span><GoldAmount amount={number(coins)}/></div></header>
  <div className="supplies-grid">{goods.map(item=><article className={`supply-product supply-product-${item.id}`} key={item.id}>
   <div className="supply-product-top"><div className="supply-product-art" aria-hidden="true">{item.art}</div><div><span className="supply-product-quantity">{item.quantity}</span><h4>{item.title}</h4></div></div>
   <p>{item.description}</p>
   <div className="supply-product-price"><span>{t('价格')}</span><GoldAmount amount={number(item.price)}/></div>
   <button className={`secondary supply-buy ${item.className}`} disabled={disabled||coins<item.price} onClick={()=>onBuy(item.id)}><span>{item.label}</span><span aria-hidden="true">↗</span></button>
   <small className="supply-product-note">{t(coins<item.price?'游戏金币不足':'购买后自动存入背包')}</small>
  </article>)}</div>
  {canClaimDemo&&<div className="supplies-demo"><button className="quiet" disabled={demoDisabled} onClick={onDemo}>{t('领取 DEMO 达标武器')}</button></div>}
 </section>;
}

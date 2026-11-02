import {useState} from 'react';
import {useI18n} from './i18n';

type Props={listed:boolean;disabled:boolean;price:string;onPrice:(value:string)=>void;
 onList:()=>void;onCancel:()=>void;onStake:()=>void};
export default function NFTActions({listed,disabled,price,onPrice,onList,onCancel,onStake}:Props){
 const {t}=useI18n();const [editing,setEditing]=useState(false);
 return <div className="nft-controls">
  {!editing?<>
   {!listed&&<button className="secondary nft-stake-action nft-wide" disabled={disabled} onClick={onStake}>{t('质押 NFT')}</button>}
   <button className="primary nft-list-action nft-wide" disabled={disabled} onClick={()=>setEditing(true)}>{t(listed?'更新价格':'挂牌出售')}</button>
   {listed&&<button className="quiet nft-wide" disabled={disabled} onClick={onCancel}>{t('撤销挂牌')}</button>}
  </>:<>
   <label className="nft-wide">{t('挂牌价格（测试 ETH）')}<input autoFocus disabled={disabled} aria-label={t('挂牌价格')} inputMode="decimal" placeholder="0.01" value={price} onChange={e=>onPrice(e.target.value)}/></label>
   <button className="primary nft-list-action" disabled={disabled} onClick={onList}>{t(listed?'更新价格':'挂牌出售')}</button>
   <button className="quiet" onClick={()=>setEditing(false)}>{t('收起')}</button>
  </>}
 </div>;
}

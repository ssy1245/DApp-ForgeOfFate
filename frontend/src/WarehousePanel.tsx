import { useEffect, useRef } from 'react';
import { useI18n } from './i18n';
import WeaponArtwork from './WeaponArtwork';
import type { WeaponIdentity } from './weaponImages';
import './warehouse.css';

export type StoredWeapon = WeaponIdentity & {
  id: string; status: string; heat_charges: number; protected_left: number;
};

export default function WarehousePanel({ weapons, currentId, disabled, feedback, onStore, onTake, onClose }: {
  weapons: StoredWeapon[]; currentId?: string; disabled: boolean; feedback: string;
  onStore: () => void; onTake: (id: string) => void; onClose: () => void;
}) {
  const { t, name } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const current = weapons.find(w => w.id === currentId);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="scene-warehouse" aria-labelledby="scene-warehouse-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="scene-warehouse-panel">
      <header><div><small>FORGE OF FATE / STORAGE</small><h2 id="scene-warehouse-title">{t('武器仓库')}</h2></div>
        <button autoFocus className="secondary" onClick={onClose}>{t('返回游玩')} <span aria-hidden="true">×</span></button></header>
      <p className="scene-warehouse-description">{t('选择武器继续锻造，原工坊武器会自动存回。存取不消耗资源。')}</p>
      <div className="scene-warehouse-current"><div><span>{t('当前工坊')}</span><strong>{current ? `${name(current)} +${current.level}` : t('工坊空闲')}</strong></div>
        <button className="secondary" disabled={disabled || !current} onClick={onStore}>{t('存入仓库')}</button></div>
      <p className="scene-warehouse-feedback" role="status">{t(feedback || '仓库中的武器保留等级、热量和保护进度。')}</p>
      <div className="scene-warehouse-list">
        {weapons.length === 0 ? <div className="scene-warehouse-empty">{t('仓库暂无武器，可以先到领剑处领取一把。')}</div> : weapons.map(w => {
          const selected = w.id === currentId;
          const sealed = w.status !== 'active';
          return <article key={w.id} className={`scene-warehouse-item ${selected ? 'is-current' : ''}`} data-weapon-id={w.id}>
            <WeaponArtwork weapon={w}/>
            <div className="scene-warehouse-item-info"><span className="scene-warehouse-status">{selected ? t('工坊中') : sealed ? t('已永久封存') : t('仓库中')}</span>
              <h3>{name(w)} <em>+{w.level}</em></h3><code title={w.id}>{w.id.slice(0, 8)}…{w.id.slice(-6)}</code>
              <p>{sealed ? t('封存武器可在武器仓库页面铭刻 NFT，无法继续锻造。') : t`剩余热量 ${w.heat_charges} · 保护进度 ${w.protected_left}`}</p>
              <button className={selected ? 'secondary' : 'primary'} disabled={disabled || sealed} onClick={() => selected ? onClose() : onTake(w.id)}>
                {selected ? t('继续锻造') : sealed ? t('不可取用') : t('取出武器')}</button>
            </div>
          </article>;
        })}
      </div>
      <footer>{t('打开仓库时已暂停移动和敲击。关闭后点击场景继续游玩。')}</footer>
    </section>
  </dialog>;
}

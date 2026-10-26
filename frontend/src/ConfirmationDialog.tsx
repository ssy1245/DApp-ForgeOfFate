import { useCallback, useEffect, useRef, useState } from 'react';
import { LanguageSwitch, useI18n } from './i18n';

export function ConfirmationDialog({ message, onAnswer }: { message: string; onAnswer: (accepted: boolean) => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onAnswer(false); }
      if (event.key !== 'Tab') return;
      const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [onAnswer]);
  return <div className="account-overlay" onClick={() => onAnswer(false)}>
    <section ref={panel} className="account-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message" onClick={event => event.stopPropagation()}>
      <div className="account-dialog-heading"><h2 id="confirmation-title">{t('确认操作')}</h2><LanguageSwitch/></div>
      <p id="confirmation-message">{t(message)}</p>
      <div className="confirmation-actions"><button ref={cancel} className="secondary" onClick={() => onAnswer(false)}>{t('取消')}</button><button className="primary" onClick={() => onAnswer(true)}>{t('确认')}</button></div>
    </section>
  </div>;
}

export function useConfirmation() {
  const [message, setMessage] = useState<string | null>(null);
  const answer = useRef<((accepted: boolean) => void) | null>(null);
  const askConfirmation = useCallback((source: string) => {
    if (answer.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => { answer.current = resolve; setMessage(source); });
  }, []);
  const onAnswer = useCallback((accepted: boolean) => {
    const resolve = answer.current;
    answer.current = null;
    setMessage(null);
    resolve?.(accepted);
  }, []);
  useEffect(() => () => { answer.current?.(false); answer.current = null; }, []);
  return { askConfirmation, confirmationDialog: message === null ? null : <ConfirmationDialog message={message} onAnswer={onAnswer}/> };
}

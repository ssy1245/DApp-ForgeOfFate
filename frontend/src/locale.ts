import english from './locales/en.json';
import catalog from '../../assets/3d/sword-tiers.json';
import branches from '../../assets/3d/sword-branches.json';

export type Locale = 'zh' | 'en';
export const LANGUAGE_STORAGE_KEY = 'forge:language';
export const isLocale = (value: unknown): value is Locale => value === 'zh' || value === 'en';
const messages: Record<string, string> = english;
const names = Object.fromEntries([...catalog, ...branches].map(value => [value.name, value.name_en]));
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only these parameters contain app-owned labels. Usernames and addresses stay verbatim.
const translatedParameters: Record<string, number[]> = {
  '选定{0}路线后无法再更换，降级也不会解除锁定。确定选择？': [0],
  '{0}已提交，等待链上确认：{1}': [0],
  '{0}成功，已获得链上确认。': [0],
  '{0}已确认。': [0],
  '{0}中…': [0],
  '{0} 已有武器，请选择空柜或先放回锻造台。': [0],
  '已从{0}拿起武器。': [0],
  '长剑已放进{0}，锻造锤已收起。': [0],
  '长剑在{0}': [0],
  '已刷出 {0} 把 +{1} {2}剑。': [2],
  '已生成 {0} 把 +{1} {2}。': [2],
  '{0}路线最高 +{1}，当前等级过高，无法切换。': [0],
  '已选择{0}路线。': [0],
  '已选择{0}路线。该路线已固定，无法再更换。': [0],
};

const patterns = Object.keys(messages).filter(key => /\{\d+\}/.test(key)).map(key => ({
  key,
  indices: [...key.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1])),
  regex: new RegExp('^' + key.split(/\{\d+\}/).map(escapeRegex).join('([\\s\\S]*?)') + '$'),
})).sort((a, b) => b.key.replace(/\{\d+\}/g, '').length - a.key.replace(/\{\d+\}/g, '').length);

export type Translator = {
  (source: string): string;
  (source: TemplateStringsArray, ...values: unknown[]): string;
};

export function translate(locale: Locale, source: string, values?: unknown[]): string {
  if (locale === 'zh') return values ? source.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? '')) : source;
  const key = source.trim();
  const template = messages[key] ?? names[key];
  if (template !== undefined) {
    const translated = values ? template.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? '')) : template;
    return source.slice(0, source.length - source.trimStart().length) + translated + source.slice(source.trimEnd().length);
  }
  // API responses and stored notifications remain canonical Chinese, so switching
  // languages also updates a notification that was already on screen.
  if (!values) for (const pattern of patterns) {
    const match = key.match(pattern.regex);
    if (!match) continue;
    const parameters: string[] = [];
    pattern.indices.forEach((index, slot) => {
      const value = match[slot + 1];
      parameters[index] = translatedParameters[pattern.key]?.includes(index) ? translate(locale, value) : value;
    });
    return translate(locale, pattern.key, parameters);
  }
  return source;
}

export function createTranslator(locale: Locale): Translator {
  return ((source: string | TemplateStringsArray, ...values: unknown[]) => {
    if (typeof source === 'string') return translate(locale, source);
    const key = source.reduce((result, part, i) => result + (i ? `{${i - 1}}` : '') + part, '');
    return translate(locale, key, values);
  }) as Translator;
}

export function readLocale(storage?: Pick<Storage, 'getItem'>): Locale {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    return isLocale(saved) ? saved : 'zh';
  } catch { return 'zh'; }
}

export function persistLocale(locale: Locale, storage?: Pick<Storage, 'setItem'>) {
  try { storage?.setItem(LANGUAGE_STORAGE_KEY, locale); } catch { /* Private browsing may disable storage. */ }
}

export function formatNumber(locale: Locale, value: number): string {
  return value.toLocaleString(locale === 'en' ? 'en-GB' : 'zh-CN');
}

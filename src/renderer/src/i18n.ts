import ru from './i18n/ru.json'
import en from './i18n/en.json'
import zh from './i18n/zh.json'
import { useStore } from './store'
import type { Language } from '@shared/types'

type Dict = Record<string, string>
export const dictionaries: Record<Language, Dict> = { ru, en, zh }

let current: Language = 'ru'
export function setLanguage(l: Language): void {
  current = l
  document.documentElement.lang = l
}

export function t(key: string, params?: Record<string, string | number>): string {
  const d = dictionaries[current] ?? ru
  let s = d[key] ?? (current === 'ru' ? undefined : (en as Dict)[key]) ?? (ru as Dict)[key] ?? key
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v))
  return s
}

export function useT(): typeof t {
  useStore((s) => s.settings?.language)
  return t
}

export function hasKey(key: string): boolean {
  return key in (ru as Dict)
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const locale = current === 'zh' ? 'zh-CN' : current === 'en' ? 'en-GB' : 'ru-RU'
  return d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

export function relativeDate(iso: string): string {
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const diff = (Date.now() - d) / 1000
  if (diff < 60) return t('time.now')
  if (diff < 3600) return t('time.minutes', { n: Math.floor(diff / 60) })
  if (diff < 86400) return t('time.hours', { n: Math.floor(diff / 3600) })
  if (diff < 86400 * 30) return t('time.days', { n: Math.floor(diff / 86400) })
  return formatDate(iso)
}

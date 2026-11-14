import { useMemo } from 'react'
import { resolveLanguage, usePrefsStore } from '../prefs/store'
import { en, zh, type MessageKey } from './messages'

export type { MessageKey }

export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  const lang = resolveLanguage(usePrefsStore.getState().language)
  const text = (lang === 'en' ? en : zh)[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
}

export function useI18n() {
  const language = usePrefsStore(state => state.language)
  const lang = resolveLanguage(language)
  return useMemo(() => ({
    lang,
    t: (key: MessageKey, vars?: Record<string, string | number>) => {
      const text = (lang === 'en' ? en : zh)[key]
      if (!vars) return text
      return text.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ''))
    },
  }), [lang])
}

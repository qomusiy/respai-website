import { create } from 'zustand'
import { en, type Dict } from './en'
import { uz } from './uz'
import { ru } from './ru'

export type Lang = 'en' | 'uz' | 'ru'
export type { Dict }

export const LANGS: Array<{ code: Lang; short: string; name: string; html: string }> = [
  { code: 'en', short: 'EN', name: 'English', html: 'en' },
  { code: 'uz', short: 'UZ', name: 'Oʻzbekcha', html: 'uz-Latn' },
  { code: 'ru', short: 'RU', name: 'Русский', html: 'ru' },
]

const DICTS: Record<Lang, Dict> = { en, uz, ru }
const KEY = 'respai-lang'
const isLang = (v: unknown): v is Lang => v === 'en' || v === 'uz' || v === 'ru'

/** ?lang=uz in the URL wins (shareable links), then the visitor's last choice, then English. */
function initialLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  const fromUrl = new URLSearchParams(window.location.search).get('lang')
  if (isLang(fromUrl)) return fromUrl
  try {
    const saved = window.localStorage.getItem(KEY)
    if (isLang(saved)) return saved
  } catch {
    // storage blocked: fall through to the default
  }
  return 'en'
}

export const useLang = create<{ lang: Lang; setLang: (l: Lang) => void }>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    try {
      window.localStorage.setItem(KEY, lang)
    } catch {
      // not persisted, still switches for this visit
    }
    const url = new URL(window.location.href)
    if (lang === 'en') url.searchParams.delete('lang')
    else url.searchParams.set('lang', lang)
    window.history.replaceState(null, '', url)
    set({ lang })
  },
}))

/** Current dictionary; re-renders the component when the language changes. */
export const useT = (): Dict => DICTS[useLang((s) => s.lang)]
/** Current dictionary outside React (event handlers, render loops). */
export const getT = (): Dict => DICTS[useLang.getState().lang]

function applyDocument(lang: Lang) {
  const d = DICTS[lang]
  document.documentElement.lang = LANGS.find((l) => l.code === lang)!.html
  document.title = d.meta.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', d.meta.description)
}

if (typeof document !== 'undefined') {
  applyDocument(useLang.getState().lang)
  useLang.subscribe((s) => applyDocument(s.lang))
}

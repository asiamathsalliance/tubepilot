import type { KeyboardEvent } from 'react'
import { useState } from 'react'

type TagChipInputProps = {
  id: string
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
  /** `card` — floating 3D chip; `pill` — compact rounded pill (Input page default). */
  chipVariant?: 'pill' | 'card'
}

const chipStyles: Record<'pill' | 'card', string> = {
  pill:
    'inline-flex items-center rounded-full border border-orange-300/90 bg-orange-100/95 px-2.5 py-1 text-sm font-medium text-orange-950 dark:border-orange-800 dark:bg-orange-950/45 dark:text-orange-100',
  card:
    'inline-flex items-center rounded-xl border-2 border-zinc-200/95 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-[3px_3px_0_0_rgba(24,24,27,0.1)] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:shadow-[3px_3px_0_0_rgba(0,0,0,0.35)]',
}

export function TagChipInput({
  id,
  tags,
  onChange,
  placeholder,
  className = '',
  chipVariant = 'pill',
}: TagChipInputProps) {
  const [draft, setDraft] = useState('')

  function commit() {
    const t = draft.trim()
    if (!t) return
    onChange([...tags, t])
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit()
      return
    }
    if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      e.preventDefault()
      onChange(tags.slice(0, -1))
    }
  }

  const wrapClass =
    chipVariant === 'card'
      ? `rounded-2xl border-2 border-zinc-200/90 bg-white/95 p-3 shadow-[4px_4px_0_0_rgba(63,63,70,0.1)] flex w-full min-h-[3.5rem] flex-wrap items-center gap-2.5 transition-[border-color,box-shadow] focus-within:border-orange-400 focus-within:shadow-[5px_5px_0_0_rgba(234,88,12,0.18)] dark:border-zinc-600 dark:bg-zinc-900/85 dark:shadow-[4px_4px_0_0_rgba(0,0,0,0.35)] dark:focus-within:border-orange-500 ${className}`
      : `input-field flex w-full min-h-[3.25rem] flex-wrap items-center gap-2 border-orange-300/90 py-2 focus-within:border-orange-500 focus-within:ring-orange-400/35 dark:border-orange-800/70 dark:focus-within:border-orange-500 ${className}`

  return (
    <div className={wrapClass}>
      {tags.map((tag, i) => (
        <span key={`${tag}-${i}`} className={chipStyles[chipVariant]}>
          {tag}
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        placeholder={tags.length === 0 ? placeholder : undefined}
        aria-label={placeholder ?? 'Add tags'}
      />
    </div>
  )
}

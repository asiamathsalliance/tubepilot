import clsx from 'clsx'

/** Orange squircle + white “T” — also used as favicon (`/tubepilot-logo.png`). */
export function TubePilotLogo({ className }: { className?: string }) {
  return (
    <img
      src="/tubepilot-logo.png"
      alt=""
      width={48}
      height={48}
      decoding="async"
      className={clsx('shrink-0 rounded-xl object-contain', className)}
    />
  )
}

/** “tube” (dark) + “pilot” (orange). */
export function TubePilotWordmark({
  className,
  size = 'header',
}: {
  className?: string
  size?: 'header' | 'large'
}) {
  const sizeCls =
    size === 'large' ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'
  return (
    <span
      className={clsx(
        'font-cartoon font-bold tracking-tight',
        sizeCls,
        className,
      )}
    >
      <span className="text-black dark:text-zinc-100">Tube</span>
      <span className="text-orange-600 dark:text-orange-400">Pilot</span>
    </span>
  )
}

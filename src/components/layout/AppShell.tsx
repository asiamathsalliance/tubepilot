import { Link, Outlet } from 'react-router-dom'
import { TubePilotLogo, TubePilotWordmark } from '../TubePilotLogo'

export function AppShell() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-zinc-100 dark:bg-zinc-950">
      <header className="sticky top-0 z-20 w-full border-b border-zinc-300/80 bg-white/95 shadow-sm backdrop-blur-md dark:border-zinc-700 dark:bg-zinc-950/95">
        <div className="flex w-full items-center justify-between gap-6 py-4 pl-8 pr-4 sm:pl-12 sm:pr-6 lg:pl-20 lg:pr-10">
          <Link
            to="/"
            className="group flex min-w-0 items-center gap-3 transition active:scale-[0.99]"
          >
            <TubePilotLogo className="h-11 w-11 drop-shadow-sm sm:h-12 sm:w-12" />
            <TubePilotWordmark className="transition-opacity group-hover:opacity-90" />
          </Link>
          <nav className="flex shrink-0 items-center gap-4 sm:gap-8">
            <Link
              to="/"
              className="text-base font-semibold text-zinc-600 transition hover:text-orange-700 dark:text-zinc-400 dark:hover:text-orange-400 sm:text-lg"
            >
              Dashboard
            </Link>
            <Link
              to="/projects/new"
              className="btn-3d-accent px-4 py-2.5 text-sm sm:px-5 sm:py-3 sm:text-base"
            >
              New project
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex w-full flex-1">
        <Outlet />
      </main>
    </div>
  )
}

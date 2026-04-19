import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Page not found
      </h1>
      <p className="mt-2 text-base text-zinc-600 dark:text-zinc-400">
        That path is not available here.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block text-base font-medium text-zinc-600 underline-offset-4 hover:text-orange-700 hover:underline dark:text-zinc-400 dark:hover:text-orange-400"
      >
        Back to dashboard
      </Link>
    </div>
  )
}

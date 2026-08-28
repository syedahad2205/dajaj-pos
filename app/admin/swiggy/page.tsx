'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { requireAdmin } from '@/lib/roleGuard';

const actions = [
  {
    href: '/admin/swiggy/import',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
      </svg>
    ),
    title: 'Upload Past Orders CSV',
    description: 'Import a Swiggy Past Orders report to record a new payout period.',
    accent: 'bg-orange-50 text-orange-600 border-orange-200',
  },
  {
    href: '/admin/swiggy/reports',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
      </svg>
    ),
    title: 'Payout Reports',
    description: 'See Cool Corner (and every other category) revenue and net payout for any import.',
    accent: 'bg-violet-50 text-violet-600 border-violet-200',
  },
  {
    href: '/admin/swiggy/categories',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
      </svg>
    ),
    title: 'Item → Category Map',
    description: 'Fix "Uncategorized" items so future imports tag Cool Corner (and everything else) correctly.',
    accent: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  },
];

export default function SwiggyHubPage() {
  const router = useRouter();
  const { authenticated, loading, role } = requireAdmin();

  if (loading) {
    return <main className="min-h-screen bg-neutral-50 px-4 py-10 text-sm text-neutral-400">Checking session…</main>;
  }

  if (!authenticated || role !== 'admin') return null;

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-neutral-200 text-neutral-500 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Swiggy Sales Tracker</h1>
            <p className="text-sm text-slate-500 mt-0.5">Import Past Orders CSVs and analyse category performance.</p>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2">
          {actions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className={`inline-flex items-center justify-center w-11 h-11 rounded-xl border ${action.accent} mb-3`}>
                {action.icon}
              </div>
              <h2 className="font-black text-lg text-slate-900">{action.title}</h2>
              <p className="mt-1 text-sm text-slate-500 leading-5">{action.description}</p>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}

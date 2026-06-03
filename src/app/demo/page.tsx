'use client';

/**
 * Demo launcher (Phase 3.5).
 *
 * Loads the bundled sample HAR (vendor-helpdesk, 7 processes) and kicks off a
 * real migration so first-timers can see the full experience without capturing
 * their own HAR.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Loader2, Play } from 'lucide-react';

import { setPendingUpload } from '@/lib/pending-upload';

export default function DemoPage(): React.JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sample-har');
      if (!res.ok) throw new Error('Sample HAR unavailable.');
      const text = await res.text();
      const file = new File([text], '01-vendor-helpdesk.har', {
        type: 'application/json',
      });
      const id = crypto.randomUUID();
      setPendingUpload(id, file);
      router.push(`/migration/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the demo.');
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white to-neutral-50 px-6 py-16">
      <div className="w-full max-w-lg text-center">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-600 transition hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Try the sample agent
        </h1>
        <p className="mt-3 text-neutral-500">
          Runs the full pipeline on a real HAR capture &mdash; the
          &ldquo;Vendor Helpdesk&rdquo; v1 agent with 7 processes, a ServiceNow +
          IDP + Email integration mix, and a resolved call graph.
        </p>

        <button
          type="button"
          onClick={launch}
          disabled={loading}
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting&hellip;
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run the sample migration
            </>
          )}
        </button>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <p className="mt-6 text-xs text-neutral-400">
          Requires <code className="font-mono">OPENAI_API_KEY</code> set on the server.
        </p>
      </div>
    </main>
  );
}

'use client';

/**
 * Home page (Phase 3.5, FILE 2): centered hero + a single big HAR drop zone.
 *
 * On "Start migration" we generate the migration id client-side, stash the
 * `File` in the in-memory handoff, and route to `/migration/[id]` where the
 * upload + live SSE stream actually run.
 */

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Clock, FileText, GitBranch, Sparkles } from 'lucide-react';

import { HarDropzone } from '@/components/upload/HarDropzone';
import { setPendingUpload } from '@/lib/pending-upload';

export default function Home(): React.JSX.Element {
  const router = useRouter();

  const handleStart = (file: File): void => {
    const id = crypto.randomUUID();
    setPendingUpload(id, file);
    router.push(`/migration/${id}`);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-white to-neutral-50 px-6 py-16">
      <div className="w-full max-w-2xl">
        <div className="mb-10 text-center">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
            <Sparkles className="h-3.5 w-3.5" />
            v1 &rarr; v2 Migration Utility
          </span>
          <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
            Kognitos Migration Utility
          </h1>
          <p className="mt-4 text-lg text-neutral-500">
            Drop a HAR file. Get SOPs.
          </p>
        </div>

        <HarDropzone onStart={handleStart} />

        <div className="mt-6 flex items-center justify-center gap-6">
          <Link
            href="/demo"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition hover:text-blue-700"
          >
            First time? Try a sample HAR
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/history"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-neutral-800"
          >
            <Clock className="h-4 w-4" />
            History
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Feature
            icon={<GitBranch className="h-5 w-5" />}
            title="Call graph"
            body="See how your v1 processes call each other."
          />
          <Feature
            icon={<FileText className="h-5 w-5" />}
            title="v2 SOPs"
            body="One-tap copy into a Kognitos v2 Draft."
          />
          <Feature
            icon={<Sparkles className="h-5 w-5" />}
            title="Connections"
            body="Aggregated checklist of integrations to set up."
          />
        </div>
      </div>
    </main>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        {icon}
      </span>
      <h3 className="mt-3 text-sm font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 text-sm text-neutral-500">{body}</p>
    </div>
  );
}

'use client';

/**
 * Drag-and-drop `.har` upload zone (Phase 3.5, FILE 3).
 *
 * Validates extension (`.har`) and size (< 100 MB), shows the selected file's
 * name + size with a "Start migration" button, and hands the `File` back to the
 * parent via {@link HarDropzoneProps.onStart}.
 */

import { useCallback, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { FileArchive, UploadCloud, X, AlertCircle } from 'lucide-react';

const MAX_BYTES = 100 * 1024 * 1024;

/** Props for {@link HarDropzone}. */
export interface HarDropzoneProps {
  /** Invoked with the validated file when the user clicks "Start migration". */
  onStart: (file: File) => void;
}

/** Human-friendly byte size, e.g. `1.4 MB`. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function validate(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.har')) {
    return 'That\u2019s not a .har file. Save the Network log as "HAR with content".';
  }
  if (file.size > MAX_BYTES) {
    return 'HAR file exceeds 100MB. Try capturing in smaller batches per agent.';
  }
  return null;
}

export function HarDropzone({ onStart }: HarDropzoneProps): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejections: FileRejection[]) => {
      setError(null);
      if (rejections.length > 0) {
        setError('Please drop a single .har file under 100MB.');
        return;
      }
      const next = accepted[0];
      if (!next) return;
      const validationError = validate(next);
      if (validationError) {
        setError(validationError);
        setFile(null);
        return;
      }
      setFile(next);
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    noClick: file !== null,
    accept: { 'application/json': ['.har'], 'application/octet-stream': ['.har'] },
    maxSize: MAX_BYTES,
  });

  return (
    <div className="w-full">
      <div
        {...getRootProps()}
        className={[
          'group relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-14 text-center transition',
          isDragActive
            ? 'border-blue-600 bg-blue-50'
            : 'border-neutral-300 bg-neutral-50 hover:border-blue-400 hover:bg-blue-50/40',
          file ? 'cursor-default' : 'cursor-pointer',
        ].join(' ')}
      >
        <input {...getInputProps()} />

        {!file ? (
          <>
            <span
              className={[
                'flex h-16 w-16 items-center justify-center rounded-full transition',
                isDragActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-blue-600 shadow-sm group-hover:scale-105',
              ].join(' ')}
            >
              <UploadCloud className="h-8 w-8" />
            </span>
            <div>
              <p className="text-lg font-medium text-neutral-900">
                {isDragActive ? 'Drop it here' : 'Drop a .har file, or click to browse'}
              </p>
              <p className="mt-1 text-sm text-neutral-500">
                Captured from your v1 Kognitos agent &middot; up to 100MB
              </p>
            </div>
          </>
        ) : (
          <div className="flex w-full max-w-md flex-col items-center gap-5">
            <div className="flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <FileArchive className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-neutral-900">{file.name}</p>
                <p className="text-sm text-neutral-500">{formatBytes(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  setError(null);
                }}
                className="flex-shrink-0 rounded-md p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex w-full items-center gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  open();
                }}
                className="rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
              >
                Choose another
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStart(file);
                }}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:bg-blue-800"
              >
                Start migration
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import type { ReactNode } from 'react';
import { filesFromDrop } from '../audio/folderPick.ts';

/**
 * Lets the player drop a folder or files onto a section instead of using the picker (T20). Dropped items are handed to
 * `onFiles` exactly as if the folder had been picked.
 */
export function DropArea({ testId, disabled, onFiles, children }: { testId: string; disabled?: boolean; onFiles: (files: File[]) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid={testId}
      className={`space-y-2 rounded ${over ? 'outline-dashed outline-2 outline-sky-400' : ''}`}
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        void filesFromDrop(e.dataTransfer).then((files) => {
          if (files.length > 0) onFiles(files);
        });
      }}
    >
      {children}
    </div>
  );
}

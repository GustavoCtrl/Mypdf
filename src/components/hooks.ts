import { useCallback, useEffect, useState } from 'react';
import { openForRender, type RenderDoc } from '../core/pdfRender';
import { isConvertibleName, loadAsPdf, type LoadedPdf } from '../core/files';
import { errorMessage, platform } from '../platform';

/** Abre o PDF no pdf.js para gerar miniaturas; fecha ao trocar de arquivo. */
export function useRenderDoc(bytes: Uint8Array | null): RenderDoc | null {
  const [doc, setDoc] = useState<RenderDoc | null>(null);
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let opened: RenderDoc | null = null;
    openForRender(bytes)
      .then((d) => {
        if (cancelled) void d.loadingTask.destroy();
        else {
          opened = d;
          setDoc(d);
        }
      })
      .catch(() => {
        /* as miniaturas mostram um ícone de erro */
      });
    return () => {
      cancelled = true;
      setDoc(null);
      if (opened) void opened.loadingTask.destroy();
    };
  }, [bytes]);
  return doc;
}

/** Estado de "um documento aberto", usado por Reordenar e Separar. */
export function useSingleDoc() {
  const [doc, setDoc] = useState<LoadedPdf | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renderDoc = useRenderDoc(doc?.bytes ?? null);

  const open = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setBusy(isConvertibleName(file.name) ? 'Convertendo com o LibreOffice…' : 'Abrindo PDF…');
    try {
      setDoc(await loadAsPdf(file, platform));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const close = useCallback(() => {
    setDoc(null);
    setError(null);
  }, []);

  return { doc, renderDoc, busy, error, setError, open, close };
}

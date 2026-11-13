// Renderização de miniaturas com pdf.js (Apache 2.0), 100% local.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// Fontes padrão e cMaps copiados para public/pdfjs (scripts/copy-pdfjs-assets.mjs).
const assetsBase = new URL('pdfjs/', document.baseURI).href;

export type RenderDoc = PDFDocumentProxy;

export async function openForRender(bytes: Uint8Array): Promise<RenderDoc> {
  const task = getDocument({
    // O pdf.js transfere (e invalida) o buffer recebido; enviamos uma cópia.
    data: bytes.slice(),
    standardFontDataUrl: `${assetsBase}standard_fonts/`,
    cMapUrl: `${assetsBase}cmaps/`,
    cMapPacked: true,
  });
  return task.promise;
}

// Limita renderizações simultâneas para manter a interface fluida.
const MAX_PARALLEL = 3;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

export interface Thumbnail {
  url: string;
  width: number;
  height: number;
}

/** Renderiza a página (base 1) como imagem e devolve uma URL blob. */
export function renderThumbnail(doc: RenderDoc, pageNumber: number, maxSize = 200): Promise<Thumbnail> {
  return withSlot(async () => {
    const page = await doc.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const scale = (maxSize / Math.max(base.width, base.height)) * ratio;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error('Falha ao gerar miniatura');
      return { url: URL.createObjectURL(blob), width: base.width, height: base.height };
    } finally {
      page.cleanup();
    }
  });
}

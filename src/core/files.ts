// Utilidades de arquivos compartilhadas pelas telas.
import { getPageCount } from './pdfOps';
import type { Platform } from '../platform';

export const CONVERTIBLE_EXTS = ['.doc', '.docx', '.ppt', '.pptx', '.pps', '.ppsx', '.odt', '.odp', '.rtf'];
export const CONVERTIBLE_ACCEPT = CONVERTIBLE_EXTS.join(',');
export const PDF_ACCEPT = '.pdf,application/pdf';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

export function stemOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function isPdfName(name: string): boolean {
  return extOf(name) === '.pdf';
}

export function isConvertibleName(name: string): boolean {
  return CONVERTIBLE_EXTS.includes(extOf(name));
}

export async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export interface LoadedPdf {
  name: string;
  bytes: Uint8Array;
  pageCount: number;
  /** Verdadeiro quando o PDF veio de uma conversão de .doc/.pptx etc. */
  convertedFrom?: string;
}

/**
 * Lê um arquivo como PDF. Se for um documento do Office/LibreOffice,
 * converte antes (quando a plataforma permitir).
 */
export async function loadAsPdf(file: File, platform: Platform, onConverting?: () => void): Promise<LoadedPdf> {
  if (isPdfName(file.name) || file.type === 'application/pdf') {
    const bytes = await readBytes(file);
    const pageCount = await getPageCount(bytes, file.name);
    return { name: file.name, bytes, pageCount };
  }
  if (isConvertibleName(file.name)) {
    onConverting?.();
    const raw = await readBytes(file);
    const bytes = await platform.convertToPdf(file.name, raw);
    const name = `${stemOf(file.name)}.pdf`;
    const pageCount = await getPageCount(bytes, name);
    return { name, bytes, pageCount, convertedFrom: file.name };
  }
  throw new Error(`"${file.name}": formato não suportado.`);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

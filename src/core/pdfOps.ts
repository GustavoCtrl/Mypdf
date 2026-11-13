// Operações de PDF (100% locais, sem internet) usando pdf-lib (licença MIT).
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

export class PdfError extends Error {}

async function load(bytes: Uint8Array, name = 'arquivo'): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // Força a leitura da árvore de páginas: arquivos corrompidos às vezes
    // "abrem" sem erro e só falham aqui.
    if (doc.getPageCount() < 1) throw new Error('sem páginas');
    return doc;
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      throw new PdfError(`"${name}" está protegido por senha ou com restrições. Remova a proteção antes de editar.`);
    }
    throw new PdfError(`"${name}" não parece ser um PDF válido ou está corrompido.`);
  }
}

async function newDocument(): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.setProducer('MyPDF');
  doc.setCreator('MyPDF');
  return doc;
}

function checkIndices(pages: number[], total: number, name: string) {
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 0 || p >= total) {
      throw new PdfError(`Página ${p + 1} inválida em "${name}" (total: ${total}).`);
    }
  }
}

/** Abre o PDF e devolve o número de páginas (também valida o arquivo). */
export async function getPageCount(bytes: Uint8Array, name?: string): Promise<number> {
  const doc = await load(bytes, name);
  return doc.getPageCount();
}

export interface MergeInput {
  name: string;
  bytes: Uint8Array;
  /** Índices (base 0) das páginas a usar, na ordem. Ausente = todas. */
  pages?: number[];
}

/** Une vários PDFs na ordem recebida. */
export async function mergePdfs(inputs: MergeInput[]): Promise<Uint8Array> {
  if (inputs.length === 0) throw new PdfError('Nenhum arquivo para unir.');
  const out = await newDocument();
  for (const input of inputs) {
    const src = await load(input.bytes, input.name);
    const total = src.getPageCount();
    const pages = input.pages ?? src.getPageIndices();
    checkIndices(pages, total, input.name);
    const copied = await out.copyPages(src, pages);
    copied.forEach((p) => out.addPage(p));
  }
  if (out.getPageCount() === 0) throw new PdfError('O resultado não teria nenhuma página.');
  return out.save();
}

/** Gera um novo PDF com as páginas na ordem indicada (índices base 0). */
export async function extractPages(bytes: Uint8Array, pages: number[], name = 'arquivo'): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfError('Selecione ao menos uma página.');
  const src = await load(bytes, name);
  checkIndices(pages, src.getPageCount(), name);
  return buildFrom(src, pages);
}

/** Reordena as páginas. `order` deve conter cada página exatamente uma vez. */
export async function reorderPages(bytes: Uint8Array, order: number[], name = 'arquivo'): Promise<Uint8Array> {
  const src = await load(bytes, name);
  const total = src.getPageCount();
  checkIndices(order, total, name);
  if (order.length !== total || new Set(order).size !== total) {
    throw new PdfError('A nova ordem precisa conter todas as páginas exatamente uma vez.');
  }
  return buildFrom(src, order, true);
}

/** Separa o PDF: cada grupo de índices vira um arquivo. */
export async function splitPdf(bytes: Uint8Array, groups: number[][], name = 'arquivo'): Promise<Uint8Array[]> {
  if (groups.length === 0) throw new PdfError('Nada para separar.');
  const src = await load(bytes, name);
  const total = src.getPageCount();
  const results: Uint8Array[] = [];
  for (const g of groups) {
    if (g.length === 0) continue;
    checkIndices(g, total, name);
    results.push(await buildFrom(src, g));
  }
  return results;
}

async function buildFrom(src: PDFDocument, pages: number[], keepInfo = false): Promise<Uint8Array> {
  const out = await newDocument();
  if (keepInfo) {
    const title = src.getTitle();
    const author = src.getAuthor();
    const subject = src.getSubject();
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
    if (subject) out.setSubject(subject);
  }
  const copied = await out.copyPages(src, pages);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}

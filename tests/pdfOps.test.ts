import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractPages, getPageCount, mergePdfs, PdfError, reorderPages, splitPdf } from '../src/core/pdfOps';

// Cada página recebe uma largura única para identificarmos a ordem depois.
async function makePdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 500]);
  return doc.save();
}

async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

describe('pdfOps', () => {
  it('conta páginas', async () => {
    expect(await getPageCount(await makePdf([100, 101, 102]))).toBe(3);
  });

  it('une na ordem informada, com seleção de páginas por arquivo', async () => {
    const a = await makePdf([100, 101, 102]);
    const b = await makePdf([200, 201]);
    const merged = await mergePdfs([
      { name: 'b.pdf', bytes: b },
      { name: 'a.pdf', bytes: a, pages: [2, 0] },
    ]);
    expect(await widthsOf(merged)).toEqual([200, 201, 102, 100]);
  });

  it('reordena páginas', async () => {
    const a = await makePdf([100, 101, 102, 103]);
    expect(await widthsOf(await reorderPages(a, [3, 1, 0, 2]))).toEqual([103, 101, 100, 102]);
  });

  it('reordenar exige todas as páginas uma vez', async () => {
    const a = await makePdf([100, 101, 102]);
    await expect(reorderPages(a, [0, 0, 1])).rejects.toThrow(PdfError);
    await expect(reorderPages(a, [0, 1])).rejects.toThrow(PdfError);
  });

  it('extrai páginas', async () => {
    const a = await makePdf([100, 101, 102, 103]);
    expect(await widthsOf(await extractPages(a, [1, 3]))).toEqual([101, 103]);
    await expect(extractPages(a, [9])).rejects.toThrow(/inválida/);
  });

  it('separa em grupos', async () => {
    const a = await makePdf([100, 101, 102, 103, 104]);
    const parts = await splitPdf(a, [[0, 1], [2], [3, 4]]);
    expect(parts).toHaveLength(3);
    expect(await widthsOf(parts[0])).toEqual([100, 101]);
    expect(await widthsOf(parts[1])).toEqual([102]);
    expect(await widthsOf(parts[2])).toEqual([103, 104]);
  });

  it('rejeita arquivo que não é PDF ou corrompido', async () => {
    await expect(getPageCount(new TextEncoder().encode('não sou pdf'), 'x.pdf')).rejects.toThrow(/não parece ser um PDF/);
    const ok = await makePdf([100, 101]);
    const broken = ok.slice(0, Math.floor(ok.length / 2));
    await expect(getPageCount(broken, 'quebrado.pdf')).rejects.toThrow(PdfError);
  });

  it('rejeita PDF criptografado com mensagem clara', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const plain = await doc.save({ useObjectStreams: false });
    // Injeta um /Encrypt no trailer para simular um PDF protegido.
    const text = Array.from(plain, (b) => String.fromCharCode(b)).join('');
    expect(text).toContain('trailer');
    const patched = text.replace(/trailer\s*<</, 'trailer\n<<\n/Encrypt 1 0 R');
    const enc = Uint8Array.from(patched, (c) => c.charCodeAt(0));
    await expect(getPageCount(enc, 'protegido.pdf')).rejects.toThrow(/protegido/);
  });
});

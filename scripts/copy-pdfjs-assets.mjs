// Copia fontes padrão e cMaps do pdf.js para public/pdfjs, para renderizar
// miniaturas corretamente sem internet.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pdfjsDir;
try {
  pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json'));
} catch {
  console.log('[copy-pdfjs-assets] pdfjs-dist ainda não instalado, pulando.');
  process.exit(0);
}

const dest = join(process.cwd(), 'public', 'pdfjs');
mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps']) {
  const src = join(pdfjsDir, dir);
  if (existsSync(src)) cpSync(src, join(dest, dir), { recursive: true });
}
console.log('[copy-pdfjs-assets] assets do pdf.js copiados para public/pdfjs');

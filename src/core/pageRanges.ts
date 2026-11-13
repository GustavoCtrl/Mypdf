// Interpretação de listas de páginas digitadas pelo usuário.
// Páginas são numeradas a partir de 1 na entrada e devolvidas a partir de 0.
//
// Exemplos aceitos (total = 10):
//   "1-3, 5"   -> [0,1,2,4]
//   "8-"       -> [7,8,9]          (até o fim)
//   "-3"       -> [0,1,2]          (do início)
//   "5-3"      -> [4,3,2]          (intervalo invertido)
//   "fim" / "última" -> última página

export class PageRangeError extends Error {}

const LAST_WORDS = new Set(['fim', 'final', 'ultima', 'última', 'end', 'last', 'n']);

function parseNumber(token: string, total: number): number {
  const t = token.trim().toLowerCase();
  if (LAST_WORDS.has(t)) return total;
  if (!/^\d+$/.test(t)) throw new PageRangeError(`"${token.trim()}" não é um número de página válido.`);
  const n = Number(t);
  if (n < 1 || n > total) {
    throw new PageRangeError(`A página ${n} não existe (o documento tem ${total} página${total === 1 ? '' : 's'}).`);
  }
  return n;
}

/** Converte um único item ("3", "2-5", "7-") em índices (base 0). */
function parseItem(item: string, total: number): number[] {
  const part = item.trim();
  if (!part) return [];
  const dash = part.indexOf('-');
  if (dash === -1) return [parseNumber(part, total) - 1];

  const left = part.slice(0, dash).trim();
  const right = part.slice(dash + 1).trim();
  if (right.includes('-')) throw new PageRangeError(`Intervalo inválido: "${part}".`);
  const start = left ? parseNumber(left, total) : 1;
  const end = right ? parseNumber(right, total) : total;
  const out: number[] = [];
  if (start <= end) for (let p = start; p <= end; p++) out.push(p - 1);
  else for (let p = start; p >= end; p--) out.push(p - 1);
  return out;
}

/**
 * Lista de páginas em sequência (pode repetir páginas).
 * Texto vazio ou "todas" significa todas as páginas.
 */
export function parsePageList(input: string, total: number): number[] {
  const text = input.trim().toLowerCase();
  if (!text || text === 'todas' || text === 'tudo' || text === 'all') {
    return Array.from({ length: total }, (_, i) => i);
  }
  const pages = normalizeSeparators(input).flatMap((item) => parseItem(item, total));
  if (pages.length === 0) throw new PageRangeError('Nenhuma página informada.');
  return pages;
}

/**
 * Grupos de páginas: cada item separado por vírgula vira um grupo (um arquivo).
 * "1-3, 4-6, 7" -> [[0,1,2],[3,4,5],[6]]
 */
export function parsePageGroups(input: string, total: number): number[][] {
  const groups = normalizeSeparators(input)
    .map((item) => parseItem(item, total))
    .filter((g) => g.length > 0);
  if (groups.length === 0) throw new PageRangeError('Informe ao menos um intervalo, por exemplo: 1-3, 4-6.');
  return groups;
}

/** Separa por vírgula, ponto e vírgula ou espaços (mantendo "2 - 5" como um intervalo). */
function normalizeSeparators(input: string): string[] {
  const compact = input.replace(/\s*-\s*/g, '-');
  return compact
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Divide o documento em blocos de N páginas. */
export function chunkPages(total: number, size: number): number[][] {
  if (!Number.isInteger(size) || size < 1) throw new PageRangeError('O tamanho do bloco deve ser um número inteiro maior que zero.');
  const out: number[][] = [];
  for (let i = 0; i < total; i += size) {
    out.push(Array.from({ length: Math.min(size, total - i) }, (_, k) => i + k));
  }
  return out;
}

/** Descreve índices (base 0) de forma compacta: [0,1,2,4] -> "1-3, 5". */
export function describePages(pages: number[]): string {
  if (pages.length === 0) return '';
  const parts: string[] = [];
  let start = pages[0];
  let prev = pages[0];
  const flush = () => parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
  for (let i = 1; i < pages.length; i++) {
    const p = pages[i];
    if (p === prev + 1) {
      prev = p;
    } else {
      flush();
      start = prev = p;
    }
  }
  flush();
  return parts.join(', ');
}

import { describe, expect, it } from 'vitest';
import { chunkPages, describePages, PageRangeError, parsePageGroups, parsePageList } from '../src/core/pageRanges';

describe('parsePageList', () => {
  it('vazio ou "todas" = todas as páginas', () => {
    expect(parsePageList('', 3)).toEqual([0, 1, 2]);
    expect(parsePageList('  Todas ', 2)).toEqual([0, 1]);
  });
  it('números e intervalos', () => {
    expect(parsePageList('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageList('3,1,2', 3)).toEqual([2, 0, 1]);
    expect(parsePageList('1 - 3; 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageList('2 4', 5)).toEqual([1, 3]);
  });
  it('intervalos abertos, invertidos e "fim"', () => {
    expect(parsePageList('8-', 10)).toEqual([7, 8, 9]);
    expect(parsePageList('-3', 10)).toEqual([0, 1, 2]);
    expect(parsePageList('5-3', 10)).toEqual([4, 3, 2]);
    expect(parsePageList('fim', 4)).toEqual([3]);
    expect(parsePageList('2-fim', 4)).toEqual([1, 2, 3]);
  });
  it('erros claros', () => {
    expect(() => parsePageList('11', 10)).toThrow(PageRangeError);
    expect(() => parsePageList('0', 10)).toThrow(/não existe/);
    expect(() => parsePageList('abc', 10)).toThrow(/não é um número/);
    expect(() => parsePageList('1-2-3', 10)).toThrow(/inválido/);
  });
});

describe('parsePageGroups', () => {
  it('cada item vira um grupo', () => {
    expect(parsePageGroups('1-3, 4-6, 7', 7)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  });
  it('vazio é erro', () => {
    expect(() => parsePageGroups('  ', 7)).toThrow(PageRangeError);
  });
});

describe('chunkPages / describePages', () => {
  it('divide em blocos', () => {
    expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(() => chunkPages(5, 0)).toThrow(PageRangeError);
  });
  it('descreve de forma compacta', () => {
    expect(describePages([0, 1, 2, 4, 6, 7])).toBe('1-3, 5, 7-8');
    expect(describePages([3])).toBe('4');
  });
});

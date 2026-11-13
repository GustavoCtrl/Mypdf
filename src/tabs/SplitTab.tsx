import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { Busy, DropZone, EmptyState, FileButton, Notice, PageThumb, type NoticeData } from '../components/common';
import { useSingleDoc } from '../components/hooks';
import { CONVERTIBLE_ACCEPT, plural, PDF_ACCEPT, stemOf } from '../core/files';
import { chunkPages, describePages, parsePageGroups, parsePageList } from '../core/pageRanges';
import { splitPdf } from '../core/pdfOps';
import { errorMessage, platform } from '../platform';

type Mode = 'selecionadas' | 'cada' | 'intervalos' | 'blocos';

interface Plan {
  groups: number[][];
  names: string[];
  error?: string;
}

const MODES: { id: Mode; title: string; hint: string }[] = [
  { id: 'selecionadas', title: 'Extrair páginas', hint: 'Clique nas páginas ou digite quais quer extrair.' },
  { id: 'cada', title: 'Uma página por arquivo', hint: 'Cada página vira um PDF separado.' },
  { id: 'intervalos', title: 'Por intervalos', hint: 'Cada intervalo vira um arquivo. Ex.: 1-3, 4-6, 7-fim' },
  { id: 'blocos', title: 'A cada N páginas', hint: 'Divide o documento em partes de tamanho fixo.' },
];

const slug = (desc: string) => desc.replace(/,\s*/g, '_');

export function SplitTab() {
  const { doc, renderDoc, busy: loading, error, setError, open, close } = useSingleDoc();
  const [mode, setMode] = useState<Mode>('selecionadas');
  const [selectionText, setSelectionText] = useState('');
  const [separate, setSeparate] = useState(false);
  const [rangesText, setRangesText] = useState('');
  const [chunk, setChunk] = useState('1');
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectionText('');
    setRangesText('');
    setChunk(doc && doc.pageCount > 1 ? String(Math.ceil(doc.pageCount / 2)) : '1');
    setNotice(null);
  }, [doc]);

  useEffect(() => {
    if (error) setNotice({ kind: 'error', text: error });
  }, [error]);

  // Páginas marcadas (derivadas do texto, que é a fonte da verdade).
  const selection = useMemo(() => {
    if (!doc || !selectionText.trim()) return { pages: [] as number[] };
    try {
      const pages = parsePageList(selectionText, doc.pageCount);
      return { pages: pages.filter((p, i) => pages.indexOf(p) === i) };
    } catch (e) {
      return { pages: [] as number[], error: errorMessage(e) };
    }
  }, [doc, selectionText]);
  const selectedSet = useMemo(() => new Set(selection.pages), [selection]);

  const plan = useMemo<Plan>(() => {
    if (!doc) return { groups: [], names: [] };
    const stem = stemOf(doc.name);
    const total = doc.pageCount;
    const pad = (n: number, max: number) => String(n).padStart(String(max).length, '0');
    try {
      if (mode === 'selecionadas') {
        if (selection.error) return { groups: [], names: [], error: selection.error };
        const pages = selection.pages;
        if (pages.length === 0) return { groups: [], names: [], error: 'Selecione ao menos uma página.' };
        if (separate) {
          return { groups: pages.map((p) => [p]), names: pages.map((p) => `${stem}-pagina-${pad(p + 1, total)}.pdf`) };
        }
        return { groups: [pages], names: [`${stem}-paginas-${slug(describePages(pages))}.pdf`] };
      }
      if (mode === 'cada') {
        const groups = Array.from({ length: total }, (_, i) => [i]);
        return { groups, names: groups.map(([p]) => `${stem}-pagina-${pad(p + 1, total)}.pdf`) };
      }
      const groups =
        mode === 'intervalos'
          ? rangesText.trim()
            ? parsePageGroups(rangesText, total)
            : []
          : chunkPages(total, Number(chunk));
      if (groups.length === 0) return { groups: [], names: [], error: 'Informe os intervalos, por exemplo: 1-3, 4-6.' };
      return {
        groups,
        names: groups.map((g, i) => `${stem}-parte-${pad(i + 1, groups.length)}-pag-${slug(describePages(g))}.pdf`),
      };
    } catch (e) {
      return { groups: [], names: [], error: errorMessage(e) };
    }
  }, [doc, mode, selection, separate, rangesText, chunk]);

  // Número do arquivo de saída de cada página (para os selos nas miniaturas).
  const groupOfPage = useMemo(() => {
    const m = new Map<number, number>();
    if (mode === 'intervalos' || mode === 'blocos') {
      plan.groups.forEach((g, i) => g.forEach((p) => m.has(p) || m.set(p, i + 1)));
    }
    return m;
  }, [plan, mode]);

  function togglePage(page: number) {
    if (mode !== 'selecionadas' || !doc) return;
    // Atualização funcional: cliques rápidos seguidos não se sobrescrevem.
    setSelectionText((prev) => {
      let current: number[] = [];
      try {
        current = prev.trim() ? parsePageList(prev, doc.pageCount) : [];
      } catch {
        /* texto inválido: recomeça a seleção pelo clique */
      }
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return describePages([...next].sort((a, b) => a - b));
    });
  }

  async function save() {
    if (!doc || plan.groups.length === 0) return;
    setNotice(null);
    setSaving(true);
    try {
      const parts = await splitPdf(doc.bytes, plan.groups, doc.name);
      setSaving(false);
      if (parts.length === 1) {
        const saved = await platform.saveFile(plan.names[0], parts[0]);
        if (saved) setNotice({ kind: 'success', text: `PDF salvo em ${saved}`, path: saved });
      } else {
        const res = await platform.saveFiles(parts.map((bytes, i) => ({ name: plan.names[i], bytes })));
        if (res) {
          setNotice({
            kind: 'success',
            text: `${plural(parts.length, 'arquivo salvo', 'arquivos salvos')} em ${res.folder}`,
            path: res.folder,
          });
        }
      }
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  const openButton = (primary: boolean) => (
    <FileButton accept={`${PDF_ACCEPT},${CONVERTIBLE_ACCEPT}`} onFiles={open} className={primary ? 'btn btn-primary' : 'btn'}>
      <Icon name="file" /> {primary ? 'Abrir PDF' : 'Abrir outro'}
    </FileButton>
  );

  const preview = plan.names.slice(0, 6);

  return (
    <DropZone onFiles={open} className="tab-body" label="Solte para abrir">
      <div className="tab-head">
        <div>
          <h2>Separar páginas</h2>
          <p className="muted">Extraia páginas ou divida o PDF em vários arquivos. O original não é alterado.</p>
        </div>
        {doc && (
          <div className="head-actions">
            {openButton(false)}
            <button type="button" className="btn btn-ghost" onClick={close}>
              <Icon name="x" size={16} /> Fechar
            </button>
          </div>
        )}
      </div>

      <Notice notice={notice} onClose={() => { setNotice(null); setError(null); }} />

      {!doc ? (
        <EmptyState
          icon="split"
          title="Abra o PDF que deseja separar"
          hint="Clique no botão abaixo ou arraste um arquivo para esta janela."
          action={openButton(true)}
        />
      ) : (
        <>
          <div className="doc-info">
            <Icon name="file" />
            <strong title={doc.name}>{doc.name}</strong>
            <span className="muted">· {plural(doc.pageCount, 'página', 'páginas')}</span>
          </div>

          <div className="mode-picker" role="radiogroup" aria-label="Como separar">
            {MODES.map((m) => (
              <label key={m.id} className={`mode ${mode === m.id ? 'is-active' : ''}`}>
                <input type="radio" name="split-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} />
                <strong>{m.title}</strong>
                <span>{m.hint}</span>
              </label>
            ))}
          </div>

          <div className="options-bar wrap">
            {mode === 'selecionadas' && (
              <>
                <label className="field inline grow">
                  <span>Páginas</span>
                  <input
                    value={selectionText}
                    onChange={(e) => setSelectionText(e.target.value)}
                    placeholder="ex.: 1-3, 5, 8-fim"
                    aria-invalid={Boolean(selection.error)}
                    spellCheck={false}
                  />
                </label>
                <label className="check">
                  <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
                  Salvar cada página em um arquivo separado
                </label>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setSelectionText(selection.pages.length ? '' : 'todas')}>
                  {selection.pages.length ? 'Desmarcar' : 'Selecionar todas'}
                </button>
              </>
            )}
            {mode === 'intervalos' && (
              <label className="field inline grow">
                <span>Intervalos</span>
                <input
                  value={rangesText}
                  onChange={(e) => setRangesText(e.target.value)}
                  placeholder="ex.: 1-3, 4-6, 7-fim"
                  spellCheck={false}
                  autoFocus
                />
              </label>
            )}
            {mode === 'blocos' && (
              <label className="field inline">
                <span>Páginas por arquivo</span>
                <input type="number" min={1} max={doc.pageCount} value={chunk} onChange={(e) => setChunk(e.target.value)} className="narrow" />
              </label>
            )}
            {mode === 'cada' && <span className="muted">Serão gerados {plural(doc.pageCount, 'arquivo', 'arquivos')}.</span>}
          </div>

          <div className="page-grid">
            {Array.from({ length: doc.pageCount }, (_, page) => {
              const isSel = mode === 'selecionadas' && selectedSet.has(page);
              const group = groupOfPage.get(page);
              return (
                <button
                  key={page}
                  type="button"
                  className={`page-card ${mode === 'selecionadas' ? 'selectable' : 'static'} ${isSel ? 'is-selected' : ''} ${group ? `group-tone-${(group - 1) % 4}` : ''}`}
                  onClick={() => togglePage(page)}
                  aria-pressed={mode === 'selecionadas' ? isSel : undefined}
                  tabIndex={mode === 'selecionadas' ? 0 : -1}
                >
                  <PageThumb doc={renderDoc} pageNumber={page + 1} />
                  <div className="page-label">
                    <span className="page-pos">{page + 1}</span>
                    {group && <span className="badge">arquivo {group}</span>}
                  </div>
                  {isSel && (
                    <span className="page-check" aria-hidden="true">
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="action-bar">
            <div className="summary">
              {plan.error ? (
                <span className={selection.error || mode !== 'selecionadas' ? 'text-error' : 'muted'}>{plan.error}</span>
              ) : (
                <>
                  <strong>{plural(plan.groups.length, 'arquivo será gerado', 'arquivos serão gerados')}</strong>
                  <span className="file-preview">
                    {preview.join(' · ')}
                    {plan.names.length > preview.length && ` · e mais ${plan.names.length - preview.length}`}
                  </span>
                </>
              )}
            </div>
            <button type="button" className="btn btn-primary btn-large" onClick={save} disabled={Boolean(plan.error) || saving}>
              <Icon name="split" /> {plan.groups.length > 1 ? 'Separar e salvar' : 'Extrair e salvar'}
            </button>
          </div>
        </>
      )}
      <Busy text={loading ?? (saving ? 'Gerando arquivos…' : null)} />
    </DropZone>
  );
}

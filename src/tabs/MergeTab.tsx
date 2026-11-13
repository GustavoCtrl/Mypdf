import { useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '../components/Icon';
import { Busy, DropZone, EmptyState, FileButton, Notice, type NoticeData } from '../components/common';
import { CONVERTIBLE_ACCEPT, isConvertibleName, loadAsPdf, plural, PDF_ACCEPT, uid, type LoadedPdf } from '../core/files';
import { parsePageList } from '../core/pageRanges';
import { mergePdfs } from '../core/pdfOps';
import { errorMessage, platform } from '../platform';

type Status = 'loading' | 'converting' | 'ready' | 'error';

interface MergeItem {
  id: string;
  /** Posição na sequência de seleção (ordem padrão). */
  seq: number;
  name: string;
  status: Status;
  bytes?: Uint8Array;
  pageCount?: number;
  pagesText: string;
  error?: string;
  convertedFrom?: string;
}

type OrderMode = 'selecao' | 'nome-az' | 'nome-za' | 'personalizada';

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });

function applyOrder(items: MergeItem[], mode: OrderMode): MergeItem[] {
  const copy = [...items];
  if (mode === 'selecao') copy.sort((a, b) => a.seq - b.seq);
  else if (mode === 'nome-az') copy.sort((a, b) => collator.compare(a.name, b.name) || a.seq - b.seq);
  else if (mode === 'nome-za') copy.sort((a, b) => collator.compare(b.name, a.name) || a.seq - b.seq);
  return copy;
}

interface PageParse {
  pages?: number[];
  error?: string;
}

interface Props {
  inbox: LoadedPdf[];
  onInboxConsumed: () => void;
}

export function MergeTab({ inbox, onInboxConsumed }: Props) {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [orderMode, setOrderMode] = useState<OrderMode>('selecao');
  const [outputName, setOutputName] = useState('documentos-unidos.pdf');
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seq = useRef(0);
  const orderModeRef = useRef(orderMode);
  orderModeRef.current = orderMode;

  const update = (id: string, patch: Partial<MergeItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const insert = (newItems: MergeItem[]) =>
    setItems((prev) => {
      const mode = orderModeRef.current;
      return mode === 'personalizada' ? [...prev, ...newItems] : applyOrder([...prev, ...newItems], mode);
    });

  async function addFiles(files: File[]) {
    setNotice(null);
    const pending = files.map<[File, MergeItem]>((file) => [
      file,
      {
        id: uid('m'),
        seq: seq.current++,
        name: file.name,
        status: isConvertibleName(file.name) ? 'converting' : 'loading',
        pagesText: '',
      },
    ]);
    insert(pending.map(([, item]) => item));
    // Processa na ordem de seleção; conversões rodam uma de cada vez.
    for (const [file, item] of pending) {
      try {
        const loaded = await loadAsPdf(file, platform);
        update(item.id, {
          status: 'ready',
          name: loaded.name,
          bytes: loaded.bytes,
          pageCount: loaded.pageCount,
          convertedFrom: loaded.convertedFrom,
        });
      } catch (e) {
        update(item.id, { status: 'error', error: errorMessage(e) });
      }
    }
  }

  // PDFs convertidos na aba "Converter" e enviados para cá.
  useEffect(() => {
    if (inbox.length === 0) return;
    insert(
      inbox.map((pdf) => ({
        id: uid('m'),
        seq: seq.current++,
        name: pdf.name,
        status: 'ready' as const,
        bytes: pdf.bytes,
        pageCount: pdf.pageCount,
        convertedFrom: pdf.convertedFrom,
        pagesText: '',
      })),
    );
    onInboxConsumed();
  }, [inbox, onInboxConsumed]);

  const parsed = useMemo(() => {
    const map = new Map<string, PageParse>();
    for (const it of items) {
      if (it.status !== 'ready' || !it.pageCount) continue;
      try {
        map.set(it.id, { pages: parsePageList(it.pagesText, it.pageCount) });
      } catch (e) {
        map.set(it.id, { error: errorMessage(e) });
      }
    }
    return map;
  }, [items]);

  const ready = items.filter((i) => i.status === 'ready');
  const failed = items.filter((i) => i.status === 'error');
  const working = items.some((i) => i.status === 'loading' || i.status === 'converting');
  const hasPageErrors = ready.some((i) => parsed.get(i.id)?.error);
  const totalPages = ready.reduce((sum, i) => sum + (parsed.get(i.id)?.pages?.length ?? 0), 0);
  const canMerge = ready.length >= 2 && !working && !hasPageErrors && !busy;

  function changeOrder(mode: OrderMode) {
    setOrderMode(mode);
    if (mode !== 'personalizada') setItems((prev) => applyOrder(prev, mode));
  }

  function move(index: number, delta: number) {
    setItems((prev) => {
      const to = index + delta;
      if (to < 0 || to >= prev.length) return prev;
      return arrayMove(prev, index, to);
    });
    setOrderMode('personalizada');
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function reverse() {
    setItems((prev) => [...prev].reverse());
    setOrderMode('personalizada');
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === active.id);
      const to = prev.findIndex((i) => i.id === over.id);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
    setOrderMode('personalizada');
  }

  async function merge() {
    setNotice(null);
    setBusy('Unindo PDFs…');
    try {
      const inputs = ready.map((i) => ({ name: i.name, bytes: i.bytes!, pages: parsed.get(i.id)?.pages }));
      const out = await mergePdfs(inputs);
      const name = /\.pdf$/i.test(outputName.trim()) ? outputName.trim() : `${outputName.trim() || 'documentos-unidos'}.pdf`;
      setBusy(null);
      const saved = await platform.saveFile(name, out);
      if (saved) {
        setNotice({
          kind: 'success',
          text: `PDF unido com ${plural(totalPages, 'página', 'páginas')} salvo em ${saved}`,
          path: saved,
        });
      }
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  const accept = `${PDF_ACCEPT},${CONVERTIBLE_ACCEPT}`;
  const addButton = (primary: boolean) => (
    <FileButton accept={accept} multiple onFiles={addFiles} className={primary ? 'btn btn-primary' : 'btn'}>
      <Icon name="plus" /> {primary ? 'Selecionar arquivos' : 'Adicionar arquivos'}
    </FileButton>
  );

  return (
    <DropZone onFiles={addFiles} className="tab-body" label="Solte para adicionar à união">
      <div className="tab-head">
        <div>
          <h2>Unir PDFs</h2>
          <p className="muted">
            Os arquivos entram na ordem em que você os seleciona. Arraste ou use as setas para mudar a ordem.
          </p>
        </div>
        {items.length > 0 && <div className="head-actions">{addButton(false)}</div>}
      </div>

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {items.length === 0 ? (
        <EmptyState
          icon="merge"
          title="Selecione os arquivos que deseja unir"
          hint={
            <>
              PDFs{platform.isDesktop ? ', documentos .doc/.docx e apresentações .ppt/.pptx (convertidos automaticamente)' : ''}.
              Você também pode arrastá-los para esta janela.
            </>
          }
          action={addButton(true)}
        />
      ) : (
        <>
          <div className="options-bar">
            <label className="field inline">
              <span>
                <Icon name="sort" size={16} /> Ordem
              </span>
              <select value={orderMode} onChange={(e) => changeOrder(e.target.value as OrderMode)}>
                <option value="selecao">Ordem de seleção (padrão)</option>
                <option value="nome-az">Nome (A → Z)</option>
                <option value="nome-za">Nome (Z → A)</option>
                <option value="personalizada" disabled={orderMode !== 'personalizada'}>
                  Personalizada
                </option>
              </select>
            </label>
            <button type="button" className="btn btn-ghost" onClick={reverse} disabled={items.length < 2}>
              <Icon name="reverse" size={16} /> Inverter ordem
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setItems([])}>
              <Icon name="trash" size={16} /> Limpar lista
            </button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <ol className="file-list">
                {items.map((item, index) => (
                  <MergeRow
                    key={item.id}
                    item={item}
                    index={index}
                    last={index === items.length - 1}
                    parse={parsed.get(item.id)}
                    onMove={(d) => move(index, d)}
                    onRemove={() => remove(item.id)}
                    onPages={(text) => update(item.id, { pagesText: text })}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </>
      )}

      {items.length > 0 && (
        <div className="action-bar">
          <div className="summary">
            <strong>{plural(ready.length, 'arquivo', 'arquivos')}</strong> · {plural(totalPages, 'página', 'páginas')} no total
            {failed.length > 0 && <span className="text-error"> · {failed.length} com erro (serão ignorados)</span>}
            {ready.length < 2 && !working && <span className="muted"> · adicione ao menos 2 arquivos</span>}
          </div>
          <label className="field inline output-name">
            <span>Nome do arquivo</span>
            <input value={outputName} onChange={(e) => setOutputName(e.target.value)} spellCheck={false} />
          </label>
          <button type="button" className="btn btn-primary btn-large" onClick={merge} disabled={!canMerge}>
            <Icon name="merge" /> Unir e salvar
          </button>
        </div>
      )}
      <Busy text={busy} />
    </DropZone>
  );
}

function MergeRow({
  item,
  index,
  last,
  parse,
  onMove,
  onRemove,
  onPages,
}: {
  item: MergeItem;
  index: number;
  last: boolean;
  parse?: PageParse;
  onMove: (delta: number) => void;
  onRemove: () => void;
  onPages: (text: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  let meta: React.ReactNode;
  if (item.status === 'loading') meta = 'Lendo…';
  else if (item.status === 'converting') meta = 'Convertendo com o LibreOffice…';
  else if (item.status === 'error') meta = <span className="text-error">{item.error}</span>;
  else
    meta = (
      <>
        {plural(item.pageCount ?? 0, 'página', 'páginas')}
        {item.convertedFrom && <span className="badge">convertido de {item.convertedFrom}</span>}
      </>
    );

  return (
    <li ref={setNodeRef} style={style} className={`file-row ${isDragging ? 'is-dragging' : ''} ${item.status === 'error' ? 'is-error' : ''}`}>
      <button type="button" className="grip" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Arrastar ${item.name}`}>
        <Icon name="grip" />
      </button>
      <span className="row-index">{index + 1}</span>
      <div className="row-main">
        <div className="row-title" title={item.name}>
          {(item.status === 'loading' || item.status === 'converting') && <span className="spinner small" />}
          {item.name}
        </div>
        <div className="row-meta">{meta}</div>
      </div>
      {item.status === 'ready' && (
        <label className="row-pages">
          <span>Páginas</span>
          <input
            value={item.pagesText}
            placeholder="todas"
            onChange={(e) => onPages(e.target.value)}
            aria-invalid={Boolean(parse?.error)}
            title="Ex.: 1-3, 5, 8-fim. Deixe vazio para usar todas."
            spellCheck={false}
          />
          {parse?.error && <small className="field-error">{parse.error}</small>}
        </label>
      )}
      <div className="row-actions">
        <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Mover para cima">
          <Icon name="up" />
        </button>
        <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={last} aria-label="Mover para baixo">
          <Icon name="down" />
        </button>
        <button type="button" className="icon-btn danger" onClick={onRemove} aria-label={`Remover ${item.name}`}>
          <Icon name="trash" />
        </button>
      </div>
    </li>
  );
}

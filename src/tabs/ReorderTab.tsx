import { useEffect, useRef, useState } from 'react';
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
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from '../components/Icon';
import { Busy, DropZone, EmptyState, FileButton, Notice, PageThumb, type NoticeData } from '../components/common';
import { useSingleDoc } from '../components/hooks';
import { CONVERTIBLE_ACCEPT, plural, PDF_ACCEPT, stemOf } from '../core/files';
import { parsePageList } from '../core/pageRanges';
import { reorderPages } from '../core/pdfOps';
import type { RenderDoc } from '../core/pdfRender';
import { errorMessage, platform } from '../platform';

const identity = (n: number) => Array.from({ length: n }, (_, i) => i);
const idOf = (page: number) => `p-${page}`;
const pageOf = (id: string | number) => Number(String(id).slice(2));

export function ReorderTab() {
  const { doc, renderDoc, busy: loading, error, setError, open, close } = useSingleDoc();
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState('');
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [saving, setSaving] = useState(false);
  const justDragged = useRef(false);

  useEffect(() => {
    setOrder(doc ? identity(doc.pageCount) : []);
    setSelected(new Set());
    setManual('');
    setNotice(null);
  }, [doc]);

  useEffect(() => {
    if (error) setNotice({ kind: 'error', text: error });
  }, [error]);

  const changed = order.some((p, i) => p !== i);
  const selCount = selected.size;

  function toggle(page: number) {
    if (justDragged.current) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }

  function moveToEdge(toStart: boolean) {
    const sel = order.filter((p) => selected.has(p));
    const rest = order.filter((p) => !selected.has(p));
    setOrder(toStart ? [...sel, ...rest] : [...rest, ...sel]);
  }

  function step(delta: -1 | 1) {
    const arr = [...order];
    if (delta === -1) {
      for (let i = 1; i < arr.length; i++) {
        if (selected.has(arr[i]) && !selected.has(arr[i - 1])) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      }
    } else {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (selected.has(arr[i]) && !selected.has(arr[i + 1])) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
      }
    }
    setOrder(arr);
  }

  function applyManual() {
    if (!doc) return;
    try {
      const pages = parsePageList(manual, doc.pageCount);
      const seen = new Set<number>();
      for (const p of pages) {
        if (seen.has(p)) throw new Error(`A página ${p + 1} aparece mais de uma vez.`);
        seen.add(p);
      }
      const missing = order.filter((p) => !seen.has(p));
      setOrder([...pages, ...missing]);
      setNotice(
        missing.length
          ? { kind: 'info', text: `Ordem aplicada. ${plural(missing.length, 'página não informada foi mantida', 'páginas não informadas foram mantidas')} no fim, na ordem atual.` }
          : { kind: 'success', text: 'Ordem aplicada.' },
      );
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) });
    }
  }

  async function save() {
    if (!doc) return;
    setNotice(null);
    setSaving(true);
    try {
      const out = await reorderPages(doc.bytes, order, doc.name);
      setSaving(false);
      const saved = await platform.saveFile(`${stemOf(doc.name)}-reordenado.pdf`, out);
      if (saved) setNotice({ kind: 'success', text: `PDF reordenado salvo em ${saved}`, path: saved });
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    // Espaço arrasta (setas movem, Espaço solta); Enter seleciona.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  function onDragEnd(e: DragEndEvent) {
    // Evita que o "clique" ao soltar a página também a selecione.
    setTimeout(() => (justDragged.current = false), 0);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setOrder((prev) => arrayMove(prev, prev.indexOf(pageOf(active.id)), prev.indexOf(pageOf(over.id))));
  }

  const openButton = (primary: boolean) => (
    <FileButton accept={`${PDF_ACCEPT},${CONVERTIBLE_ACCEPT}`} onFiles={open} className={primary ? 'btn btn-primary' : 'btn'}>
      <Icon name="file" /> {primary ? 'Abrir PDF' : 'Abrir outro'}
    </FileButton>
  );

  return (
    <DropZone onFiles={open} className="tab-body" label="Solte para abrir">
      <div className="tab-head">
        <div>
          <h2>Reordenar páginas</h2>
          <p className="muted">Arraste as páginas para a posição desejada ou selecione várias e use os botões.</p>
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
          icon="reorder"
          title="Abra o PDF que deseja reorganizar"
          hint="Clique no botão abaixo ou arraste um arquivo para esta janela."
          action={openButton(true)}
        />
      ) : (
        <>
          <div className="doc-info">
            <Icon name="file" />
            <strong title={doc.name}>{doc.name}</strong>
            <span className="muted">· {plural(doc.pageCount, 'página', 'páginas')}</span>
            {changed && <span className="badge badge-accent">ordem alterada</span>}
          </div>

          <div className="options-bar wrap">
            <div className="btn-group" role="group" aria-label="Mover páginas selecionadas">
              <span className="group-label">{selCount ? `${selCount} selecionada${selCount > 1 ? 's' : ''}` : 'Selecione páginas'}</span>
              <button type="button" className="icon-btn" onClick={() => moveToEdge(true)} disabled={!selCount} title="Mover para o início" aria-label="Mover para o início">
                <Icon name="first" />
              </button>
              <button type="button" className="icon-btn" onClick={() => step(-1)} disabled={!selCount} title="Mover uma posição para trás" aria-label="Mover para trás">
                <Icon name="left" />
              </button>
              <button type="button" className="icon-btn" onClick={() => step(1)} disabled={!selCount} title="Mover uma posição para frente" aria-label="Mover para frente">
                <Icon name="right" />
              </button>
              <button type="button" className="icon-btn" onClick={() => moveToEdge(false)} disabled={!selCount} title="Mover para o fim" aria-label="Mover para o fim">
                <Icon name="last" />
              </button>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => setSelected(selCount ? new Set() : new Set(order))}>
                {selCount ? 'Desmarcar' : 'Selecionar todas'}
              </button>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => setOrder([...order].reverse())}>
              <Icon name="reverse" size={16} /> Inverter ordem
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOrder(identity(doc.pageCount))} disabled={!changed}>
              <Icon name="undo" size={16} /> Restaurar original
            </button>
            <form
              className="manual-order"
              onSubmit={(e) => {
                e.preventDefault();
                applyManual();
              }}
            >
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Digitar ordem, ex.: 3, 1, 2, 4-fim"
                aria-label="Nova ordem das páginas"
                spellCheck={false}
              />
              <button type="submit" className="btn btn-small" disabled={!manual.trim()}>
                Aplicar
              </button>
            </form>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => (justDragged.current = true)}
            onDragCancel={() => (justDragged.current = false)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={order.map(idOf)} strategy={rectSortingStrategy}>
              <div className="page-grid">
                {order.map((page, position) => (
                  <SortablePage
                    key={page}
                    page={page}
                    position={position}
                    selected={selected.has(page)}
                    moved={page !== position}
                    renderDoc={renderDoc}
                    onToggle={() => toggle(page)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <div className="action-bar">
            <div className="summary muted">
              {changed ? 'A nova ordem será salva como um novo arquivo; o original não é alterado.' : 'Nenhuma alteração ainda.'}
            </div>
            <button type="button" className="btn btn-primary btn-large" onClick={save} disabled={!changed || saving}>
              <Icon name="save" /> Salvar PDF reordenado
            </button>
          </div>
        </>
      )}
      <Busy text={loading ?? (saving ? 'Gerando PDF…' : null)} />
    </DropZone>
  );
}

function SortablePage({
  page,
  position,
  selected,
  moved,
  renderDoc,
  onToggle,
}: {
  page: number;
  position: number;
  selected: boolean;
  moved: boolean;
  renderDoc: RenderDoc | null;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: idOf(page) });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`page-card sortable ${selected ? 'is-selected' : ''} ${isDragging ? 'is-dragging' : ''}`}
      {...attributes}
      {...listeners}
      aria-pressed={selected}
      aria-label={`Posição ${position + 1}, página original ${page + 1}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter') onToggle();
      }}
    >
      <PageThumb doc={renderDoc} pageNumber={page + 1} />
      <div className="page-label">
        <span className="page-pos">{position + 1}</span>
        {moved && <span className="page-orig">era {page + 1}</span>}
      </div>
      {selected && (
        <span className="page-check" aria-hidden="true">
          <Icon name="check" size={14} />
        </span>
      )}
    </div>
  );
}

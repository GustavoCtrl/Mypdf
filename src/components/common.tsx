// Componentes de interface reutilizados pelas telas.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { platform } from '../platform';
import { renderThumbnail, type RenderDoc } from '../core/pdfRender';

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------
export interface NoticeData {
  kind: 'info' | 'success' | 'error';
  text: string;
  /** Caminho salvo (para o botão "Mostrar na pasta"). */
  path?: string | null;
}

export function Notice({ notice, onClose }: { notice: NoticeData | null; onClose: () => void }) {
  if (!notice) return null;
  const icon: IconName = notice.kind === 'success' ? 'check' : notice.kind === 'error' ? 'alert' : 'info';
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <span className="notice-text">{notice.text}</span>
      {notice.path && platform.isDesktop && (
        <button type="button" className="btn btn-small btn-ghost" onClick={() => platform.showInFolder(notice.path!)}>
          <Icon name="folder" size={16} /> Mostrar na pasta
        </button>
      )}
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar aviso">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seleção de arquivos
// ---------------------------------------------------------------------------
interface FileButtonProps {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

export function FileButton({ accept, multiple, onFiles, children, className = 'btn', disabled }: FileButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()} disabled={disabled}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/** Área que aceita arquivos arrastados do sistema. */
export function DropZone({
  onFiles,
  children,
  className = '',
  label = 'Solte os arquivos aqui',
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${className}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="plus" size={28} />
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: IconName;
  title: string;
  hint: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      <p>{hint}</p>
      {action}
    </div>
  );
}

export function Busy({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="busy" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Miniatura de página (renderizada só quando aparece na tela)
// ---------------------------------------------------------------------------
export function PageThumb({ doc, pageNumber }: { doc: RenderDoc | null; pageNumber: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumb, setThumb] = useState<{ url: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !doc) return;
    let cancelled = false;
    let url: string | null = null;
    setFailed(false);
    renderThumbnail(doc, pageNumber)
      .then((t) => {
        if (cancelled) {
          URL.revokeObjectURL(t.url);
          return;
        }
        url = t.url;
        setThumb({ url: t.url });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setThumb(null);
    };
  }, [visible, doc, pageNumber]);

  return (
    <div className="thumb" ref={ref}>
      {thumb ? (
        <img src={thumb.url} alt={`Página ${pageNumber}`} draggable={false} />
      ) : (
        <div className="thumb-placeholder">{failed ? <Icon name="alert" /> : <span className="spinner small" />}</div>
      )}
    </div>
  );
}

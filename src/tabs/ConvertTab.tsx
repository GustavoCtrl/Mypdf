import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Busy, DropZone, EmptyState, FileButton, Notice, type NoticeData } from '../components/common';
import { CONVERTIBLE_ACCEPT, CONVERTIBLE_EXTS, formatBytes, isConvertibleName, plural, readBytes, stemOf, uid, type LoadedPdf } from '../core/files';
import { getPageCount } from '../core/pdfOps';
import { errorMessage, platform, type ConverterStatus } from '../platform';

type Status = 'pendente' | 'convertendo' | 'pronto' | 'erro';

interface ConvItem {
  id: string;
  file: File;
  status: Status;
  pdf?: LoadedPdf;
  error?: string;
}

interface Props {
  onSendToMerge: (files: LoadedPdf[]) => void;
}

export function ConvertTab({ onSendToMerge }: Props) {
  const [status, setStatus] = useState<ConverterStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [items, setItems] = useState<ConvItem[]>([]);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [saving, setSaving] = useState(false);
  // A lista vive no ref (fonte da verdade para a fila) e é espelhada no estado.
  const itemsRef = useRef<ConvItem[]>([]);
  const running = useRef(false);
  const commit = (next: ConvItem[]) => {
    itemsRef.current = next;
    setItems(next);
  };
  const update = (id: string, patch: Partial<ConvItem>) =>
    commit(itemsRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const refresh = useCallback(async (pick = false) => {
    setChecking(true);
    try {
      setStatus(pick ? await platform.pickConverter() : await platform.converterStatus());
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Converte os itens pendentes, um por vez, na ordem da lista.
  const runQueue = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === 'pendente');
        if (!next) break;
        update(next.id, { status: 'convertendo' });
        try {
          const bytes = await platform.convertToPdf(next.file.name, await readBytes(next.file));
          const name = `${stemOf(next.file.name)}.pdf`;
          const pageCount = await getPageCount(bytes, name);
          update(next.id, { status: 'pronto', pdf: { name, bytes, pageCount, convertedFrom: next.file.name } });
        } catch (e) {
          update(next.id, { status: 'erro', error: errorMessage(e) });
        }
      }
    } finally {
      running.current = false;
    }
  }, []);

  function addFiles(files: File[]) {
    setNotice(null);
    const ok = files.filter((f) => isConvertibleName(f.name));
    const rejected = files.filter((f) => !isConvertibleName(f.name));
    if (rejected.length) {
      setNotice({
        kind: 'error',
        text: `Ignorado${rejected.length > 1 ? 's' : ''}: ${rejected.map((f) => f.name).join(', ')}. Formatos aceitos: ${CONVERTIBLE_EXTS.join(' ')}`,
      });
    }
    if (!ok.length) return;
    const added = ok.map<ConvItem>((file) => ({ id: uid('c'), file, status: 'pendente' }));
    commit([...itemsRef.current, ...added]);
    if (status?.available) void runQueue();
  }

  // Ao encontrar o LibreOffice (ex.: após instalar), converte o que estava esperando.
  useEffect(() => {
    if (status?.available && itemsRef.current.some((i) => i.status === 'pendente')) void runQueue();
  }, [status, runQueue]);

  const done = items.filter((i) => i.status === 'pronto' && i.pdf);
  const pending = items.filter((i) => i.status === 'pendente');
  const working = items.some((i) => i.status === 'convertendo');

  async function saveAll() {
    setNotice(null);
    setSaving(true);
    try {
      const files = done.map((i) => ({ name: i.pdf!.name, bytes: i.pdf!.bytes }));
      if (files.length === 1) {
        const saved = await platform.saveFile(files[0].name, files[0].bytes);
        if (saved) setNotice({ kind: 'success', text: `PDF salvo em ${saved}`, path: saved });
      } else {
        const res = await platform.saveFiles(files);
        if (res) setNotice({ kind: 'success', text: `${plural(files.length, 'PDF salvo', 'PDFs salvos')} em ${res.folder}`, path: res.folder });
      }
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function saveOne(item: ConvItem) {
    if (!item.pdf) return;
    try {
      const saved = await platform.saveFile(item.pdf.name, item.pdf.bytes);
      if (saved) setNotice({ kind: 'success', text: `PDF salvo em ${saved}`, path: saved });
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) });
    }
  }

  const addButton = (primary: boolean) => (
    <FileButton accept={CONVERTIBLE_ACCEPT} multiple onFiles={addFiles} className={primary ? 'btn btn-primary' : 'btn'} disabled={!status?.available && !platform.isDesktop}>
      <Icon name="plus" /> {primary ? 'Selecionar documentos' : 'Adicionar documentos'}
    </FileButton>
  );

  return (
    <DropZone onFiles={addFiles} className="tab-body" label="Solte para converter">
      <div className="tab-head">
        <div>
          <h2>Converter para PDF</h2>
          <p className="muted">Word (.doc, .docx), PowerPoint (.ppt, .pptx) e LibreOffice (.odt, .odp), sem internet.</p>
        </div>
        {items.length > 0 && <div className="head-actions">{addButton(false)}</div>}
      </div>

      <ConverterCard status={status} checking={checking} onRefresh={() => refresh()} onPick={() => refresh(true)} />

      <Notice notice={notice} onClose={() => setNotice(null)} />

      {items.length === 0 ? (
        <EmptyState
          icon="convert"
          title="Selecione os documentos para converter"
          hint="Você pode selecionar vários de uma vez ou arrastá-los para esta janela."
          action={addButton(true)}
        />
      ) : (
        <ol className="file-list">
          {items.map((item, index) => (
            <li key={item.id} className={`file-row ${item.status === 'erro' ? 'is-error' : ''}`}>
              <span className="row-index">{index + 1}</span>
              <div className="row-main">
                <div className="row-title" title={item.file.name}>
                  {item.status === 'convertendo' && <span className="spinner small" />}
                  {item.status === 'pronto' && <Icon name="check" className="text-success" />}
                  {item.file.name}
                </div>
                <div className="row-meta">
                  {item.status === 'pendente' && (status?.available ? 'Na fila…' : 'Aguardando o LibreOffice')}
                  {item.status === 'convertendo' && 'Convertendo…'}
                  {item.status === 'pronto' && item.pdf && `${item.pdf.name} · ${plural(item.pdf.pageCount, 'página', 'páginas')} · ${formatBytes(item.pdf.bytes.length)}`}
                  {item.status === 'erro' && <span className="text-error">{item.error}</span>}
                </div>
              </div>
              <div className="row-actions">
                {item.status === 'pronto' && (
                  <button type="button" className="btn btn-small" onClick={() => saveOne(item)}>
                    <Icon name="save" size={16} /> Salvar
                  </button>
                )}
                {item.status === 'erro' && (
                  <button type="button" className="btn btn-small btn-ghost" onClick={() => {
                      update(item.id, { status: 'pendente', error: undefined });
                      void runQueue();
                    }}>
                    Tentar de novo
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn danger"
                  disabled={item.status === 'convertendo'}
                  onClick={() => commit(itemsRef.current.filter((i) => i.id !== item.id))}
                  aria-label={`Remover ${item.file.name}`}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {items.length > 0 && (
        <div className="action-bar">
          <div className="summary">
            <strong>{plural(done.length, 'convertido', 'convertidos')}</strong> de {items.length}
            {working && <span className="muted"> · convertendo…</span>}
            {pending.length > 0 && status?.available && !working && (
              <button type="button" className="btn btn-small btn-ghost" onClick={() => void runQueue()}>
                Converter pendentes
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn"
            disabled={done.length === 0}
            onClick={() => {
              onSendToMerge(done.map((i) => i.pdf!));
            }}
            title="Abre a aba Unir PDFs com estes arquivos"
          >
            <Icon name="send" /> Enviar para "Unir"
          </button>
          <button type="button" className="btn btn-primary btn-large" onClick={saveAll} disabled={done.length === 0 || saving}>
            <Icon name="save" /> {done.length > 1 ? 'Salvar todos' : 'Salvar PDF'}
          </button>
        </div>
      )}
      <Busy text={saving ? 'Salvando…' : null} />
    </DropZone>
  );
}

function ConverterCard({
  status,
  checking,
  onRefresh,
  onPick,
}: {
  status: ConverterStatus | null;
  checking: boolean;
  onRefresh: () => void;
  onPick: () => void;
}) {
  if (!status) return null;

  if (status.available) {
    const where = status.kind === 'snap' ? ' (snap)' : status.kind === 'flatpak' ? ' (flatpak)' : '';
    return (
      <div className="status-card ok">
        <Icon name="check" />
        <div>
          <strong>LibreOffice encontrado{where}</strong>
          <span className="muted mono">{status.path}</span>
        </div>
        <button type="button" className="btn btn-small btn-ghost" onClick={onPick}>
          Alterar…
        </button>
      </div>
    );
  }

  if (status.unsupportedReason) {
    return (
      <div className="status-card warn">
        <Icon name="info" />
        <div>
          <strong>Conversão indisponível nesta versão</strong>
          <span>{status.unsupportedReason}</span>
        </div>
      </div>
    );
  }

  const isWin = status.platform === 'win32';
  return (
    <div className="status-card warn">
      <Icon name="alert" />
      <div className="grow">
        <strong>É preciso instalar o LibreOffice (gratuito e livre) para converter documentos</strong>
        {isWin ? (
          <ol className="steps">
            <li>
              Baixe o instalador em <span className="mono">libreoffice.org</span> e instale normalmente.
            </li>
            <li>Volte aqui e clique em "Verificar novamente".</li>
          </ol>
        ) : (
          <ol className="steps">
            <li>
              No Ubuntu, abra o Terminal e execute:
              <code className="cmd">sudo apt install libreoffice-writer libreoffice-impress</code>
            </li>
            <li>Ou instale o "LibreOffice" pela Central de Aplicativos (snap) e clique em "Verificar novamente".</li>
          </ol>
        )}
        <div className="status-actions">
          <button type="button" className="btn btn-small" onClick={onRefresh} disabled={checking}>
            Verificar novamente
          </button>
          {isWin && (
            <button type="button" className="btn btn-small btn-ghost" onClick={() => platform.openDownloadPage()}>
              Abrir site do LibreOffice
            </button>
          )}
          <button type="button" className="btn btn-small btn-ghost" onClick={onPick}>
            Localizar manualmente…
          </button>
        </div>
      </div>
      <Busy text={checking ? 'Procurando…' : null} />
    </div>
  );
}

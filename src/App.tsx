import { useCallback, useState } from 'react';
import { Icon, Logo, type IconName } from './components/Icon';
import type { LoadedPdf } from './core/files';
import { ConvertTab } from './tabs/ConvertTab';
import { MergeTab } from './tabs/MergeTab';
import { ReorderTab } from './tabs/ReorderTab';
import { SplitTab } from './tabs/SplitTab';

type TabId = 'unir' | 'reordenar' | 'separar' | 'converter';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'unir', label: 'Unir PDFs', icon: 'merge' },
  { id: 'reordenar', label: 'Reordenar páginas', icon: 'reorder' },
  { id: 'separar', label: 'Separar páginas', icon: 'split' },
  { id: 'converter', label: 'Converter para PDF', icon: 'convert' },
];

export function App() {
  const [tab, setTab] = useState<TabId>('unir');
  const [mergeInbox, setMergeInbox] = useState<LoadedPdf[]>([]);

  const sendToMerge = useCallback((files: LoadedPdf[]) => {
    setMergeInbox(files);
    setTab('unir');
  }, []);
  const clearInbox = useCallback(() => setMergeInbox([]), []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span>MyPDF</span>
        </div>
        <nav className="tabs" role="tablist" aria-label="Ferramentas">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* As abas ficam montadas para não perder o trabalho ao alternar. */}
      <main className="content">
        <section role="tabpanel" id="panel-unir" aria-labelledby="tab-unir" hidden={tab !== 'unir'}>
          <MergeTab inbox={mergeInbox} onInboxConsumed={clearInbox} />
        </section>
        <section role="tabpanel" id="panel-reordenar" aria-labelledby="tab-reordenar" hidden={tab !== 'reordenar'}>
          <ReorderTab />
        </section>
        <section role="tabpanel" id="panel-separar" aria-labelledby="tab-separar" hidden={tab !== 'separar'}>
          <SplitTab />
        </section>
        <section role="tabpanel" id="panel-converter" aria-labelledby="tab-converter" hidden={tab !== 'converter'}>
          <ConvertTab onSendToMerge={sendToMerge} />
        </section>
      </main>
    </div>
  );
}

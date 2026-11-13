import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Arquivos soltos fora de uma área de soltar não devem abrir/navegar a janela.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

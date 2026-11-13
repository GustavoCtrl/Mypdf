// Camada de plataforma: isola o que depende do sistema (salvar arquivos,
// converter documentos). No desktop usa o Electron; no navegador/celular
// usa um fallback (downloads), permitindo reaproveitar toda a interface.

export interface ConverterStatus {
  available: boolean;
  path?: string;
  custom?: boolean;
  kind?: 'native' | 'snap' | 'flatpak';
  platform?: string;
  /** Explicação quando a conversão não é possível nesta plataforma. */
  unsupportedReason?: string;
}

export interface SaveManyResult {
  folder: string;
  firstFile: string | null;
}

export interface NamedBytes {
  name: string;
  bytes: Uint8Array;
}

interface NativeApi {
  platform: string;
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
  saveFiles(files: NamedBytes[]): Promise<SaveManyResult | null>;
  showInFolder(path: string): Promise<void>;
  converterStatus(): Promise<ConverterStatus>;
  pickConverter(): Promise<ConverterStatus>;
  openDownloadPage(): Promise<void>;
  convertToPdf(name: string, bytes: Uint8Array): Promise<Uint8Array>;
}

declare global {
  interface Window {
    mypdfNative?: NativeApi;
  }
}

export interface Platform {
  isDesktop: boolean;
  os: string;
  /** Salva um arquivo. Devolve o caminho salvo (ou null se cancelado). */
  saveFile(name: string, bytes: Uint8Array): Promise<string | null>;
  /** Salva vários arquivos numa pasta escolhida. */
  saveFiles(files: NamedBytes[]): Promise<SaveManyResult | null>;
  showInFolder(path: string): void;
  converterStatus(): Promise<ConverterStatus>;
  pickConverter(): Promise<ConverterStatus>;
  openDownloadPage(): void;
  convertToPdf(name: string, bytes: Uint8Array): Promise<Uint8Array>;
}

/** Limpa o prefixo técnico que o Electron adiciona em erros de IPC. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(Error|PdfError|PageRangeError):\s*/, '');
}

function createDesktopPlatform(api: NativeApi): Platform {
  return {
    isDesktop: true,
    os: api.platform,
    saveFile: (name, bytes) => api.saveFile(name, bytes),
    saveFiles: (files) => api.saveFiles(files),
    showInFolder: (p) => void api.showInFolder(p),
    converterStatus: () => api.converterStatus(),
    pickConverter: () => api.pickConverter(),
    openDownloadPage: () => void api.openDownloadPage(),
    convertToPdf: (name, bytes) => api.convertToPdf(name, bytes),
  };
}

function download(name: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function createWebPlatform(): Platform {
  const reason =
    'A conversão de documentos precisa do LibreOffice e só está disponível na versão para computador (Windows/Linux).';
  return {
    isDesktop: false,
    os: 'web',
    async saveFile(name, bytes) {
      download(name, bytes);
      return name;
    },
    async saveFiles(files) {
      for (const f of files) {
        download(f.name, f.bytes);
        await new Promise((r) => setTimeout(r, 300));
      }
      return { folder: 'Downloads', firstFile: null };
    },
    showInFolder() {},
    async converterStatus() {
      return { available: false, platform: 'web', unsupportedReason: reason };
    },
    async pickConverter() {
      return { available: false, platform: 'web', unsupportedReason: reason };
    },
    openDownloadPage() {},
    async convertToPdf() {
      throw new Error(reason);
    },
  };
}

export const platform: Platform = window.mypdfNative ? createDesktopPlatform(window.mypdfNative) : createWebPlatform();

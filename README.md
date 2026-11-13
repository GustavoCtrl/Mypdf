# MyPDF

Aplicativo **gratuito, offline e de código aberto** para:

| Função | Como funciona |
|---|---|
| **Unir PDFs** | Os arquivos entram na **ordem de seleção** (padrão). Dá para mudar a ordem arrastando, com as setas, por nome (A→Z / Z→A) ou invertendo. Também dá para escolher quais páginas de cada arquivo entram (ex.: `1-3, 5, 8-fim`). Aceita .doc/.docx/.ppt/.pptx direto na lista (converte sozinho). |
| **Reordenar páginas** | Miniaturas de todas as páginas: arraste, ou selecione várias e mova para o início/fim/esquerda/direita. Também: inverter, restaurar e digitar a ordem (`3, 1, 2, 4-fim`). |
| **Separar páginas** | Extrair páginas escolhidas (em um PDF ou uma por arquivo), uma página por arquivo, por intervalos (`1-3, 4-6, 7-fim`) ou a cada N páginas. |
| **Converter para PDF** | .doc, .docx, .ppt, .pptx, .pps, .ppsx, .odt, .odp e .rtf, usando o **LibreOffice** instalado no computador (sem internet). |

O arquivo original nunca é alterado: o resultado é sempre salvo como um arquivo novo.

## Licenças: tudo livre, sem custo

| Componente | Uso | Licença |
|---|---|---|
| Electron | janela do app para Windows/Linux | MIT |
| pdf-lib | unir, reordenar e separar | MIT |
| pdf.js (pdfjs-dist) | miniaturas das páginas | Apache 2.0 |
| React, dnd-kit | interface e arrastar/soltar | MIT |
| LibreOffice (instalado à parte) | conversão de documentos | MPL 2.0 |

Nenhum dado sai do computador. Não há serviços pagos, contas nem chaves de API.

## Requisitos

- **Para usar:** Windows 10/11 ou Linux (testado no Ubuntu). O LibreOffice só é necessário para a função *Converter*.
  - Ubuntu: `sudo apt install libreoffice-writer libreoffice-impress` (ou "LibreOffice" pela Central de Aplicativos; versões snap e flatpak também funcionam).
  - Windows: instalador gratuito em <https://www.libreoffice.org/download/>.
  - Se o LibreOffice estiver em um local diferente, use **Converter → Localizar manualmente…**.
- **Para desenvolver:** Node.js 20 ou mais recente.

## Desenvolvimento

```bash
npm install
npm run dev      # abre o app com recarregamento automático
npm test         # testes das operações de PDF
npm start        # build de produção + abre o app
```

## Gerar instaladores

### Ubuntu / Linux
```bash
npm run dist:linux
```
Gera em `release/`:
- `mypdf_1.0.0_amd64.deb`: instale com `sudo apt install ./release/mypdf_1.0.0_amd64.deb`. O pacote **recomenda** o LibreOffice Writer/Impress, que o `apt` instala junto automaticamente.
- `MyPDF-1.0.0.AppImage`: executável único, roda em qualquer distribuição (`chmod +x` e dois cliques).

### Windows

**A partir do Linux, sem nada extra: versão portátil (.zip)**
```bash
npm run build && npx electron-builder --win zip
```
Gera `release/MyPDF-1.0.0-win.zip`. No Windows, extraia a pasta e dê dois cliques em `MyPDF.exe`.

**Instalador (`Setup.exe`) e `.exe` portátil de arquivo único**: escolha uma das opções:
- No Linux, instale o Wine uma vez (`sudo apt install wine`) e rode `npm run dist:win`.
- Num computador Windows, rode `npm install` e depois `npm run dist:win`.
- Sem Windows nem Wine: o workflow `.github/workflows/build.yml` gera tudo de graça no GitHub Actions (repositórios públicos). Envie o projeto ao GitHub e rode **Actions → Build → Run workflow**.

Saídas em `release/`: `MyPDF Setup 1.0.0.exe` (instalador), `MyPDF 1.0.0.exe` (portátil) e o `.zip`.

> Na primeira execução, o Windows pode mostrar "O Windows protegeu o computador", porque o app não tem assinatura digital (um certificado é pago). Clique em **Mais informações → Executar assim mesmo**.

Antes de publicar, troque o campo `homepage` do `package.json` pelo endereço real do projeto.

## Estrutura

```
electron/main.cjs        processo principal: janela, salvar arquivos, conversão via LibreOffice
electron/preload.cjs     ponte segura entre interface e sistema
src/core/pdfOps.ts       unir / reordenar / extrair / separar (pdf-lib)
src/core/pageRanges.ts   interpretação de "1-3, 5, 8-fim"
src/core/pdfRender.ts    miniaturas (pdf.js)
src/platform/index.ts    camada de plataforma (desktop agora; celular depois)
src/tabs/*.tsx           as 4 telas
tests/                   testes automatizados (vitest)
```

## Celular (próxima etapa)

A interface já é responsiva, e todo o acesso ao sistema passa por `src/platform/index.ts`. Por isso, a versão Android pode reaproveitar o mesmo código com o **Capacitor** (MIT, gratuito):

- **Unir, reordenar e separar** funcionam 100% offline no celular, porque usam o mesmo código.
- **Converter .doc/.pptx** não tem solução gratuita e offline no celular: o LibreOffice não roda dentro de um app Android. As alternativas livres seriam abrir o arquivo no app **Collabora Office** (gratuito, F-Droid/Play Store) e exportar em PDF por lá, ou converter no computador.

Para gerar o APK é preciso o Android Studio (gratuito). O iPhone exige um Mac com Xcode.

## Solução de problemas

- **"LibreOffice não encontrado"**: instale-o (veja os requisitos) e clique em *Verificar novamente*.
- **PDF protegido por senha**: o app avisa e não edita. Remova a proteção antes.
- **O app abre como "Node" ao rodar `npm run dev`**: a variável `ELECTRON_RUN_AS_NODE` está definida no terminal. Rode `unset ELECTRON_RUN_AS_NODE` antes.

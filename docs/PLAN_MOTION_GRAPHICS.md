# Plano de Implementação: B-Roll Motion Graphics (Opção C)

## Visão Geral
Este plano descreve o desenvolvimento de uma pipeline de renderização em servidor (Server-Side Rendering) de vídeos curtos. Quando o usuário fizer upload de uma imagem do seu produto, o sistema não a tratará como estática. Em vez disso, essa imagem será enviada a um gerador em HTML5/React e gravada num vídeo MP4 contendo Animações CSS (Floating dinâmico, Fundos com raios giratórios, textos de marketing), retornando este MP4 como o `assetUrl` final do B-Roll.

## Fases de Implementação

### 1. Preparação da Imagem (Backend)
- Criar Rota: `/api/projects/[id]/ai-brolls/[itemId]/motion`
- Upload do arquivo local recebe uma flag `isProduct=true` ou botão específico na interface ("Gerar Motion Graphics").
- **(Opcional / Premium)**: Integrar API de remoção de fundo (Remove.bg ou Photoroom) para extrair o produto, caso o usuário não envie um PNG transparente.

### 2. Criação do Template de Animação (Remotion / HTML5)
A chave da Opção C é renderizar web!
- Criar um mini-projeto/rota paralela no Next.js (ex: `/render/templates/product-showcase?imgUrl=...`).
- Esta rota renderiza apenas a tela limpa com animações CSS robustas:
  - Background radial degradê suave (baseado nas cores predominantes da imagem - extraídas via lib-color).
  - Imagem do produto no centro pulsando ou "flutuando" (keyframes translateY).
  - Partículas ou raios sutis girando ao fundo (Motion premium).

### 3. Motor de Gravação de Vídeo (Puppeteer + FFmpeg ou Remotion)
Existem duas tecnologias viáveis para capturar a página e transformar num MP4 sólido que o Worker principal consumirá:
- **Abordagem A (Puppeteer + FFmpeg-Canvas)**: Usar `puppeteer` e `puppeteer-stream` para gravar a tab rodando a animação CSS.
- **Abordagem B (Remotion)**: Integrar `@remotion/lambda` ou Renderização Local por CLI/API NodeJS de Remotion `npx remotion render`.
*Decisão da pipeline: Iniciaremos com uma prova de conceito baseada em Puppeteer ou no Remotion core engine (se performance exigir).*

### 4. Integração na UI do Captions Editor (Frontend)
- Na aba de edição do B-Roll (o Modal que criamos na etapa passada), adicionar um botão ao lado do *Upload Local* chamado: **"✨ Criar Animação de Anúncio (Imagem)"**.
- Ao clicar, seleciona o arquivo e a UI entra em status `Criando Motion Graphics (Demora ~10s)...`.

### 5. Finalização e Entrega
- Após o gerador criar o `broll-motion.mp4` -> Ele segue o fluxo S3 Presigned URL.
- O campo `type` do ProjectItem é setado como `motion_broll`.
- FFmpeg da passarela final processa esse novo MP4 sem nem perceber que foi gerado por HTML.

## Trade-offs e Riscos Previstos
- **Custos de RAM/CPU**: Rodar instâncias headless (Puppeteer) ou Remotion no servidor consome recursos elevados de infra. Se for rodar em Lambda ou Vercel Serverless Function, os tempos de limite (Max Duration 10s default) podem esgotar.
- **Solução sugerida**: Processaremos o vídeo no Worker de Background (`tsx workers/index.ts`) junto com o renderizador final ffmpeg para usarmos a máquina/VPS sem risco de Timeout REST API.

## Agentes Necessários (Para Fase 2)
1. `backend-specialist`: Para configurar a gravação Remotion/Puppeteer no node e as rotas.
2. `frontend-specialist`: Para desenhar os React Patterns e a bela Animação CSS do E-Commerce.
3. `test-engineer`: Para garantir a segurança dos workers ao rodar instâncias web no background.

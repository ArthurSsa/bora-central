// O agente de um job: Claude pelo Agent SDK, falando só com os apps que a
// skill pediu e com a própria fábrica (pra dizer em que etapa está).
//
// Nenhuma ferramenta embutida do Claude Code: sem Bash, sem Read, sem Write,
// sem web. O agente só enxerga o mundo pelos servidores MCP dos apps, que só
// enxergam a pasta do job. Isso é o isolamento; o prompt é só instrução.
import { query, createSdkMcpServer, tool, type HookCallback, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { servidorMcp, prefixoFerramentas, ferramentasBloqueadas } from './apps.ts';
import type { Config } from './config.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { desenharLegendas, exportarReel, lerSrt, somDoReel } from './reel.ts';
import { montarCenaDoPedido, projetoDoMotion, renderizarDoPedido } from './motion.ts';
import { cartazDoPedido } from './vetor.ts';
import { materialDoPedido } from './diagramacao.ts';
import { abrirMcp } from './mcp-cru.ts';
import { montarPostComPessoa, type AnaliseDaPessoa } from './pessoa.ts';
import path from 'node:path';
import type { Ajuste, Custos, Elemento } from './fila.ts';
import type { Conjunto } from './marca.ts';
import type { NivelTrilha } from './som.ts';
import type { SaidaEsperada, Skill } from './skills.ts';

/**
 * O único jeito do agente escrever arquivo que não é imagem: só .txt, só em
 * saida/, só os nomes que o pedido manda entregar. O agente não tem Write —
 * de propósito —, e esta porta é estreita do mesmo jeito.
 */
export function salvarTexto(pastaJob: string, saidas: SaidaEsperada[], caminho: string, texto: string): string {
  const permitidos = new Set(saidas.filter((s) => s.caminho.endsWith('.txt')).map((s) => s.caminho));
  if (!permitidos.has(caminho)) {
    throw new Error(`só dá pra salvar texto em ${[...permitidos].join(', ') || '(nenhum arquivo de texto neste pedido)'}`);
  }
  const destino = path.join(pastaJob, caminho);
  mkdirSync(path.dirname(destino), { recursive: true });
  writeFileSync(destino, texto.replace(/\r\n/g, '\n').trim() + '\n', 'utf8');
  return destino;
}

/** restamSegundos: quanto falta, quando dá pra medir (o render de motion conta os quadros). */
export type Etapa = { etapa: string; progresso: number; restamSegundos?: number | null };

export type DadosDaPeca = {
  conjunto: Conjunto;
  /** Todos os conjuntos da marca, o padrão primeiro. */
  conjuntos: Conjunto[];
  /** Ajustes que valem pra esta rodada, do mais antigo ao atual (vazio na produção). */
  ajustes: Ajuste[];
  fonte: string;
  pesos: { titulo: number; texto: number };
  /** Fonte condensada de manchete: títulos em caixa alta e maiores. */
  impacto: boolean;
  margem: number;
  alinhamento: 'left' | 'center';
  textoDoCliente: string;
  briefing: Record<string, unknown>;
  instagram: string | null;
  chamada: string | null;
  hashtags: string | null;
  registro: string | null;
  numerar: boolean;
  semEmoji: boolean;
  /** As saídas deste pedido, já com {n} expandido. */
  saidas: SaidaEsperada[];
  elementos: Elemento[];
  /** Vídeo: a trilha da marca em entrada/ (null é sem música) e o nível dela sob a fala. */
  som: { trilha: string | null; nivel: NivelTrilha };
  /** Todas as cores que a marca permite (paleta e conjuntos): a edição do Studio só troca pra uma delas. */
  cores?: string[];
  /** A foto da pessoa, já tratada e recortada (src/pessoa.ts); null quando o pedido não traz foto. */
  pessoa?: AnaliseDaPessoa | null;
};

export type ParametrosAgente = {
  cfg: Config;
  skill: Skill;
  pastaJob: string;
  sistema: string;
  pedido: string;
  /** O mesmo que vai em `pedido`, já estruturado. O Claude lê o texto; o roteiro usa isto. */
  dados: DadosDaPeca;
  abortar: AbortController;
  aoMudarEtapa: (e: Etapa) => Promise<void>;
  aoUsarFerramenta: (nome: string, ms: number, falhou: boolean) => void;
  /** Sobe já uma saída pronta (a prévia do vídeo), antes do resto terminar. */
  entregarParcial: (caminho: string) => Promise<void>;
};

export type ResultadoAgente = { custos: Custos; resumo: string; turnos: number };

/** Erro do agente que ainda carrega o que ele gastou até falhar. */
export class FalhaDoAgente extends Error {
  readonly custos: Custos;
  constructor(mensagem: string, custos: Custos) {
    super(mensagem);
    this.custos = custos;
  }
}

/**
 * O pedido não dá pra fazer do jeito que veio (a foto corta a cabeça, não tem
 * rosto): tentar de novo dá no mesmo. Falha de vez, sem nova tentativa, e o
 * cliente lê o que fazer — não o "a equipe vai finalizar" genérico.
 */
export class FalhaDoPedido extends FalhaDoAgente {
  readonly paraOCliente: string;
  constructor(mensagem: string, paraOCliente: string, custos: Custos = CUSTO_ZERO) {
    super(mensagem, custos);
    this.paraOCliente = paraOCliente;
  }
}

export const CUSTO_ZERO: Custos = {
  tokens_entrada: 0, tokens_saida: 0, tokens_cache_leitura: 0, tokens_cache_escrita: 0, custo_usd: 0, render_segundos: 0,
};

export type Agente = (p: ParametrosAgente) => Promise<ResultadoAgente>;

export const rodarAgente: Agente = async (p) => {
  let renderMs = 0;

  const fabrica = createSdkMcpServer({
    name: 'fabrica',
    version: '0.1.0',
    tools: [
      tool(
        'avisar_etapa',
        'Atualiza a frase que o cliente vê na tela de acompanhamento. Chame ao começar cada parte do trabalho.',
        {
          etapa: z.string().min(3).max(60).describe('Em português, sem termo técnico: "desenhando o post", "ajustando as cores".'),
          progresso: z.number().min(5).max(90).describe('Quanto do trabalho já foi feito, de 5 a 90.'),
        },
        async ({ etapa, progresso }) => {
          await p.aoMudarEtapa({ etapa, progresso });
          return { content: [{ type: 'text', text: 'ok' }] };
        },
      ),
      tool(
        'salvar_texto',
        'Salva um arquivo de texto da entrega (legenda, títulos). Só os .txt listados em "Entregue".',
        {
          caminho: z.string().describe('Exatamente como está em "Entregue", ex.: saida/legenda.txt'),
          texto: z.string().min(1).max(5000),
        },
        async ({ caminho, texto }) => {
          try {
            salvarTexto(p.pastaJob, p.dados.saidas, caminho, texto);
            return { content: [{ type: 'text', text: 'salvo' }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
      // As duas abaixo existem porque são trabalho mecânico que o agente faria
      // mal e caro: desenhar trinta legendas iguais, e exportar — que pelo MCP
      // do FilmCraft não anda.
      tool(
        'legendas_da_marca',
        'Desenha as legendas de saida/legendas.srt como PNGs transparentes 1080×1920 na fonte, peso e cores da marca (o FilmCraft desenha errado as fontes de marca). Devolve cada arquivo com o tempo, pra você importar e pôr numa trilha de vídeo por cima.',
        { conjunto: z.string().optional().describe('Nome do conjunto de cor; sem ele, o da peça.') },
        async ({ conjunto }) => {
          try {
            const c = p.dados.conjuntos.find((x) => x.nome === conjunto) ?? p.dados.conjunto;
            const legendas = lerSrt(readFileSync(path.join(p.pastaJob, 'saida', 'legendas.srt'), 'utf8'));
            const pngs = await desenharLegendas(p.pastaJob, legendas, { fonte: p.dados.fonte, peso: p.dados.pesos.titulo, conjunto: c, impacto: p.dados.impacto });
            return { content: [{ type: 'text', text: JSON.stringify(legendas.map((l, i) => ({ arquivo: pngs[i], inicio: l.inicio, fim: l.fim }))) }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
      tool(
        'exportar_video',
        'Exporta editavel/reel.fcproj (salve antes com file.save). Antes de exportar, o som passa pelo SoundCraft: a fala ganha filtro de graves, de-esser e compressor, e a trilha da marca (quando o pedido tem) entra por baixo, abaixando onde há legenda — por isso exporte depois de saida/legendas.srt estar pronta. Com previa: true, sai saida/previa.mp4 com os 15 primeiros segundos e o cliente já vê; sem, saida/reel.mp4 completo. Volume em -16 LUFS e 1080×1920 sempre.',
        { previa: z.boolean() },
        async ({ previa }) => {
          try {
            const projeto = path.join(p.pastaJob, 'editavel', 'reel.fcproj');
            const t = performance.now();
            somDoReel(p);
            exportarReel(projeto, path.join(p.pastaJob, 'saida', previa ? 'previa.mp4' : 'reel.mp4'), previa ? { previaSegundos: 15 } : {});
            renderMs += performance.now() - t;
            if (previa) await p.entregarParcial('saida/previa.mp4');
            return { content: [{ type: 'text', text: previa ? 'prévia pronta e entregue' : 'reel exportado' }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
      // O cartaz: montar e exportar no VectorCraft é mecânico; o que o agente
      // decide é o texto (e o conjunto, num ajuste).
      tool(
        'cartaz_da_marca',
        'Monta o cartaz para imprimir no VectorCraft, na folha do pedido (A4 ou A3), e salva saida/cartaz.pdf (3 mm de sangria e marcas de corte), saida/cartaz.png (1080 px) e os editáveis editavel/cartaz.vectorcraft e editavel/cartaz.ai. Fundo do conjunto, barra de destaque, título que encolhe até caber, apoio, assinatura e o logo (na versão de uma cor quando uma cor dele some no fundo).',
        {
          titulo: z.string().min(2).max(120).describe('O tema em até oito palavras.'),
          apoio: z.string().max(140).optional().describe('Uma linha menor embaixo do título, ou nada.'),
          conjunto: z.string().optional().describe('Nome do conjunto de cor; sem ele, o da peça.'),
        },
        async ({ titulo, apoio, conjunto }) => {
          try {
            const c = p.dados.conjuntos.find((x) => x.nome === conjunto) ?? p.dados.conjunto;
            const t = performance.now();
            cartazDoPedido(p, { titulo, apoio: apoio ?? null, conjunto: c });
            renderMs += performance.now() - t;
            return { content: [{ type: 'text', text: 'cartaz salvo: saida/cartaz.pdf, saida/cartaz.png, editavel/cartaz.vectorcraft, editavel/cartaz.ai' }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
      // O post com a pessoa: a foto já foi tratada e recortada antes (src/pessoa.ts);
      // encaixar o rosto é conta, e o agente decide o texto e, se quiser, o jeito.
      tool(
        'post_com_pessoa',
        'Monta o post 1080×1350 com a pessoa da foto do pedido e salva editavel/post.psd e saida/post.png. Dois jeitos: "recorte" (a pessoa recortada sobre o fundo do conjunto, o rosto grande à direita, o texto em cima) e "foto" (a foto cobrindo o post, o texto sobre uma faixa da cor do conjunto, do lado oposto ao rosto). "auto" escolhe o recorte quando ele ficou bom. O texto nunca cobre o rosto: o título encolhe até caber acima dele. Depois salve a legenda.',
        {
          titulo: z.string().min(2).max(90).describe('O título, curto: até sete palavras.'),
          apoio: z.string().max(120).optional().describe('Uma linha menor embaixo do título, ou nada.'),
          jeito: z.enum(['auto', 'recorte', 'foto']).optional().describe('Sem ele, auto.'),
          conjunto: z.string().optional().describe('Nome do conjunto de cor; sem ele, o da peça.'),
        },
        async ({ titulo, apoio, jeito, conjunto }) => {
          if (!p.dados.pessoa) return { content: [{ type: 'text', text: 'este pedido não tem foto da pessoa' }], isError: true };
          const mcp = await abrirMcp(servidorMcp('photocraft', p.pastaJob));
          const t = performance.now();
          try {
            const passo = async (f: string, args: Record<string, unknown>) => { const r = await mcp.chamar(f, args); if (r.erro) throw new Error(`${f}: ${r.texto}`); return r.texto; };
            const r = await montarPostComPessoa({
              passo, conjunto: p.dados.conjuntos.find((x) => x.nome === conjunto) ?? p.dados.conjunto,
              fonte: p.dados.fonte, pesos: p.dados.pesos, margem: p.dados.margem, elementos: p.dados.elementos, analise: p.dados.pessoa,
              textos: { titulo, apoio: apoio ?? null, assinatura: [p.dados.instagram, p.dados.registro].filter(Boolean).join(' · ') || null }, jeito,
            });
            return { content: [{ type: 'text', text: `post salvo (${r.jeito}): saida/post.png e editavel/post.psd${r.avisos.length ? `. Avisos: ${r.avisos.join('; ')}` : ''}` }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          } finally {
            renderMs += performance.now() - t;
            mcp.fechar();
          }
        },
      ),
      // O guia e o folheto: diagramar é mecânico; o agente decide o texto.
      tool(
        'material_da_marca',
        'Monta o guia (A5, uma ideia por página) ou o folheto dobrável (A4 em três painéis, PDF/X-4 pra gráfica) no DesignCraft, conforme o pedido, e salva o PDF em saida/, uma prévia por página (saida/pagina-01.png…) e os editáveis editavel/*.designcraft e editavel/*.idml. A letra encolhe sozinha até nenhum texto sobrar.',
        {
          titulo: z.string().min(2).max(120).describe('O tema em até oito palavras.'),
          apoio: z.string().max(140).optional().describe('Uma linha menor na capa, ou nada.'),
          ideias: z.array(z.string().min(2).max(400)).min(3).max(12).describe('As ideias do pedido, na ordem: uma por página do miolo (guia) ou por painel de dentro (folheto; da quarta em diante vão na aba).'),
          conjunto: z.string().optional().describe('Nome do conjunto de cor; sem ele, o da peça.'),
        },
        async ({ titulo, apoio, ideias, conjunto }) => {
          try {
            const c = p.dados.conjuntos.find((x) => x.nome === conjunto) ?? p.dados.conjunto;
            const t = performance.now();
            const r = materialDoPedido(p, { titulo, apoio: apoio ?? null, ideias, conjunto: c });
            renderMs += performance.now() - t;
            return { content: [{ type: 'text', text: `pronto: ${path.relative(p.pastaJob, r.pdf)}, ${r.paginas.length} páginas${r.avisos.length ? `. Avisos: ${r.avisos.join('; ')}` : ''}` }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
      // Motion: a cena base na marca e o render com quanto falta. O agente
      // pode mexer na cena pelo EffectCraft antes de renderizar.
      tool(
        'cena_da_marca',
        'Monta a cena base do motion no EffectCraft e salva o projeto em editavel/ (abertura.ecproj ou carrossel.ecproj, pela skill). Na abertura, passe o título e o rótulo; no carrossel em vídeo, as imagens de entrada/slides/ entram sozinhas.',
        {
          titulo: z.string().max(120).optional().describe('Abertura: o tema, em até oito palavras.'),
          rotulo: z.string().max(60).optional().describe('Abertura: o @ da conta ou o nome, embaixo do título.'),
          conjunto: z.string().optional().describe('Nome do conjunto de cor; sem ele, o da peça.'),
        },
        async ({ titulo, rotulo, conjunto }) => {
          try {
            const c = p.dados.conjuntos.find((x) => x.nome === conjunto) ?? p.dados.conjunto;
            const r = montarCenaDoPedido(p, { conjunto: c, titulo, rotulo: rotulo ?? null });
            return { content: [{ type: 'text', text: `cena salva em ${path.relative(p.pastaJob, projetoDoMotion(p))}: ${JSON.stringify(r)}` }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
      tool(
        'renderizar_motion',
        'Renderiza o projeto de motion em H.264 1080×1920, com a trilha da marca que cena_da_marca já pôs (ou mudo, se o pedido é sem música). Com previa: true, saem os 3 primeiros segundos em meia resolução em saida/previa.mp4 e o cliente já vê; sem, o vídeo inteiro em saida/reel.mp4, com a tela do cliente mostrando quanto falta.',
        { previa: z.boolean() },
        async ({ previa }) => {
          try {
            const t = performance.now();
            await renderizarDoPedido(p, previa);
            renderMs += performance.now() - t;
            return { content: [{ type: 'text', text: previa ? 'prévia pronta e entregue' : 'vídeo renderizado' }] };
          } catch (e) {
            return { content: [{ type: 'text', text: (e as Error).message }], isError: true };
          }
        },
      ),
    ],
  });

  const servidores: Record<string, McpServerConfig> = { fabrica };
  for (const app of p.skill.apps) servidores[app] = servidorMcp(app, p.pastaJob);

  const depois: HookCallback = async (entrada) => {
    if (entrada.hook_event_name === 'PostToolUse' || entrada.hook_event_name === 'PostToolUseFailure') {
      const ms = 'duration_ms' in entrada && typeof entrada.duration_ms === 'number' ? entrada.duration_ms : 0;
      // Tempo dentro dos apps é o "minuto de render" da precificação; a
      // ferramenta da própria fábrica não conta.
      if (!entrada.tool_name.startsWith(prefixoFerramentas('fabrica'))) renderMs += ms;
      p.aoUsarFerramenta(entrada.tool_name, ms, entrada.hook_event_name === 'PostToolUseFailure');
    }
    return {};
  };

  const q = query({
    prompt: p.pedido,
    options: {
      model: p.cfg.modelo,
      effort: p.cfg.esforco,
      thinking: { type: 'adaptive' },
      systemPrompt: p.sistema,
      tools: [],
      mcpServers: servidores,
      allowedTools: Object.keys(servidores).map((s) => `mcp__${s}`),
      disallowedTools: ferramentasBloqueadas(p.skill.apps),
      permissionMode: 'dontAsk',
      permissionPrompts: 'none',
      strictMcpConfig: true,
      settingSources: [],
      persistSession: false,
      cwd: p.pastaJob,
      maxTurns: 60,
      maxBudgetUsd: p.cfg.tetoUsd,
      abortController: p.abortar,
      hooks: {
        PostToolUse: [{ hooks: [depois] }],
        PostToolUseFailure: [{ hooks: [depois] }],
      },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'bora-fabrica/0.1.0' },
    },
  });

  for await (const m of q) {
    if (m.type !== 'result') continue;
    const custos: Custos = {
      tokens_entrada: m.usage.input_tokens,
      tokens_saida: m.usage.output_tokens,
      tokens_cache_leitura: m.usage.cache_read_input_tokens,
      tokens_cache_escrita: m.usage.cache_creation_input_tokens,
      custo_usd: m.total_cost_usd,
      render_segundos: Math.round(renderMs / 10) / 100,
    };
    if (m.subtype !== 'success' || m.is_error) {
      const porque: Record<string, string> = {
        error_max_turns: 'o agente passou do limite de passos',
        error_max_budget_usd: `o agente passou do teto de US$ ${p.cfg.tetoUsd} por rodada`,
        error_during_execution: 'o agente parou com erro',
      };
      throw new FalhaDoAgente(porque[m.subtype] ?? `o agente terminou com ${m.subtype}`, custos);
    }
    return { custos, resumo: m.result, turnos: m.num_turns };
  }
  throw new FalhaDoAgente('o agente terminou sem resultado', { ...CUSTO_ZERO, render_segundos: renderMs / 1000 });
};

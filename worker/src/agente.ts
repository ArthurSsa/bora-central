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
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Ajuste, Custos, Elemento } from './fila.ts';
import type { Conjunto } from './marca.ts';
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

export type Etapa = { etapa: string; progresso: number };

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

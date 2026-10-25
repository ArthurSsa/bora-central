// Como subir cada app da ArtCraft como servidor MCP, preso à pasta do job.
//
// As flags vêm da ajuda de cada CLI e dos docs/mcp.md e docs/agents.md dos
// repositórios, não do prompt original — e as duas fontes não batem:
//
//   PhotoCraft   --automation-read-root / --automation-write-root   (testado)
//   EffectCraft  as mesmas raízes + --autosave                       (docs)
//   LightCraft   não tem raiz: recebe as pastas como argumento       (docs)
//   FilmCraft    RECUSA as raízes (sai com erro 2); trabalha num .fcproj
//                passado em --project, que fica dentro da pasta do job (docs)
//
// Onde o app não tem raiz, quem segura o isolamento é a pasta do job ser a
// única coisa que o processo recebe, mais o usuário de sistema do worker.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { acharCli } from './config.ts';

export const APPS = ['photocraft', 'effectcraft', 'lightcraft', 'filmcraft'] as const;
export type App = (typeof APPS)[number];

export function servidorMcp(app: App, pastaJob: string): McpStdioServerConfig {
  const comando = acharCli(app);
  // Uma chamada de render pode demorar: 2–5 s por quadro 1080p no EffectCraft
  // em CPU. O padrão do SDK cortaria um render de 10 s de vídeo no meio.
  const timeout = app === 'photocraft' ? 120_000 : 30 * 60_000;
  const base = { type: 'stdio' as const, command: comando, timeout, alwaysLoad: true };
  switch (app) {
    case 'photocraft':
      return { ...base, args: ['mcp', '--automation-read-root', pastaJob, '--automation-write-root', pastaJob] };
    case 'effectcraft':
      return { ...base, args: ['mcp', '--autosave', '--automation-read-root', pastaJob, '--automation-write-root', pastaJob] };
    case 'lightcraft':
      return { ...base, args: ['mcp', '--library', path.join(pastaJob, 'biblioteca'), path.join(pastaJob, 'frames')] };
    case 'filmcraft':
      return { ...base, args: ['mcp', '--project', path.join(pastaJob, 'editavel', 'projeto.fcproj'), '--data-dir', path.join(pastaJob, '.filmcraft')] };
  }
}

/**
 * As famílias que o PhotoCraft enxerga nesta máquina. Pergunta ao próprio app
 * em vez de listar a pasta de fontes do sistema: o que importa é o que ELE
 * acha, e no Linux e no Windows isso mora em lugares diferentes.
 */
export function fontesInstaladas(): string[] {
  const saida = execFileSync(acharCli('photocraft'), ['run', '--new', '{"width":1,"height":1}', '--cmd', 'type.fonts'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const linha = saida.split(/\r?\n/).find((l) => l.includes('"type.fonts"'));
  if (!linha) throw new Error(`photocraft-cli não listou as fontes: ${saida.slice(0, 200)}`);
  return JSON.parse(linha).result.families as string[];
}

/**
 * Os pesos que a família tem de verdade. Pedir 700 a uma fonte que só tem 400
 * (a Anton) não dá erro: o PhotoCraft aceita, registra 700 e desenha o 400.
 * A fonte variável (a Manrope) vai de 200 a 800 em qualquer número.
 */
const pesosCache = new Map<string, { variavel: [number, number] | null; fixos: number[] }>();
export function pesosDaFamilia(familia: string) {
  const guardado = pesosCache.get(familia);
  if (guardado) return guardado;
  const saida = execFileSync(acharCli('photocraft'), ['run', '--new', '{"width":1,"height":1}', '--cmd', 'type.fonts', '--params', JSON.stringify({ family: familia })], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const linha = saida.split(/\r?\n/).find((l) => l.includes('"type.fonts"'));
  const faces = (linha ? JSON.parse(linha).result.faces : []) as Array<{ weight: number; italic: boolean; axes?: Array<[string, number, number, number]> }>;
  const eixo = faces.flatMap((f) => f.axes ?? []).find((a) => a[0] === 'wght');
  const r = { variavel: eixo ? [eixo[2], eixo[3]] as [number, number] : null, fixos: faces.filter((f) => !f.italic).map((f) => f.weight) };
  pesosCache.set(familia, r);
  return r;
}

export function pesoMaisPerto(familia: string, desejado: number): number {
  const { variavel, fixos } = pesosDaFamilia(familia);
  if (variavel) return Math.min(variavel[1], Math.max(variavel[0], desejado));
  if (!fixos.length) return desejado;
  return fixos.reduce((melhor, p) => (Math.abs(p - desejado) < Math.abs(melhor - desejado) ? p : melhor), fixos[0]);
}

/** O prefixo que o SDK dá às ferramentas de um servidor: mcp__<nome>__<ferramenta>. */
export const prefixoFerramentas = (servidor: string) => `mcp__${servidor}__`;

// Ferramentas que só funcionam com o app aberto numa tela (modo ponte). No
// servidor elas só respondem erro — e cada ferramenta inútil na lista é uma
// chance a mais de o agente gastar um passo nela.
const SO_PONTE: Partial<Record<App, string[]>> = {
  photocraft: ['control_call', 'ui_inspect', 'ui_menu_invoke', 'ui_pointer', 'ui_screenshot', 'ui_set'],
};

export const ferramentasBloqueadas = (apps: App[]) =>
  apps.flatMap((a) => (SO_PONTE[a] ?? []).map((f) => prefixoFerramentas(a) + f));

// Tudo o que o worker lê do ambiente, num lugar só. Faltar variável obrigatória
// é erro na partida, não no primeiro job — descobrir às 3h da manhã que a chave
// do Storage não estava lá é pior que não subir.
import { existsSync, readdirSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ_WORKER = path.resolve(AQUI, '..');
export const RAIZ_REPO = path.resolve(RAIZ_WORKER, '..');

function obrigatoria(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`variável de ambiente ${nome} não definida (veja worker/.env.exemplo)`);
  return v;
}

// No Linux os .deb instalam em /usr/bin e o nome basta. Aqui no Windows os CLIs
// ficam soltos em worker/.ferramentas/<app>/<pasta da versão>/; acha o .exe lá
// pra ninguém precisar escrever o caminho com a versão dentro no .env.
export function acharCli(app: string): string {
  const doAmbiente = process.env[`${app.toUpperCase()}_CLI`];
  if (doAmbiente) return doAmbiente;
  const pasta = path.join(RAIZ_WORKER, '.ferramentas', app);
  if (existsSync(pasta)) {
    for (const versao of readdirSync(pasta).sort().reverse()) {
      const exe = path.join(pasta, versao, `${app}-cli.exe`);
      if (existsSync(exe)) return exe;
    }
  }
  return `${app}-cli`;
}

export function lerConfig() {
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? 'https://yxewmauwnxnrrhevlbtc.supabase.co',
    supabaseServiceKey: obrigatoria('SUPABASE_SERVICE_ROLE_KEY'),
    workerId: process.env.WORKER_ID ?? `${hostname()}-${process.pid}`,
    // No Windows, fora do projeto: a pasta do usuário é onde programa guarda
    // trabalho, e o projeto não enche de vídeo de cliente.
    pastaJobs: path.resolve(process.env.PASTA_JOBS ?? (process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'BoraFabrica', 'jobs')
      : path.join(RAIZ_WORKER, '.jobs'))),
    // Pasta de job que falhou fica pra alguém olhar — por estes dias, e sai.
    diasPastaFalha: Number(process.env.DIAS_PASTA_FALHA ?? '7'),
    pastaSkills: path.resolve(process.env.PASTA_SKILLS ?? path.join(RAIZ_REPO, 'skills')),
    // 'roteiro' troca o Claude por um passo a passo fixo (src/roteiro.ts):
    // prova a máquina inteira sem chave da Anthropic e sem custo.
    agente: (process.env.FABRICA_AGENTE === 'roteiro' || process.argv.includes('--roteiro') ? 'roteiro' : 'claude') as 'claude' | 'roteiro',
    modelo: process.env.FABRICA_MODELO ?? 'claude-opus-5-5',
    esforco: (process.env.FABRICA_ESFORCO ?? 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    // Teto por rodada. Um post de teste custa centavos; um agente em laço
    // custaria o mês. Estourar vira falha com o motivo escrito, não conta aberta.
    tetoUsd: Number(process.env.FABRICA_TETO_USD ?? '2'),
    leaseSegundos: Number(process.env.LEASE_SEGUNDOS ?? '600'),
    esperaFilaMs: Number(process.env.ESPERA_FILA_MS ?? '3000'),
    manterPastaJob: process.env.MANTER_PASTA_JOB === '1',
  };
}

export type Config = ReturnType<typeof lerConfig>;

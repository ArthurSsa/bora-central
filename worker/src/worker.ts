// O laço da fábrica: pega um job, produz, confere, sobe, conclui. Um por vez —
// o render do EffectCraft come a CPU inteira, e dois jobs disputando ela
// terminam os dois mais tarde que um depois do outro. Pra mais vazão, mais
// workers (cada um com sua máquina), e a fila já aguenta isso.
//
//   node src/worker.ts            fica escutando a fila
//   node src/worker.ts --uma-vez  espera um job, faz e sai (teste)
//   node src/worker.ts --roteiro  sem o Claude: o passo a passo fixo de src/roteiro.ts
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fontesInstaladas } from './apps.ts';
import { lerConfig, type Config } from './config.ts';
import { rodarAgente, FalhaDoAgente, CUSTO_ZERO, type Agente, type Etapa, type ResultadoAgente } from './agente.ts';
import { conectar, pegarJob, renovarLease, anotar, evento, carregarContexto, subir, concluir, devolverOuFalhar, type Job, type Pedido } from './fila.ts';
import { montarSistema, montarPedido } from './instrucoes.ts';
import { rodarRoteiro } from './roteiro.ts';
import { marcaParaAgente, resolverFonte, type ClienteParaMarca, type FonteResolvida } from './marca.ts';
import { carregarSkills, escolherSkill, type Skill } from './skills.ts';
import { conferirSaida, type SaidaConferida } from './verificar.ts';

export type Producao = { pastaJob: string; conferidas: SaidaConferida[]; resultado: ResultadoAgente; fonte: FonteResolvida };

/**
 * A parte que não fala com o banco: prepara a pasta, roda o agente e confere
 * o que ele salvou. Separada pra poder ser testada com um agente de mentira e
 * o PhotoCraft de verdade.
 */
export async function produzir(a: {
  cfg: Config;
  job: Pick<Job, 'id'>;
  skill: Skill;
  pedido: Pedido;
  cliente: ClienteParaMarca;
  instaladas: string[];
  agente: Agente;
  abortar: AbortController;
  aoMudarEtapa: (e: Etapa) => Promise<void>;
  aoUsarFerramenta: (nome: string, ms: number, falhou: boolean) => void;
}): Promise<Producao> {
  const pastaJob = path.join(a.cfg.pastaJobs, a.job.id);
  // Tentativa anterior pode ter deixado arquivo pela metade: começa limpo.
  rmSync(pastaJob, { recursive: true, force: true });
  for (const sub of ['entrada', 'saida', 'editavel']) mkdirSync(path.join(pastaJob, sub), { recursive: true });

  const m = a.cliente.marca ?? {};
  const fonte = resolverFonte(m.fonteMarca, m.fonteFalback, a.instaladas);
  const { texto: marca, conjunto } = marcaParaAgente(a.cliente, fonte);

  const resultado = await a.agente({
    cfg: a.cfg,
    skill: a.skill,
    pastaJob,
    sistema: montarSistema(a.skill),
    pedido: montarPedido(a.skill, a.pedido, marca),
    dados: {
      conjunto,
      fonte: fonte.usada,
      margem: m.margem === 'folgada' ? 96 : 72,
      alinhamento: m.alinha === 'centro' ? 'center' : 'left',
      textoDoCliente: String(a.pedido.briefing?.texto ?? a.pedido.titulo ?? ''),
    },
    abortar: a.abortar,
    aoMudarEtapa: a.aoMudarEtapa,
    aoUsarFerramenta: a.aoUsarFerramenta,
  });

  try {
    const conferidas = a.skill.saidas.map((s) => conferirSaida(pastaJob, s));
    return { pastaJob, conferidas, resultado, fonte };
  } catch (e) {
    // Reprovou na conferência: o que o agente gastou continua contando.
    throw new FalhaDoAgente(`reprovado na conferência: ${(e as Error).message}`, resultado.custos);
  }
}

export async function processar(sb: SupabaseClient, cfg: Config, skills: Map<string, Skill>, instaladas: string[], job: Job, agente: Agente) {
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] [${job.id.slice(0, 8)}] ${msg}`);
  const abortar = new AbortController();
  let perdido = false;
  let pasta: string | null = null;
  let deuCerto = false;

  // Lease renovado a cada terço do prazo. Se a renovação falha é porque o job
  // não é mais nosso (cancelado ou retomado por outro worker): para tudo.
  const timer = setInterval(async () => {
    try {
      if (!(await renovarLease(sb, cfg, job))) {
        perdido = true;
        log('perdi o job (cancelado ou retomado por outro worker); abortando');
        abortar.abort();
      }
    } catch (e) {
      log(`renovar lease falhou: ${(e as Error).message}`);
    }
  }, (cfg.leaseSegundos * 1000) / 3);
  // Para ANTES de gravar o resultado: depois que o job vira pronto ou volta
  // pra fila, a renovação responde "não é mais seu" e o log acusaria um job
  // perdido que na verdade terminou.
  const pararLease = () => clearInterval(timer);

  try {
    log(`tentativa ${job.tentativas} de ${job.max_tentativas}`);
    await anotar(sb, cfg, job, { etapa: 'preparando', progresso: 3 });
    await evento(sb, job, 'Começamos a produzir o seu pedido.', { visivel: true });

    const { pedido, cliente } = await carregarContexto(sb, job);
    const skill = escolherSkill(skills, pedido.tipo, job.skill);
    if (job.skill !== skill.nome) await sb.from('jobs').update({ skill: skill.nome }).eq('id', job.id);
    await sb.from('pedidos').update({ estado: 'produzindo' }).eq('id', job.pedido_id).in('estado', ['rascunho', 'produzindo']);
    log(`skill ${skill.nome}, apps ${skill.apps.join(', ')}`);

    const p = await produzir({
      cfg, job, skill, pedido, cliente, instaladas, agente, abortar,
      aoMudarEtapa: async ({ etapa, progresso }) => {
        log(`etapa: ${etapa} (${progresso}%)`);
        await anotar(sb, cfg, job, { etapa, progresso });
        await evento(sb, job, etapa, { visivel: true });
      },
      aoUsarFerramenta: (nome, ms, falhou) => {
        void evento(sb, job, `${nome} ${falhou ? 'falhou' : 'ok'} em ${ms} ms`, { nivel: falhou ? 'aviso' : 'info', dados: { ferramenta: nome, ms } });
      },
    });
    pasta = p.pastaJob;
    if (p.fonte.substituida) {
      await evento(sb, job, `fonte "${p.fonte.pedida}" não instalada; usada "${p.fonte.usada}"`, { nivel: 'aviso' });
    }

    await anotar(sb, cfg, job, { etapa: 'finalizando', progresso: 95 });
    const saidas = [];
    for (const c of p.conferidas) {
      saidas.push({ ...c, caminho: await subir(sb, job, path.join(p.pastaJob, c.caminho), c) });
    }
    pararLease();
    await concluir(sb, cfg, job, saidas, p.resultado.custos);
    await evento(sb, job, 'Pronto para você aprovar.', { visivel: true });
    await evento(sb, job, p.resultado.resumo, { dados: { turnos: p.resultado.turnos, custos: p.resultado.custos } });
    deuCerto = true;
    log(`pronto: ${saidas.length} arquivos, US$ ${p.resultado.custos.custo_usd.toFixed(4)}, ${p.resultado.custos.render_segundos}s nos apps`);
  } catch (e) {
    const msg = (e as Error).message;
    pararLease();
    if (perdido) return;
    const custos = e instanceof FalhaDoAgente ? e.custos : CUSTO_ZERO;
    const acabou = await devolverOuFalhar(sb, cfg, job, msg, custos);
    await evento(sb, job, msg, { nivel: 'erro', dados: { tentativa: job.tentativas } });
    await evento(sb, job, acabou ? 'A equipe da Bora vai finalizar este pedido.' : 'Estamos refazendo uma parte.', { visivel: true });
    log(`${acabou ? 'FALHOU de vez' : 'volta pra fila'}: ${msg}`);
  } finally {
    pararLease();
    // O editável já está no Storage; a pasta local só fica quando deu errado,
    // pra alguém poder olhar o que o agente deixou.
    if (pasta && deuCerto && !cfg.manterPastaJob) rmSync(pasta, { recursive: true, force: true });
  }
}

async function principal() {
  const cfg = lerConfig();
  // Sem a chave, o SDK cairia no login do Claude Code da máquina, se houver:
  // o custo iria pra conta errada e sumiria da precificação. Melhor não subir.
  if (cfg.agente === 'claude' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não definida (veja worker/.env.exemplo), ou rode com FABRICA_AGENTE=roteiro');
  }
  const agente = cfg.agente === 'roteiro' ? rodarRoteiro : rodarAgente;
  const umaVez = process.argv.includes('--uma-vez');
  const sb = conectar(cfg);
  const skills = carregarSkills(cfg.pastaSkills);
  const instaladas = fontesInstaladas();
  console.log(`fábrica ${cfg.workerId}: ${skills.size} skills, ${instaladas.length} fontes, ${cfg.agente === 'roteiro' ? 'ROTEIRO (sem Claude)' : `modelo ${cfg.modelo}`}`);

  let parar = false;
  const pedirParada = (sinal: string) => {
    console.log(`${sinal}: termino o job atual e saio`);
    parar = true;
  };
  process.on('SIGINT', () => pedirParada('SIGINT'));
  process.on('SIGTERM', () => pedirParada('SIGTERM'));

  while (!parar) {
    let job: Job | null = null;
    try {
      job = await pegarJob(sb, cfg);
    } catch (e) {
      console.error(`fila indisponível: ${(e as Error).message}`);
    }
    if (job) await processar(sb, cfg, skills, instaladas, job, agente);
    if (job && umaVez) break;
    if (!job) await esperar(cfg.esperaFilaMs);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  principal().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

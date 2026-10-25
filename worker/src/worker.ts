// O laço da fábrica: pega um job, produz, confere, sobe, conclui. Um por vez —
// o render do EffectCraft come a CPU inteira, e dois jobs disputando ela
// terminam os dois mais tarde que um depois do outro. Pra mais vazão, mais
// workers (cada um com sua máquina), e a fila já aguenta isso.
//
//   node src/worker.ts            fica escutando a fila
//   node src/worker.ts --uma-vez  espera um job, faz e sai (teste)
//   node src/worker.ts --roteiro  sem o Claude: o passo a passo fixo de src/roteiro.ts
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as esperar } from 'node:timers/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fontesInstaladas, pesoMaisPerto } from './apps.ts';
import { conferirMarca, conferirMotion, conferirTextos, conferirVideo, type Caixa } from './conferencia.ts';
import { projetoDoMotion, SEGUNDOS_ABERTURA, SEGUNDOS_POR_SLIDE } from './motion.ts';
import { exportarAudioFinal } from './reel.ts';
import { listar, sondar, transcrever } from './video.ts';
import { lerConfig, type Config } from './config.ts';
import { rodarAgente, FalhaDoAgente, CUSTO_ZERO, type Agente, type Etapa, type ResultadoAgente } from './agente.ts';
import {
  conectar, pegarJob, renovarLease, anotar, evento, carregarContexto, subir, concluir, devolverOuFalhar,
  historicoDeAjustes, baixarEditaveisBase, baixarElementos, baixarAnexo, baixarSlides, baixarDaBora, juntarSaida, ehJobPerdido, sinalDeVida, soltarOsMeus,
  type Ajuste, type ArquivoDeEntrada, type Elemento, type Job, type Pedido,
} from './fila.ts';
import { montarSistema, montarPedido } from './instrucoes.ts';
import { rodarRoteiro } from './roteiro.ts';
import { agenteDaBora } from './da-bora.ts';
import { coresDaMarca, ehImpacto, marcaParaAgente, resolverFonte, type ClienteParaMarca, type FonteResolvida } from './marca.ts';
import { carregarSkills, escolherSkill, expandirSaidas, type Skill } from './skills.ts';
import { conferirSaida, type SaidaConferida } from './verificar.ts';

export type Producao = {
  pastaJob: string;
  conferidas: SaidaConferida[];
  resultado: ResultadoAgente;
  fonte: FonteResolvida;
  avisos: string[];
};

/**
 * A parte que não fala com o banco: prepara a pasta, roda o agente e confere
 * o que ele salvou — arquivo por arquivo e depois a marca. Separada pra poder
 * ser testada com o roteiro e o PhotoCraft de verdade.
 */
export async function produzir(a: {
  cfg: Config;
  job: Pick<Job, 'id'> & { erro?: string | null; tentativas?: number };
  skill: Skill;
  /** Todas as skills, pras que esta usa (copy-e-hashtags). */
  skills?: Map<string, Skill>;
  pedido: Pedido;
  cliente: ClienteParaMarca;
  instaladas: string[];
  agente: Agente;
  abortar: AbortController;
  aoMudarEtapa: (e: Etapa) => Promise<void>;
  aoUsarFerramenta: (nome: string, ms: number, falhou: boolean) => void;
  /** Rodada de ajuste: o que foi pedido até aqui. */
  ajustes?: Ajuste[];
  /** Arquivos que vão pra entrada/: a versão anterior, os elementos da marca e o vídeo bruto. */
  arquivos?: ArquivoDeEntrada[];
  elementos?: Elemento[];
  /** Sobe na hora uma saída pronta (a prévia). Fora do worker (testes), não faz nada. */
  entregarParcial?: (caminho: string) => Promise<void>;
  /** Entrega da equipe: o vídeo já está editado, não há o que transcrever. */
  semPreparo?: boolean;
}): Promise<Producao> {
  const pastaJob = path.join(a.cfg.pastaJobs, a.job.id);
  // Tentativa anterior pode ter deixado arquivo pela metade: começa limpo.
  rmSync(pastaJob, { recursive: true, force: true });
  for (const sub of ['entrada', 'saida', 'editavel']) mkdirSync(path.join(pastaJob, sub), { recursive: true });
  for (const f of a.arquivos ?? []) {
    const destino = path.join(pastaJob, 'entrada', f.nome);
    mkdirSync(path.dirname(destino), { recursive: true });
    writeFileSync(destino, f.conteudo);
  }
  const temAnterior = (a.arquivos ?? []).some((f) => f.nome.startsWith('anterior/'));

  // Skill de vídeo: a transcrição sai antes do agente, pelo whisper.cpp. O
  // agente não tem como rodar programa — e transcrever não é decisão dele.
  let bruto: string | null = null;
  if (a.skill.entrada === 'video') {
    bruto = listar(path.join(pastaJob, 'entrada'), /^bruto\./)[0] ?? null;
    if (!bruto) throw new FalhaDoAgente('o pedido não trouxe o vídeo', CUSTO_ZERO);
  }
  if (bruto && !a.semPreparo) {
    await a.aoMudarEtapa({ etapa: 'ouvindo o vídeo', progresso: 4 });
    const trabalho = path.join(pastaJob, '.trabalho');
    mkdirSync(trabalho, { recursive: true });
    const palavras = await transcrever(trabalho, bruto);
    if (palavras.length < 3) throw new FalhaDoAgente('não deu pra ouvir fala no vídeo', CUSTO_ZERO);
    writeFileSync(path.join(pastaJob, 'entrada', 'transcricao.json'), JSON.stringify(palavras));
    writeFileSync(path.join(pastaJob, 'entrada', 'transcricao.txt'), palavras.map((p) => p.texto).join(' '));
  }

  const m = a.cliente.marca ?? {};
  const fonte = resolverFonte(m.fonteMarca, m.fonteFalback, a.instaladas);
  const pesos = { titulo: pesoMaisPerto(fonte.usada, 700), texto: pesoMaisPerto(fonte.usada, 500) };
  const { texto: marca, conjunto, conjuntos } = marcaParaAgente(a.cliente, fonte, { pesos });
  const ajustes = a.ajustes ?? [];
  const saidas = expandirSaidas(a.skill, a.pedido.briefing);
  const elementos = a.elementos ?? [];
  // Só repete o motivo quando é de fato uma nova tentativa do mesmo job.
  const erroAnterior = (a.job.tentativas ?? 1) > 1 ? a.job.erro ?? null : null;

  const resultado = await a.agente({
    cfg: a.cfg,
    skill: a.skill,
    pastaJob,
    sistema: montarSistema(a.skill, a.skills),
    pedido: montarPedido(a.skill, a.pedido, marca, { saidas, ajustes, temAnterior, elementos, erroAnterior }),
    dados: {
      conjunto,
      conjuntos,
      ajustes,
      fonte: fonte.usada,
      pesos,
      impacto: ehImpacto(m, fonte),
      margem: m.margem === 'folgada' ? 96 : 72,
      alinhamento: m.alinha === 'centro' ? 'center' : 'left',
      textoDoCliente: String(a.pedido.briefing?.texto ?? a.pedido.titulo ?? ''),
      briefing: a.pedido.briefing ?? {},
      instagram: a.cliente.instagram ? (a.cliente.instagram.startsWith('@') ? a.cliente.instagram : '@' + a.cliente.instagram) : null,
      chamada: m.chamada || null,
      hashtags: m.hashtags || null,
      registro: a.cliente.registro_profissional,
      numerar: Boolean(m.numerar),
      semEmoji: /emoji/i.test(m.evitar ?? ''),
      saidas,
      elementos,
    },
    abortar: a.abortar,
    aoMudarEtapa: a.aoMudarEtapa,
    aoUsarFerramenta: a.aoUsarFerramenta,
    entregarParcial: a.entregarParcial ?? (async () => {}),
  });

  // Reprovou em qualquer conferência: o que o agente gastou continua contando,
  // e o motivo vai pro job — a próxima tentativa recebe ele no pedido.
  let conferidas: SaidaConferida[];
  try {
    conferidas = saidas.map((s) => conferirSaida(pastaJob, s));
  } catch (e) {
    throw new FalhaDoAgente(`reprovado na conferência: ${(e as Error).message}`, resultado.custos);
  }
  const daMarca = conferirMarca(pastaJob, conferidas, { cores: coresDaMarca(a.cliente), fontes: [fonte.usada] });
  const dosTextos = conferirTextos(pastaJob, conferidas, { semEmoji: /emoji/i.test(m.evitar ?? '') });
  const slides = listar(path.join(pastaJob, 'entrada', 'slides'), /^slide-\d+\.png$/).length;
  const doVideo = bruto
    ? conferirVideo(pastaJob, conferidas, {
        cores: coresDaMarca(a.cliente),
        segundosBruto: sondar(bruto).segundos,
        medirSom: (wav) => exportarAudioFinal(path.join(pastaJob, 'editavel', 'reel.fcproj'), wav),
      })
    : a.skill.apps.includes('effectcraft')
      ? conferirMotion(pastaJob, conferidas, {
          cores: coresDaMarca(a.cliente),
          fonte: fonte.usada,
          projeto: projetoDoMotion({ pastaJob, skill: a.skill }),
          ...(a.skill.entrada === 'slides'
            ? {
                segundos: slides * SEGUNDOS_POR_SLIDE + 0.5,
                // Cada imagem parada no meio do tempo dela; a área da imagem não conta.
                momentos: Array.from({ length: slides }, (_, i) => i * SEGUNDOS_POR_SLIDE + 1.5),
                areaDaImagem: [40, 220, 1040, 1480] as Caixa,
              }
            : { segundos: SEGUNDOS_ABERTURA, momentos: [3.5, SEGUNDOS_ABERTURA - 0.1] }),
        })
      : { erros: [], avisos: [] };
  const erros = [...daMarca.erros, ...dosTextos.erros, ...doVideo.erros];
  if (erros.length) {
    throw new FalhaDoAgente(`reprovado na conferência de marca: ${erros.slice(0, 6).join('; ')}`, resultado.custos);
  }
  return { pastaJob, conferidas, resultado, fonte, avisos: [...daMarca.avisos, ...dosTextos.avisos, ...doVideo.avisos] };
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
    // A primeira linha que o cliente lê, uma por rodada — e só na primeira
    // tentativa: um job que volta pra fila não "começa" de novo pra quem espera.
    const daBora = job.rodada === 'da_bora';
    if (job.tentativas === 1) {
      await evento(sb, job, daBora ? 'A equipe da Bora terminou. Estamos conferindo antes de te mostrar.'
        : job.rodada === 'ajuste' ? 'Recebemos o seu pedido de ajuste.' : 'Começamos a produzir o seu pedido.', { visivel: true });
    }

    const { pedido, cliente } = await carregarContexto(sb, job);
    // Na entrega da equipe, o que entregar vem do tipo do pedido, não da skill
    // da rodada que travou — ela pode ter sido justamente o problema.
    const skill = escolherSkill(skills, pedido.tipo, daBora ? null : job.skill, pedido.briefing);
    if (job.skill !== skill.nome) await sb.from('jobs').update({ skill: skill.nome }).eq('id', job.id);
    await sb.from('pedidos').update({ estado: 'produzindo' }).eq('id', job.pedido_id).in('estado', ['rascunho', 'produzindo']);
    log(`skill ${skill.nome}, apps ${skill.apps.join(', ')}${job.rodada === 'ajuste' ? ' (ajuste)' : ''}`);

    const ajustes = await historicoDeAjustes(sb, job);
    const anteriores = job.rodada === 'ajuste' ? await baixarEditaveisBase(sb, job) : [];
    const { elementos, arquivos } = await baixarElementos(sb, job);
    const anexo = skill.entrada === 'video' ? await baixarAnexo(sb, pedido)
      : skill.entrada === 'slides' ? await baixarSlides(sb, pedido) : [];
    const daEquipe = daBora ? await baixarDaBora(sb, job) : [];

    let etapaAtual = '';
    const p = await produzir({
      entregarParcial: async (caminho) => {
        const esperada = expandirSaidas(skill, pedido.briefing).find((s) => s.caminho === caminho);
        if (!esperada) return;
        const pastaDoJob = path.join(cfg.pastaJobs, job.id);
        const c = conferirSaida(pastaDoJob, esperada);
        await juntarSaida(sb, cfg, job, { ...c, caminho: await subir(sb, job, path.join(pastaDoJob, caminho), c) });
        await evento(sb, job, 'A prévia está pronta.', { visivel: true });
        log(`entregue antes: ${caminho}`);
      },
      cfg, job, skill, skills, pedido, cliente, instaladas, abortar, ajustes, elementos,
      agente: daBora ? agenteDaBora : agente,
      semPreparo: daBora,
      arquivos: [...anteriores, ...arquivos, ...anexo, ...daEquipe],
      // O render de motion manda a mesma etapa a cada dois segundos, com quanto
      // falta: o histórico do cliente ganha uma linha só por etapa.
      aoMudarEtapa: async ({ etapa, progresso, restamSegundos }) => {
        const nova = etapa !== etapaAtual;
        etapaAtual = etapa;
        if (nova) log(`etapa: ${etapa} (${progresso}%)`);
        await anotar(sb, cfg, job, { etapa, progresso, restam_segundos: restamSegundos ?? null });
        if (nova) await evento(sb, job, etapa, { visivel: true });
      },
      aoUsarFerramenta: (nome, ms, falhou) => {
        void evento(sb, job, `${nome} ${falhou ? 'falhou' : 'ok'} em ${ms} ms`, { nivel: falhou ? 'aviso' : 'info', dados: { ferramenta: nome, ms } });
      },
    });
    pasta = p.pastaJob;
    if (p.fonte.substituida) {
      await evento(sb, job, `fonte "${p.fonte.pedida}" não instalada; usada "${p.fonte.usada}"`, { nivel: 'aviso' });
    }
    for (const a of p.avisos) await evento(sb, job, a, { nivel: 'aviso' });

    await anotar(sb, cfg, job, { etapa: 'finalizando', progresso: 95, restam_segundos: null });
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
    // A Bora assumiu no meio: o job já está cancelado e a versão dela vale.
    if (ehJobPerdido(e)) { log(msg); return; }
    const custos = e instanceof FalhaDoAgente ? e.custos : CUSTO_ZERO;
    let acabou: boolean;
    try {
      acabou = await devolverOuFalhar(sb, cfg, job, msg, custos);
    } catch (e2) {
      if (ehJobPerdido(e2)) { log((e2 as Error).message); return; }
      throw e2;
    }
    await evento(sb, job, msg, { nivel: 'erro', dados: { tentativa: job.tentativas } });
    const paraOCliente = !acabou
      ? 'Estamos refazendo uma parte.'
      : job.rodada === 'da_bora'
        ? 'A equipe da Bora está revendo um detalhe antes de te mostrar.'
        : job.rodada === 'ajuste'
          ? 'Não conseguimos fazer esse ajuste. A versão anterior continua aqui, e a equipe da Bora já foi avisada.'
          : 'A equipe da Bora vai finalizar este pedido.';
    await evento(sb, job, paraOCliente, { visivel: true });
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
  // No Windows não existe SIGTERM de verdade: o vigia pede pra parar por aqui.
  process.on('message', (m) => { if ((m as { parar?: boolean })?.parar) pedirParada('vigia'); });

  // Voltou depois de cair (o vigia religa com o mesmo nome): o que ficou
  // rodando volta pra fila agora.
  try {
    const soltos = await soltarOsMeus(sb, cfg);
    if (soltos) console.log(`${soltos} job(s) que ficaram pela metade voltaram pra fila`);
  } catch (e) {
    console.error(`não deu pra soltar os jobs antigos: ${(e as Error).message}`);
  }

  // Sinal de vida e faxina rodam à parte do laço: um reel de dois minutos
  // não pode fazer a Fábrica parecer desligada.
  let ocupado: string | null = null;
  const sinal = (ligou: boolean) => sinalDeVida(sb, cfg, { ocupado, ligou })
    .catch((e) => console.error(`sinal de vida falhou: ${(e as Error).message}`));
  await sinal(true);
  const batimento = setInterval(() => void sinal(false), 30_000);
  limparPastasVelhas(cfg);
  const faxina = setInterval(() => limparPastasVelhas(cfg), 6 * 3600_000);

  while (!parar) {
    let job: Job | null = null;
    try {
      job = await pegarJob(sb, cfg);
    } catch (e) {
      console.error(`fila indisponível: ${(e as Error).message}`);
    }
    if (job) {
      ocupado = job.id;
      void sinal(false);
      await processar(sb, cfg, skills, instaladas, job, agente);
      ocupado = null;
    }
    if (job && umaVez) break;
    if (!job) await esperar(cfg.esperaFilaMs);
  }
  clearInterval(batimento);
  clearInterval(faxina);
}

/**
 * Pasta de job que falhou fica pra alguém olhar o que a fábrica deixou; passados
 * os dias combinados, sai. Num PC pessoal, vídeo de cliente não pode acumular.
 */
export function limparPastasVelhas(cfg: Pick<Config, 'pastaJobs' | 'diasPastaFalha'>, agora = Date.now()): string[] {
  if (!existsSync(cfg.pastaJobs)) return [];
  const limite = agora - cfg.diasPastaFalha * 86_400_000;
  const apagadas: string[] = [];
  for (const nome of readdirSync(cfg.pastaJobs)) {
    const p = path.join(cfg.pastaJobs, nome);
    try {
      if (statSync(p).mtimeMs < limite) { rmSync(p, { recursive: true, force: true }); apagadas.push(nome); }
    } catch { /* sumiu entre a listagem e agora: tanto faz */ }
  }
  if (apagadas.length) console.log(`faxina: ${apagadas.length} pasta(s) de job com mais de ${cfg.diasPastaFalha} dias`);
  return apagadas;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  // Sai de propósito ao terminar: o canal com o vigia (e as conexões do
  // Supabase) manteriam o processo de pé depois do "desligar".
  principal().then(() => process.exit(0), (e) => {
    console.error(e);
    process.exit(1);
  });
}

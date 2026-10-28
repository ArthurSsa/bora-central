// A rodada de edição do Studio: a equipe mexeu nas camadas na Central (arrastou,
// aumentou, trocou o texto, escondeu, trocou a cor por outra da marca, mudou a
// ordem), e aqui isso vira comandos do PhotoCraft em cima do PSD da versão de
// que a edição parte. Sem o Claude: o que fazer já está decidido, camada por
// camada. Depois vem a conferência de sempre — o Studio também não passa sem.
//
// O Studio manda, por camada, o quanto ela andou e cresceu a partir da área que
// tinha (dx, dy, escala), e não onde ela termina: um título que ganha uma
// palavra quebra linha e muda de área, e o "pra onde arrastei" continua valendo.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { CUSTO_ZERO, FalhaDoAgente, type Agente } from './agente.ts';
import type { Camadas } from './camadas.ts';

export type EdicaoDeCamada = {
  id: number;
  /** O nome que a camada tinha quando o Studio abriu: confere que é a mesma. */
  nome: string;
  dx?: number;
  dy?: number;
  escala?: number;
  visivel?: boolean;
  texto?: string;
  cor?: string;
};

export type EdicaoDaImagem = {
  /** post, slide-03, capa-2: o nome do PSD sem a extensão. */
  base: string;
  camadas: EdicaoDeCamada[];
  /** A ordem nova, de cima pra baixo, sem o fundo. Ausente: a ordem não mudou. */
  ordem?: number[];
};

export type Edicao = { imagens: EdicaoDaImagem[] };

type Comando = { cmd: string; params: Record<string, unknown> };

const MAX_TEXTO = 500;

/**
 * Os comandos do PhotoCraft que levam a imagem do jeito que estava ao jeito que
 * o Studio mostrou. Recusa o que o Studio não deveria ter deixado: cor fora da
 * marca, texto em camada que não é de texto, mexer no fundo.
 */
export function comandosDaEdicao(orig: Camadas, ed: EdicaoDaImagem, cores: string[]): Comando[] {
  const porId = new Map(orig.camadas.map((c) => [c.id, c]));
  const daMarca = new Set(cores.map((c) => c.toUpperCase()));
  const conteudo: Comando[] = [];
  const posicao: Comando[] = [];
  for (const e of ed.camadas) {
    const c = porId.get(e.id);
    if (!c || c.nome !== e.nome) throw new Error(`${ed.base}: a camada "${e.nome}" não está mais nessa versão; abra o Studio de novo`);
    if (e.texto !== undefined) {
      if (c.tipo !== 'texto') throw new Error(`${ed.base}: "${c.nome}" não é texto`);
      const t = e.texto.replace(/\r\n?/g, '\n').trim();
      if (!t) throw new Error(`${ed.base}: o texto de "${c.nome}" ficou vazio; esconda a camada em vez de apagar o texto`);
      if (t.length > MAX_TEXTO) throw new Error(`${ed.base}: o texto de "${c.nome}" passou de ${MAX_TEXTO} letras`);
      if (t !== c.texto?.conteudo) conteudo.push({ cmd: 'type.edit', params: { layer: c.id, text: t } });
    }
    if (e.cor !== undefined) {
      const cor = e.cor.toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(cor) || !daMarca.has(cor)) throw new Error(`${ed.base}: ${e.cor} não é uma cor da marca`);
      const atual = (c.texto?.cor ?? c.cor)?.toUpperCase();
      if (cor !== atual) {
        if (c.tipo === 'texto') conteudo.push({ cmd: 'type.setStyle', params: { layer: c.id, color: cor } });
        else if (c.tipo === 'forma') conteudo.push({ cmd: 'layer.fill.solidColor.set', params: { layer: c.id, color: cor } });
        else throw new Error(`${ed.base}: a cor de "${c.nome}" não se troca pelo Studio`);
      }
    }
    if (e.visivel !== undefined && e.visivel !== c.visivel) {
      conteudo.push({ cmd: 'layer.setProps', params: { layer: c.id, visible: e.visivel } });
    }
    const dx = Math.round(e.dx ?? 0), dy = Math.round(e.dy ?? 0), escala = e.escala ?? 1;
    if (![dx, dy, escala].every(Number.isFinite) || Math.abs(dx) > orig.largura * 2 || Math.abs(dy) > orig.altura * 2) {
      throw new Error(`${ed.base}: posição de "${c.nome}" fora da peça`);
    }
    if (escala < 0.1 || escala > 10) throw new Error(`${ed.base}: "${c.nome}" não cresce nem encolhe tanto (${escala}×)`);
    if (dx || dy || Math.abs(escala - 1) > 0.001) {
      if (c.tipo === 'fundo') throw new Error(`${ed.base}: o fundo não sai do lugar`);
      if (!c.largura || !c.altura) continue; // camada vazia: não há o que mover
      // Da área de antes pra de depois; o canto de cima à esquerda é o que o Studio arrastou.
      const x0 = c.x + dx, y0 = c.y + dy;
      const x1 = x0 + Math.round(c.largura * escala * 100) / 100, y1 = y0 + Math.round(c.altura * escala * 100) / 100;
      posicao.push({ cmd: 'edit.transform', params: {
        layer: c.id,
        rect: [c.x, c.y, c.x + c.largura, c.y + c.altura],
        quad: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      } });
    }
  }

  // A ordem: cada uma logo abaixo da anterior, de cima pra baixo. O fundo fica onde está.
  const ordem: Comando[] = [];
  const antes = orig.camadas.filter((c) => c.tipo !== 'fundo').map((c) => c.id);
  if (ed.ordem && ed.ordem.join() !== antes.join()) {
    if (ed.ordem.length !== antes.length || [...ed.ordem].sort((a, b) => a - b).join() !== [...antes].sort((a, b) => a - b).join()) {
      throw new Error(`${ed.base}: a ordem das camadas não bate com a versão; abra o Studio de novo`);
    }
    for (let i = 1; i < ed.ordem.length; i++) {
      ordem.push({ cmd: 'layer.moveTo', params: { layer: ed.ordem[i], target: ed.ordem[i - 1], position: 'below' } });
    }
  }
  // O texto antes de mover: mover usa a área de antes, e o texto novo já cai no lugar certo.
  return [...conteudo, ...posicao, ...ordem];
}

/** Aplica no PSD e exporta o PNG da peça, numa chamada só; o PSD só é trocado se tudo deu certo. */
function aplicar(pastaJob: string, orig: Camadas, comandos: Comando[]) {
  const cli = acharCli('photocraft');
  const psd = path.join(pastaJob, orig.psd);
  const png = path.join(pastaJob, orig.png);
  // Os ids do PSD são os de quando ele foi lido: confere que a camada de cada id ainda tem o nome que o Studio viu.
  const info = JSON.parse(execFileSync(cli, ['info', psd, '--compact'], { encoding: 'utf8', timeout: 60_000 }));
  const nomes = new Map<number, string>((info.layers as Array<{ id: number; name: string }>).map((l) => [l.id, l.name]));
  const trocada = orig.camadas.find((c) => nomes.get(c.id) !== c.nome);
  if (trocada) throw new Error(`${orig.base}: as camadas do PSD não batem com as do Studio ("${trocada.nome}")`);

  const novo = psd.replace(/\.psd$/, '.editado.psd');
  rmSync(png, { force: true });
  rmSync(novo, { force: true });
  const args = ['run', psd];
  for (const c of comandos) args.push('--cmd', c.cmd, '--params', JSON.stringify(c.params));
  args.push('--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: png }), '--out', novo);
  try {
    execFileSync(cli, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`${orig.base}: o PhotoCraft não aplicou a edição (${(err.stderr || err.message).trim().split('\n').pop()})`);
  }
  if (!existsSync(novo) || !existsSync(png)) throw new Error(`${orig.base}: o PhotoCraft não salvou a edição`);
  renameSync(novo, psd);
}

export function lerEdicao(arquivo: string): Edicao {
  const e = JSON.parse(readFileSync(arquivo, 'utf8')) as Edicao;
  if (!Array.isArray(e?.imagens) || !e.imagens.length) throw new Error('a edição não trouxe nenhuma imagem');
  for (const i of e.imagens) {
    if (typeof i.base !== 'string' || !/^[a-z0-9-]+$/.test(i.base)) throw new Error(`imagem com nome estranho na edição: ${String(i.base)}`);
    if (!Array.isArray(i.camadas)) throw new Error(`${i.base}: a edição não diz as camadas`);
  }
  return e;
}

/**
 * O "agente" da rodada de edição. A versão de que ela parte está inteira em
 * entrada/base/ (o que a skill entrega, os PSDs e a lista de camadas que o
 * Studio mostrou), e a edição em entrada/edicao.json.
 */
export const agenteDeEdicao: Agente = async (p) => {
  const inicio = Date.now();
  await p.aoMudarEtapa({ etapa: 'aplicando o ajuste fino da equipe', progresso: 30 });
  const base = path.join(p.pastaJob, 'entrada', 'base');
  const faltam: string[] = [];
  for (const s of p.dados.saidas) {
    const origem = path.join(base, s.caminho);
    if (!existsSync(origem)) { faltam.push(s.caminho); continue; }
    mkdirSync(path.dirname(path.join(p.pastaJob, s.caminho)), { recursive: true });
    copyFileSync(origem, path.join(p.pastaJob, s.caminho));
  }
  if (faltam.length) throw new FalhaDoAgente(`a versão de que a edição parte não tem: ${faltam.join(', ')}`, CUSTO_ZERO);

  let edicao: Edicao;
  try {
    edicao = lerEdicao(path.join(p.pastaJob, 'entrada', 'edicao.json'));
  } catch (e) {
    throw new FalhaDoAgente((e as Error).message, CUSTO_ZERO);
  }
  let comandos = 0;
  for (const img of edicao.imagens) {
    const lista = path.join(base, 'camadas', img.base, 'camadas.json');
    try {
      if (!existsSync(lista)) throw new Error(`${img.base}: essa imagem não tem camadas na versão de que a edição parte`);
      const orig = JSON.parse(readFileSync(lista, 'utf8')) as Camadas;
      if (!p.dados.saidas.some((s) => s.caminho === orig.psd)) throw new Error(`${img.base}: o PSD não é desta peça`);
      const cmds = comandosDaEdicao(orig, img, p.dados.cores ?? []);
      if (!cmds.length) continue;
      aplicar(p.pastaJob, orig, cmds);
      comandos += cmds.length;
    } catch (e) {
      throw new FalhaDoAgente((e as Error).message, { ...CUSTO_ZERO, render_segundos: (Date.now() - inicio) / 1000 });
    }
  }
  if (!comandos) throw new FalhaDoAgente('nada mudou em relação à versão de que a edição parte', CUSTO_ZERO);
  await p.aoMudarEtapa({ etapa: 'conferindo o ajuste fino', progresso: 80 });
  return {
    custos: { ...CUSTO_ZERO, render_segundos: Math.round((Date.now() - inicio) / 10) / 100 },
    resumo: `Edição do Studio: ${comandos} mudança(s) em ${edicao.imagens.length} imagem(ns), aplicadas no PSD pelo PhotoCraft.`,
    turnos: 0,
  };
};

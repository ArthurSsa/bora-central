// A cena do Bora v2 (ADR 0001, D1 e D2): o que o Studio guarda e mostra, e o
// que a fábrica exporta. Uma cena é um fundo e uma lista de objetos, de baixo
// pra cima, em px do formato. O navegador desenha a cena com o Konva; a fábrica
// desenha a mesma cena no PhotoCraft (PSD com uma camada por objeto, e o PNG).
//
// Este arquivo é a versão 1, mínima: texto, forma e imagem, sem rotação nem
// animação. Ela existe primeiro pra medir se as duas pontas desenham igual.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';

export type Alinhamento = 'left' | 'center' | 'right';

export type ObjetoTexto = {
  tipo: 'texto'; id: string; x: number; y: number;
  /** A largura da caixa: o texto quebra linha nela. */
  largura: number;
  texto: string; fonte: string; peso: number;
  /** Em px do formato. */
  tamanho: number;
  cor: string; alinhamento: Alinhamento;
  /** A distância entre linhas, em múltiplos do tamanho. */
  entrelinha: number;
};
export type ObjetoForma = { tipo: 'forma'; id: string; x: number; y: number; largura: number; altura: number; cor: string };
export type ObjetoImagem = { tipo: 'imagem'; id: string; x: number; y: number; largura: number; altura: number; arquivo: string };
export type Objeto = ObjetoTexto | ObjetoForma | ObjetoImagem;

export type Cena = { versao: 1; nome: string; largura: number; altura: number; fundo: string; objetos: Objeto[] };

type Comando = { cmd: string; params: Record<string, unknown> };

/**
 * Os comandos do PhotoCraft que desenham a cena, um objeto por camada e na
 * mesma ordem. O texto é de caixa: quebra linha na largura do objeto, com a
 * entrelinha em pt (no PSD de 72 ppi, pt e px são o mesmo).
 */
export function comandosDaCena(cena: Cena, pastaDasImagens = '.'): Comando[] {
  const cmds: Comando[] = [];
  for (const o of cena.objetos) {
    if (o.tipo === 'texto') {
      cmds.push({ cmd: 'type.create', params: {
        text: o.texto, name: o.id, box: [o.x, o.y, o.largura, Math.max(cena.altura - o.y, o.tamanho * 2)],
        font: o.fonte, weight: o.peso, size: o.tamanho, color: o.cor, align: o.alinhamento, leading: Math.round(o.tamanho * o.entrelinha * 100) / 100,
      } });
    } else if (o.tipo === 'forma') {
      cmds.push({ cmd: 'shape.create', params: { kind: 'rect', rect: [o.x, o.y, o.largura, o.altura], fill: o.cor, name: o.id } });
    } else {
      cmds.push({ cmd: 'file.placeEmbedded', params: { path: path.resolve(pastaDasImagens, o.arquivo), center: [o.x + o.largura / 2, o.y + o.altura / 2], fit: false, smartObject: true } });
      cmds.push({ cmd: 'layer.setProps', params: { name: o.id } });
    }
  }
  return cmds;
}

const baselines = new Map<string, number>();

/**
 * Onde o PhotoCraft põe a linha de base da primeira linha de uma caixa de
 * texto, em proporção do tamanho da letra (0,72 = 72% do tamanho abaixo do
 * topo da caixa). Depende só da fonte e do peso — a entrelinha não mexe na
 * primeira linha, só na distância entre as seguintes. O Studio usa isso pra pôr
 * o texto onde a exportação vai pôr (o Konva centraliza cada linha na
 * entrelinha, o PhotoCraft não).
 */
export function baselineDaFabrica(fonte: string, peso: number): number {
  const chave = `${fonte}|${peso}`;
  const salvo = baselines.get(chave);
  if (salvo != null) return salvo;
  const r = execFileSync(acharCli('photocraft'), ['run', '--new', JSON.stringify({ width: 400, height: 400 }),
    '--cmd', 'type.create', '--params', JSON.stringify({ text: 'H', box: [0, 0, 400, 400], font: fonte, weight: peso, size: 100, leading: 100 }),
    '--cmd', 'type.info', '--params', '{}'], { encoding: 'utf8', timeout: 60_000 });
  const info = r.split(/\r?\n/).filter((l) => l.includes('"type.info"')).map((l) => JSON.parse(l).result)[0];
  const valor = info.lines[0].baseline / 100;
  baselines.set(chave, valor);
  return valor;
}

/** As linhas que o PhotoCraft quebrou em cada texto, na ordem dos objetos de texto. */
export type LinhasDoTexto = { id: string; linhas: string[]; caixa: [number, number, number, number] };

/**
 * Exporta a cena pelo PhotoCraft: <saida>/<nome>.psd e .png. Devolve as linhas
 * de cada texto como o PhotoCraft quebrou — é isso que o navegador vai ter que
 * mostrar igual.
 */
export function exportarCena(cena: Cena, saida: string, pastaDasImagens = '.'): { psd: string; png: string; textos: LinhasDoTexto[] } {
  const cli = acharCli('photocraft');
  mkdirSync(saida, { recursive: true });
  const psd = path.join(saida, `${cena.nome}.psd`), png = path.join(saida, `${cena.nome}.png`);
  rmSync(png, { force: true });
  const args = ['run', '--new', JSON.stringify({ width: cena.largura, height: cena.altura, background: cena.fundo, name: cena.nome })];
  for (const c of comandosDaCena(cena, pastaDasImagens)) args.push('--cmd', c.cmd, '--params', JSON.stringify(c.params));
  args.push('--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: png }), '--out', psd);
  const saidaRun = execFileSync(cli, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const criados = saidaRun.split(/\r?\n/).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))
    .filter((l) => l.command === 'type.create').map((l) => l.result.layer as number);

  // As linhas: type.info dá, por linha, onde ela começa e termina no texto.
  const textos = cena.objetos.filter((o): o is ObjetoTexto => o.tipo === 'texto');
  const info: Array<{ text: string; bounds: number[]; lines: Array<{ start: number; end: number }> }> = [];
  if (criados.length) {
    const args2 = ['run', psd];
    // Os ids mudam ao salvar e abrir de novo: pega os do PSD salvo, na ordem de baixo pra cima.
    const doc = JSON.parse(execFileSync(cli, ['info', psd, '--compact'], { encoding: 'utf8', timeout: 60_000 }));
    const ids = (doc.layers as Array<{ id: number; kind: string }>).filter((l) => l.kind === 'Type').map((l) => l.id).reverse();
    for (const id of ids) args2.push('--cmd', 'type.info', '--params', JSON.stringify({ layer: id }));
    for (const l of execFileSync(cli, args2, { encoding: 'utf8', timeout: 60_000 }).split(/\r?\n/).filter((x) => x.includes('"type.info"'))) info.push(JSON.parse(l).result);
  }
  return {
    psd, png,
    textos: textos.map((t, i) => ({
      id: t.id,
      linhas: (info[i]?.lines ?? []).map((l) => info[i].text.slice(l.start, l.end).replace(/\s+$/, '')),
      caixa: (info[i]?.bounds ?? [0, 0, 0, 0]) as [number, number, number, number],
    })),
  };
}

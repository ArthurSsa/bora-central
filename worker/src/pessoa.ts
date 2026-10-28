// A pessoa no post: a foto que o cliente mandou vira peça com ela dentro.
//
//   1. prepararPessoa — antes do agente, uma vez: acha o rosto, acerta luz e
//      cor, recorta a pessoa e mede se o recorte presta. Fica em entrada/pessoa/.
//   2. montarPostComPessoa — o post, em um de dois jeitos:
//        recorte  a pessoa recortada sobre o fundo da marca, com a borda de
//                 baixo do recorte escondida na borda de baixo do post;
//        foto     a foto cobrindo o post, o rosto no terço de cima, e o texto
//                 sobre uma faixa da cor da marca que nasce da borda.
//      O recorte só vale quando passou na medida; senão vai a foto inteira, que
//      fica boa com qualquer foto.
//   3. conferirPessoa — no PNG entregue, não no que o roteiro quis fazer: o
//      rosto é achado de novo, tem que estar dentro da margem segura, inteiro
//      (a cabeça não pode sair cortada) e sem texto por cima.
//
// O recorte do PhotoCraft sozinho (select.subject) pega a cena inteira numa
// foto com fundo cheio; guiado pelo rosto (select.object num retângulo em volta
// do corpo e outro em volta da cabeça) ele separa a pessoa limpo. O que fica de
// fora é o que sai longe do corpo — uma mão levantada, um objeto estendido.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acharCli } from './config.ts';
import { areaDoAlfa } from './camadas.ts';
import { escreverPng, lerPngRgba } from './png.ts';
import type { Conjunto } from './marca.ts';
import type { Elemento } from './fila.ts';
import { logoParaOFundo } from './vetor.ts';
import { listar } from './video.ts';

export const PASTA_PESSOA = 'entrada/pessoa';
type Caixa = [number, number, number, number];

export type Rosto = { rect: Caixa; score: number; olhos: [number, number][] };

export type AnaliseDaPessoa = {
  /** A foto tratada (luz e cor), em entrada/pessoa/. */
  foto: string;
  largura: number;
  altura: number;
  rosto: Rosto;
  /** A foto já vem com a cabeça cortada em cima: nenhum jeito de montar conserta. */
  cabecaCortada: boolean;
  recorte: {
    arquivo: string;
    /** Onde o recorte (só a área com pixel) fica na foto tratada. */
    area: Caixa;
    /** Quanto do rosto e do alto da cabeça ficou dentro do recorte, de 0 a 1. */
    cobreRosto: number;
    cobreTopo: number;
    ok: boolean;
    motivo: string | null;
  };
};

const MAIOR_LADO = 2400;

function rodar(args: string[]): Array<{ command: string; result: any }> {
  return execFileSync(acharCli('photocraft'), args, { encoding: 'utf8', timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'] })
    .split(/\r?\n/).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}

/** O rosto da foto: o mais confiável entre os grandes. Rosto tatuado ou num quadro na parede é menor e vem com nota baixa. */
export function escolherRosto(faces: Array<{ score: number; rect: number[]; landmarks?: Record<string, number[]> }>): Rosto | null {
  const bons = faces.filter((f) => f.score >= 0.6);
  if (!bons.length) return null;
  const maior = Math.max(...bons.map((f) => f.rect[2] * f.rect[3]));
  const f = bons.filter((x) => x.rect[2] * x.rect[3] >= maior * 0.5).sort((a, b) => b.score - a.score)[0];
  const lm = f.landmarks ?? {};
  return {
    rect: f.rect.map((v) => Math.round(v)) as Caixa,
    score: Math.round(f.score * 1000) / 1000,
    olhos: [lm.rightEye, lm.leftEye].filter(Boolean).map((p) => [Math.round(p[0]), Math.round(p[1])] as [number, number]),
  };
}

/** Retângulos em volta do corpo e da cabeça, a partir do rosto, presos dentro da foto. */
export function retangulosDaPessoa(r: Caixa, largura: number, altura: number): { corpo: Caixa; cabeca: Caixa } {
  const [x, y, w, h] = r;
  const preso = (c: Caixa): Caixa => {
    const x0 = Math.max(0, Math.round(c[0])), y0 = Math.max(0, Math.round(c[1]));
    const x1 = Math.min(largura, Math.round(c[0] + c[2])), y1 = Math.min(altura, Math.round(c[1] + c[3]));
    return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
  };
  return {
    corpo: preso([x - 1.6 * w, y - 0.6 * h, 4.2 * w, altura]),
    cabeca: preso([x - 0.5 * w, y - 0.9 * h, 2 * w, 1.4 * h]),
  };
}

/** Quanto de uma caixa da foto tem alfa acima da metade; caixa fora da foto conta como coberta. */
function cobertura(img: { largura: number; altura: number; rgba: Uint8Array }, [x, y, w, h]: Caixa): number {
  let n = 0, cheio = 0;
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(img.altura, Math.round(y + h)); yy++) {
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(img.largura, Math.round(x + w)); xx++) {
      n++;
      if (img.rgba[(yy * img.largura + xx) * 4 + 3] > 128) cheio++;
    }
  }
  return n ? cheio / n : 1;
}

/** O recorte presta: o rosto inteiro, o alto da cabeça (cabelo, boné), e não a cena toda. */
export function julgarRecorte(m: { cobreRosto: number; cobreTopo: number; fracaoDaFoto: number }): string | null {
  if (m.cobreRosto < 0.9) return `o recorte pegou só ${Math.round(m.cobreRosto * 100)}% do rosto`;
  if (m.cobreTopo < 0.35) return 'o recorte cortou o alto da cabeça';
  if (m.fracaoDaFoto > 0.8) return 'o recorte pegou a cena inteira, não só a pessoa';
  return null;
}

/**
 * Trata e recorta a foto em entrada/pessoa/origem.*: grava foto.png (luz e
 * cor acertadas, no máximo 2400 px), recorte.png (só a pessoa, do tamanho
 * dela) e pessoa.json com a análise. Sem rosto na foto, não há pessoa pra pôr
 * no post — a fábrica para e diz por quê.
 */
export function prepararPessoa(pastaJob: string): AnaliseDaPessoa | null {
  const pasta = path.join(pastaJob, PASTA_PESSOA);
  const origem = listar(pasta, /^origem\.(jpe?g|png|webp|heic|tiff?)$/i)[0];
  if (!origem) return null;
  const foto = path.join(pasta, 'foto.png');
  const cheio = path.join(pasta, '.recorte-cheio.png');

  // 1. Luz, cor e tamanho; e o rosto, já na foto tratada.
  const info = JSON.parse(execFileSync(acharCli('photocraft'), ['info', origem, '--compact'], { encoding: 'utf8', timeout: 60_000 }));
  const maior = Math.max(info.width, info.height);
  const passo1 = ['run', origem];
  if (maior > MAIOR_LADO) passo1.push('--cmd', 'image.imageSize', '--params', JSON.stringify({ percent: (MAIOR_LADO / maior) * 100 }));
  passo1.push('--cmd', 'image.autoTone', '--params', '{}', '--cmd', 'image.autoColor', '--params', '{}',
    '--cmd', 'image.detectFaces', '--params', '{}', '--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: foto }));
  const r1 = rodar(passo1);
  const largura = Math.round(info.width * Math.min(1, MAIOR_LADO / maior)), altura = Math.round(info.height * Math.min(1, MAIOR_LADO / maior));
  const rosto = escolherRosto(r1.find((l) => l.command === 'image.detectFaces')?.result.faces ?? []);
  if (!rosto) throw new Error('não achamos um rosto na foto; mande uma foto com o rosto aparecendo de frente');
  const [, ry, , rh] = rosto.rect;
  const cabecaCortada = ry < altura * 0.01 || rosto.olhos.some(([, oy]) => oy < rh * 0.25);

  // 2. O recorte guiado pelo rosto, com a borda refinada (cabelo) e a cor da borda limpa.
  const { corpo, cabeca } = retangulosDaPessoa(rosto.rect, largura, altura);
  rmSync(cheio, { force: true });
  rodar(['run', foto,
    '--cmd', 'layer.new.layerFromBackground', '--params', '{}',
    '--cmd', 'select.object', '--params', JSON.stringify({ rect: corpo }),
    '--cmd', 'select.object', '--params', JSON.stringify({ rect: cabeca, mode: 'add' }),
    '--cmd', 'select.refineEdge', '--params', JSON.stringify({ smartRadius: true, radius: 6, smooth: 8, decontaminate: true, output: 'layerMask' }),
    '--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: cheio })]);
  const img = lerPngRgba(readFileSync(cheio));
  const area = areaDoAlfa(img) ?? [0, 0, 1, 1];
  const [x, y, w, h] = rosto.rect;
  const cobreRosto = cobertura(img, rosto.rect);
  const cobreTopo = cobertura(img, [x + 0.2 * w, y - 0.25 * h, 0.6 * w, 0.25 * h]);
  const motivo = julgarRecorte({ cobreRosto, cobreTopo, fracaoDaFoto: (area[2] * area[3]) / (img.largura * img.altura) });
  // Só a área da pessoa: o arquivo fica pequeno e a posição vai no pessoa.json.
  const rgba = new Uint8Array(area[2] * area[3] * 4);
  for (let l = 0; l < area[3]; l++) rgba.set(img.rgba.subarray(((area[1] + l) * img.largura + area[0]) * 4, ((area[1] + l) * img.largura + area[0] + area[2]) * 4), l * area[2] * 4);
  writeFileSync(path.join(pasta, 'recorte.png'), escreverPng({ largura: area[2], altura: area[3], rgba }));
  rmSync(cheio, { force: true });

  const analise: AnaliseDaPessoa = {
    foto: `${PASTA_PESSOA}/foto.png`, largura: img.largura, altura: img.altura, rosto, cabecaCortada,
    recorte: {
      arquivo: `${PASTA_PESSOA}/recorte.png`, area,
      cobreRosto: Math.round(cobreRosto * 1000) / 1000, cobreTopo: Math.round(cobreTopo * 1000) / 1000,
      ok: !motivo, motivo,
    },
  };
  writeFileSync(path.join(pasta, 'pessoa.json'), JSON.stringify(analise, null, 1));
  return analise;
}

export function lerAnaliseDaPessoa(pastaJob: string): AnaliseDaPessoa | null {
  const arq = path.join(pastaJob, PASTA_PESSOA, 'pessoa.json');
  return existsSync(arq) ? JSON.parse(readFileSync(arq, 'utf8')) : null;
}

// ---------- o post ----------

export const POST = { largura: 1080, altura: 1350 };

/**
 * Onde a pessoa recortada entra no post: o rosto com uns 22% da altura do
 * post, o alto do rosto numa altura fixa, à direita; o corpo passa da borda de
 * baixo, que corta ele como uma foto cortaria — e esconde o corte do recorte.
 */
export function encaixeDoRecorte(a: AnaliseDaPessoa, alvo = { topoDoRosto: 440, alturaDoRosto: 0.22, centroX: 0.6 }) {
  const { largura: L, altura: A } = POST;
  const [ax, ay, aw, ah] = a.recorte.area;
  const [rx, ry, rw, rh] = a.rosto.rect;
  const fundo = ay + ah;
  // Do tamanho do rosto; mas nunca tão pequena que a borda de baixo do recorte apareça no post.
  const s = Math.max((A * alvo.alturaDoRosto) / rh, (A - alvo.topoDoRosto) / (fundo - ry));
  let esquerda = L * alvo.centroX - (rx + rw / 2 - ax) * s;
  // O recorte que encosta na borda da foto tem um corte reto ali: vai pra borda do post, onde some.
  if (ax + aw >= a.largura - 2) esquerda = L - aw * s;
  else if (ax <= 2) esquerda = 0;
  const topo = alvo.topoDoRosto - (ry - ay) * s;
  return {
    escala: s,
    centro: [Math.round(esquerda + (aw * s) / 2), Math.round(topo + (ah * s) / 2)] as [number, number],
    esquerda: Math.round(esquerda),
    rosto: [Math.round(esquerda + (rx - ax) * s), Math.round(topo + (ry - ay) * s), Math.round(rw * s), Math.round(rh * s)] as Caixa,
  };
}

/** A foto cobrindo o post, com o rosto centrado na largura e o alto da cabeça a uns 200 px do topo. */
export function encaixeDaFoto(a: AnaliseDaPessoa) {
  const { largura: L, altura: A } = POST;
  const s = Math.max(L / a.largura, A / a.altura);
  const [rx, ry, rw, rh] = a.rosto.rect;
  const prender = (v: number, min: number) => Math.min(0, Math.max(min, v));
  const esquerda = prender(L / 2 - (rx + rw / 2) * s, L - a.largura * s);
  const topo = prender(200 + 0.25 * rh * s - ry * s, A - a.altura * s);
  const rosto: Caixa = [Math.round(esquerda + rx * s), Math.round(topo + ry * s), Math.round(rw * s), Math.round(rh * s)];
  return {
    escala: s,
    centro: [Math.round(esquerda + (a.largura * s) / 2), Math.round(topo + (a.altura * s) / 2)] as [number, number],
    rosto,
    // O texto vai pro lado em que o rosto não está.
    textoEmBaixo: rosto[1] + rosto[3] / 2 < A / 2,
  };
}

export type TextosDoPost = { titulo: string; apoio?: string | null; assinatura?: string | null };
type Passo = (ferramenta: string, args: Record<string, unknown>) => Promise<string>;

export type MontagemDoPost = {
  passo: Passo;
  conjunto: Conjunto;
  fonte: string;
  pesos: { titulo: number; texto: number };
  margem: number;
  elementos: Elemento[];
  analise: AnaliseDaPessoa;
  textos: TextosDoPost;
  /** auto: o recorte quando ele passou na medida, senão a foto. */
  jeito?: 'auto' | 'recorte' | 'foto';
};

const caixaDoTexto = (t: string) => JSON.parse(t) as { bounds: Caixa; layer: number };

async function textoQueCabe(passo: Passo, params: Record<string, unknown>, limite: number, tamanhos: number[]) {
  const criado = caixaDoTexto(await passo('command_run', { id: 'type.create', params }));
  let fim = criado.bounds[3];
  for (const size of tamanhos) {
    if (fim <= limite) break;
    await passo('command_run', { id: 'type.setStyle', params: { layer: criado.layer, size } });
    fim = JSON.parse(await passo('command_run', { id: 'type.info', params: { layer: criado.layer } })).bounds[3];
  }
  return { layer: criado.layer, fim };
}

/**
 * Monta o post com a pessoa e salva editavel/post.psd e saida/post.png. A
 * pessoa entra como objeto inteligente: o Studio move e aumenta sem perder
 * qualidade, e o PSD abre com ela separada do resto.
 */
export async function montarPostComPessoa(m: MontagemDoPost): Promise<{ jeito: 'recorte' | 'foto'; rosto: Caixa; avisos: string[] }> {
  const { passo, conjunto: c, fonte, pesos, margem, analise: a, textos } = m;
  const { largura: L, altura: A } = POST;
  const avisos: string[] = [];
  if (a.cabecaCortada) throw new Error('a foto já vem com a cabeça cortada em cima; mande uma foto com a cabeça inteira');
  const jeito = m.jeito === 'foto' || m.jeito === 'recorte' ? m.jeito : a.recorte.ok ? 'recorte' : 'foto';
  if (jeito === 'recorte' && !a.recorte.ok) avisos.push(`recorte usado mesmo com ressalva: ${a.recorte.motivo}`);
  if (m.jeito !== 'foto' && !a.recorte.ok) avisos.push(`foto inteira no lugar do recorte (${a.recorte.motivo})`);
  const largo = L - 2 * margem;
  let rosto: Caixa;

  if (jeito === 'recorte') {
    const e = encaixeDoRecorte(a);
    rosto = e.rosto;
    if (e.escala > 1.5) avisos.push(`a foto é pequena: a pessoa foi aumentada ${e.escala.toFixed(1)}×`);
    await passo('doc_new', { width: L, height: A, background: c.fundo, name: 'post' });
    await passo('doc_place', { path: a.recorte.arquivo, scale: e.escala * 100, center: e.centro });
    await passo('command_run', { id: 'layer.setProps', params: { name: 'pessoa' } });
    // Em cima: a faixa, o @ à direita, o título e o apoio, tudo acima do rosto.
    await passo('command_run', { id: 'select.rect', params: { x: margem, y: margem, width: 140, height: 14 } });
    await passo('command_run', { id: 'layer.newFillLayer.solidColor', params: { color: c.faixa } });
    await passo('command_run', { id: 'select.deselect', params: {} });
    if (textos.assinatura) {
      await passo('command_run', { id: 'type.create', params: { text: textos.assinatura, box: [margem, margem - 8, largo, 44], font: fonte, size: 28, weight: pesos.texto, color: c.tinta, align: 'right' } });
    }
    const limite = rosto[1] - 36;
    const t = await textoQueCabe(passo, { text: textos.titulo, box: [margem, margem + 44, largo, Math.max(120, limite - margem - 44)], font: fonte, size: 88, weight: pesos.titulo, color: c.tinta }, limite, [76, 64, 56]);
    if (textos.apoio && limite - t.fim > 70) {
      await textoQueCabe(passo, { text: textos.apoio, box: [margem, t.fim + 20, largo * 0.62, limite - t.fim - 20], font: fonte, size: 38, weight: pesos.texto, color: c.tinta }, limite, [32, 28]);
    }
    // O logo embaixo à esquerda, se a pessoa deixou lugar.
    const l = m.elementos.find((x) => x.tipo === 'logo' && x.largura);
    if (l && e.esquerda >= margem + 200) await passo('doc_place', { path: logoParaOFundo(l, c), scale: (130 / l.largura!) * 100, center: [margem + 65, A - margem - 30] });
  } else {
    const e = encaixeDaFoto(a);
    rosto = e.rosto;
    await passo('doc_new', { width: L, height: A, background: c.fundo, name: 'post' });
    await passo('doc_place', { path: a.foto, scale: e.escala * 100, center: e.centro });
    await passo('command_run', { id: 'layer.setProps', params: { name: 'foto' } });
    // A cor da marca nascendo da borda do texto, de opaca a transparente.
    const [de, ate] = e.textoEmBaixo ? [[L / 2, A], [L / 2, A * 0.42]] : [[L / 2, 0], [L / 2, A * 0.58]];
    await passo('command_run', { id: 'gradient.fill.create', params: { from: de, to: ate, stops: [[0, c.fundo], [1, c.fundo]], transparency: [[0, 100], [0.55, 90], [1, 0]] } });
    const altoTexto = 360;
    const topoTexto = e.textoEmBaixo ? A - margem - 64 - altoTexto : margem + 40;
    await passo('command_run', { id: 'select.rect', params: { x: margem, y: topoTexto - 34, width: 140, height: 14 } });
    await passo('command_run', { id: 'layer.newFillLayer.solidColor', params: { color: c.faixa } });
    await passo('command_run', { id: 'select.deselect', params: {} });
    const t = await textoQueCabe(passo, { text: textos.titulo, box: [margem, topoTexto, largo, altoTexto], font: fonte, size: 84, weight: pesos.titulo, color: c.tinta }, topoTexto + altoTexto - 90, [72, 60, 52]);
    if (textos.apoio && topoTexto + altoTexto - t.fim > 60) {
      await textoQueCabe(passo, { text: textos.apoio, box: [margem, t.fim + 16, largo, topoTexto + altoTexto - t.fim - 16], font: fonte, size: 36, weight: pesos.texto, color: c.tinta }, topoTexto + altoTexto, [30]);
    }
    if (textos.assinatura) {
      const y = e.textoEmBaixo ? A - margem : margem + altoTexto + 80;
      await passo('command_run', { id: 'type.create', params: { text: textos.assinatura, x: margem, y, font: fonte, size: 28, weight: pesos.texto, color: c.tinta } });
    }
  }
  await passo('doc_save', { path: 'editavel/post.psd' });
  await passo('doc_save', { path: 'saida/post.png' });
  return { jeito, rosto, avisos };
}

// ---------- a conferência ----------

const sobrepoe = (a: Caixa, b: Caixa) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * O rosto na peça entregue: achado de novo no PNG, dentro da margem segura de
 * 5%, com folga em cima pra cabeça, e nenhuma camada de texto por cima dele.
 */
export function conferirPessoa(pastaJob: string, base = 'post'): { erros: string[]; avisos: string[]; rosto: Caixa | null } {
  const cli = acharCli('photocraft');
  const png = path.join(pastaJob, 'saida', `${base}.png`), psd = path.join(pastaJob, 'editavel', `${base}.psd`);
  const erros: string[] = [], avisos: string[] = [];
  const r = rodar(['run', png, '--cmd', 'image.detectFaces', '--params', JSON.stringify({ minScore: 0.6 })]);
  const rosto = escolherRosto(r[0]?.result.faces ?? []);
  if (!rosto) return { erros: [`${base}: o rosto da pessoa não aparece na peça`], avisos, rosto: null };
  const info = JSON.parse(execFileSync(cli, ['info', psd, '--compact'], { encoding: 'utf8', timeout: 60_000 }));
  const { width: L, height: A } = info;
  const [x, y, w, h] = rosto.rect;
  const mx = L * 0.05, my = A * 0.05;
  if (x < mx || x + w > L - mx || y + h > A - my) erros.push(`${base}: o rosto sai da margem segura`);
  if (y - 0.25 * h < 0) erros.push(`${base}: a cabeça ficou cortada em cima`);
  if (h < 110) avisos.push(`${base}: o rosto ficou pequeno (${h} px de altura)`);
  // Uma folga em volta do rosto: texto encostando na testa também atrapalha.
  const comFolga: Caixa = [x - w * 0.08, y - h * 0.15, w * 1.16, h * 1.25];
  for (const l of info.layers as Array<{ kind: string; visible: boolean; bounds: number[] | null; text?: { text: string } }>) {
    if (l.kind !== 'Type' || !l.visible || !l.bounds) continue;
    if (sobrepoe(l.bounds as Caixa, comFolga)) erros.push(`${base}: o texto "${(l.text?.text ?? '').slice(0, 30)}" cobre o rosto`);
  }
  return { erros, avisos, rosto: rosto.rect };
}

/** Pra quem chama de fora (worker): garante a pasta antes de baixar a foto nela. */
export function pastaDaPessoa(pastaJob: string) {
  const p = path.join(pastaJob, PASTA_PESSOA);
  mkdirSync(p, { recursive: true });
  return p;
}

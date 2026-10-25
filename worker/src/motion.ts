// O motion: cenas animadas montadas no EffectCraft por script, no modelo de
// objetos do After Effects (app.project, layers.addText, setValueAtTime…).
//
//   - a cena é um texto de script gerado aqui, a partir da marca e do pedido.
//     Todo texto do cliente entra como literal JSON — JSON é JavaScript
//     válido e escapa aspas, barras e quebras de linha; nada é colado cru;
//   - o script não pode gravar arquivo nem usar rede (regra do próprio
//     EffectCraft); quem salva o projeto é o CLI, com --save-as;
//   - o render vai direto pra H.264 pelo CLI, com as linhas de progresso que
//     ele escreve (quadros feitos, total, segundos que faltam). É daí que sai
//     o "faltam uns X minutos" da tela do cliente — medido, não chutado.
//
// Sem LightCraft e sem FilmCraft aqui, de propósito: a grade de cor do
// LightCraft é pra foto e filmagem, e numa peça feita só com as cores da marca
// ela tiraria as cores da paleta; o FilmCraft entraria pra mixar som, e sem
// trilha licenciada não há som pra mixar.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ParametrosAgente } from './agente.ts';
import { acharCli } from './config.ts';
import type { Conjunto } from './marca.ts';
import { listar } from './video.ts';

export const QUADROS_POR_SEGUNDO = 24;
export const SEGUNDOS_ABERTURA = 10;
/** Cada imagem do carrossel fica isto na tela, contando a entrada. */
export const SEGUNDOS_POR_SLIDE = 2.5;
export const SEGUNDOS_PREVIA_MOTION = 3;
export const COMP = 'reel';

const js = (v: unknown) => JSON.stringify(v);
const frac = (hex: string) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) / 255) * 10000) / 10000);
};

const ESTILOS: Array<[number, string]> = [
  [100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black'],
];

/**
 * O nome que o EffectCraft entende pra família + peso: o PostScript
 * ("Manrope-ExtraBold"). Pergunta ao app quais estilos a família tem e pega o
 * mais perto do peso pedido — a Anton só tem Regular, e é ele que vale.
 */
export function fonteDoEffectCraft(familia: string, peso: number): string {
  const saida = execFileSync(acharCli('effectcraft'), ['exec', 'text.fonts', '--params', JSON.stringify({ query: familia }), '--empty'], { encoding: 'utf8', timeout: 60_000 });
  const fam = (JSON.parse(saida).families as Array<{ family: string; styles: string[] }>).find((f) => f.family.toLowerCase() === familia.toLowerCase());
  if (!fam) throw new Error(`o EffectCraft não acha a fonte "${familia}"`);
  const pesoDe = (estilo: string) => ESTILOS.find(([, n]) => n === estilo)?.[0] ?? 400;
  const estilo = fam.styles.filter((s) => ESTILOS.some(([, n]) => n === s))
    .sort((a, b) => Math.abs(pesoDe(a) - peso) - Math.abs(pesoDe(b) - peso))[0] ?? fam.styles[0];
  return `${fam.family.replace(/\s+/g, '')}-${estilo}`;
}

export type Cena = {
  fonte: string;
  conjunto: Conjunto;
  impacto: boolean;
  alinhamento: 'left' | 'center';
  margem: number;
};

/**
 * O começo comum: a composição em pé, o fundo da marca e a "câmera" — um nulo
 * que se aproxima devagar o tempo todo, pai de tudo que se mexe. É o que tira
 * a cara de slide parado.
 */
function comecoDaCena(c: Cena, segundos: number): string {
  return `
var comp = app.project.items.addComp(${js(COMP)}, 1080, 1920, 1, ${segundos}, ${QUADROS_POR_SEGUNDO});
comp.layers.addSolid(${js(frac(c.conjunto.fundo))}, "fundo", 1080, 1920, 1);
var camera = comp.layers.addNull(${segundos});
camera.name = "camera";
camera.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([540, 900]);
camera.property("ADBE Transform Group").property("ADBE Position").setValue([540, 900]);
var aproxima = camera.property("ADBE Transform Group").property("ADBE Scale");
aproxima.setValueAtTime(0, [100, 100]);
aproxima.setValueAtTime(${segundos}, [106, 106]);
// Entra e assenta, em vez de andar em velocidade constante. Posição quer uma
// curva só; escala, uma por eixo — tenta na ordem até o app aceitar.
function suave(prop, k){
  var e = new KeyframeEase(0, 80);
  var n = [1, 3, 2];
  for (var i = 0; i < n.length; i++) {
    var l = []; for (var j = 0; j < n[i]; j++) l.push(e);
    try { prop.setTemporalEaseAtKey(k, l, l); return; } catch (x) {}
  }
}
`;
}

/**
 * A abertura de 10 s: a barra de destaque entra, o título sobe letra por
 * letra, o @ ou o nome aparece embaixo, e tudo fica parado o bastante pra ler
 * — o Reels repete o vídeo, e o último quadro é o que mais se vê.
 *
 * Tudo entre 10% e 75% da altura: em cima o Instagram põe o nome da conta, e
 * embaixo a legenda e os botões.
 */
export function cenaDeAbertura(c: Cena, texto: { titulo: string; rotulo: string | null }): string {
  const titulo = c.impacto ? texto.titulo.toUpperCase() : texto.titulo;
  const largura = 1080 - 2 * c.margem;
  const centro = c.alinhamento === 'center';
  const tamanho = c.impacto ? 150 : 118;
  return comecoDaCena(c, SEGUNDOS_ABERTURA) + `
var t = comp.layers.addBoxText([${largura}, 900], ${js(titulo)});
t.name = "titulo";
var src = t.property("Source Text");
var td = src.value;
td.font = ${js(c.fonte)}; td.fillColor = ${js(frac(c.conjunto.tinta))};
td.justification = ${centro ? 'ParagraphJustification.CENTER_JUSTIFY' : 'ParagraphJustification.LEFT_JUSTIFY'};
// Cabe na caixa: diminui até o título inteiro ter no máximo 640 px de altura.
var tam = ${tamanho};
function aplicar(){ td.fontSize = tam; td.leading = Math.round(tam * 1.08); src.setValue(td); }
aplicar();
var r = t.sourceRectAtTime(5, false);
while (r.height > 640 && tam > 56) { tam -= 6; aplicar(); r = t.sourceRectAtTime(5, false); }
var y = 880 - (r.top + r.height / 2);
t.property("ADBE Transform Group").property("ADBE Position").setValue([540, y]);
var topo = y + r.top, base = y + r.top + r.height;
var xEsq = ${centro ? '540' : '540 + r.left'};

// O título sobe letra por letra.
var an = t.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator");
var ap = an.property("ADBE Text Animator Properties");
ap.addProperty("ADBE Text Opacity").setValue(0);
ap.addProperty("ADBE Text Position 3D").setValue([0, 90, 0]);
var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
var corre = sel.property("ADBE Text Percent Offset");
corre.setValueAtTime(0.6, 0); corre.setValueAtTime(2.6, 100); suave(corre, 2);

// A barra de destaque, que abre da esquerda (ou do meio) antes do título.
var barra = comp.layers.addShape();
barra.name = "barra";
var g = barra.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([180, 16]);
g.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(${js(frac(c.conjunto.faixa))});
barra.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([${centro ? 0 : -90}, 0]);
barra.property("ADBE Transform Group").property("ADBE Position").setValue([xEsq, topo - 70]);
var abre = barra.property("ADBE Transform Group").property("ADBE Scale");
abre.setValueAtTime(0.25, [0, 100]); abre.setValueAtTime(0.85, [100, 100]); suave(abre, 2);
` + (texto.rotulo ? `
var rot = comp.layers.addText(${js(texto.rotulo)});
rot.name = "rotulo";
var rs = rot.property("Source Text"); var rd = rs.value;
rd.font = ${js(c.fonte)}; rd.fontSize = 46; rd.fillColor = ${js(frac(c.conjunto.tinta))};
rd.justification = ${centro ? 'ParagraphJustification.CENTER_JUSTIFY' : 'ParagraphJustification.LEFT_JUSTIFY'};
rs.setValue(rd);
rot.property("ADBE Transform Group").property("ADBE Position").setValue([xEsq, base + 110]);
var aparece = rot.property("ADBE Transform Group").property("ADBE Opacity");
aparece.setValueAtTime(2.6, 0); aparece.setValueAtTime(3.3, 100);
rot.parent = camera;
` : '') + `
t.parent = camera; barra.parent = camera;
writeLn(JSON.stringify({ tamanho: tam, topo: topo, base: base }));
`;
}

/**
 * O carrossel aprovado vira vídeo: cada imagem entra da direita, fica
 * ${SEGUNDOS_POR_SLIDE} s chegando um pouco mais perto e sai pra esquerda quando a próxima
 * entra. As imagens já passaram pela conferência de marca; o que entra de
 * novo é só o fundo, na cor da marca.
 */
export function cenaDeCarrossel(c: Cena, slides: string[]): string {
  const total = slides.length * SEGUNDOS_POR_SLIDE + 0.5;
  // 1080×1350 a 78%, chegando a 81%, com a câmera a mais 6%: no máximo 86% —
  // 929×1161, de 270 a 1430 na altura, dentro da área segura.
  let s = comecoDaCena(c, total);
  slides.forEach((arq, i) => {
    const t0 = i * SEGUNDOS_POR_SLIDE;
    const sai = (i + 1) * SEGUNDOS_POR_SLIDE;
    const ultimo = i === slides.length - 1;
    s += `
var f${i} = app.project.importFile(new ImportOptions(new File(${js(arq)})));
var l${i} = comp.layers.add(f${i});
l${i}.name = "slide ${i + 1}";
l${i}.startTime = 0; l${i}.inPoint = ${Math.max(0, t0 - 0.01)}; l${i}.outPoint = ${ultimo ? total : sai + 0.5};
l${i}.parent = camera;
var e${i} = l${i}.property("ADBE Transform Group").property("ADBE Scale");
e${i}.setValueAtTime(${t0}, [78, 78]); e${i}.setValueAtTime(${ultimo ? total : sai + 0.5}, [81, 81]);
var p${i} = l${i}.property("ADBE Transform Group").property("ADBE Position");
${i === 0 ? `p${i}.setValueAtTime(0, [540, 850]);` : `p${i}.setValueAtTime(${t0 - 0.01}, [1620, 850]); p${i}.setValueAtTime(${t0 + 0.5}, [540, 850]); suave(p${i}, 2);`}
${ultimo ? '' : `p${i}.setValueAtTime(${sai}, [540, 850]); p${i}.setValueAtTime(${sai + 0.5}, [-540, 850]); suave(p${i}, p${i}.numKeys);`}
`;
  });
  return s + `writeLn(JSON.stringify({ slides: ${slides.length}, segundos: ${total} }));\n`;
}

/** Roda o script da cena e salva o projeto. Devolve o que o script escreveu por último. */
export function montarCena(script: string, pastaTrabalho: string, projeto: string): unknown {
  mkdirSync(pastaTrabalho, { recursive: true });
  mkdirSync(path.dirname(projeto), { recursive: true });
  const arq = path.join(pastaTrabalho, 'cena.jsx');
  writeFileSync(arq, script, 'utf8');
  const saida = execFileSync(acharCli('effectcraft'), ['script', arq, '--save-as', projeto], { encoding: 'utf8', timeout: 5 * 60_000, cwd: pastaTrabalho, stdio: ['ignore', 'pipe', 'pipe'] });
  const linha = saida.split(/\r?\n/).reverse().find((l) => l.startsWith('{'));
  return linha ? JSON.parse(linha) : null;
}

export type Andamento = { feitos: number; total: number; restam: number | null };

/**
 * Renderiza o projeto em H.264 pelo CLI e conta os quadros enquanto anda.
 * A prévia é o começo, em meia resolução: sai em segundos e já mostra o
 * movimento.
 */
export function renderizarMotion(
  projeto: string,
  saida: string,
  opcoes: { previa?: boolean; aoAndar?: (a: Andamento) => void; abortar?: AbortSignal } = {},
): Promise<void> {
  const args = ['render', '--project', projeto, '--comp', COMP, '--out', saida, '--format', 'h264', '--fps', String(QUADROS_POR_SEGUNDO),
    '--bitrate', opcoes.previa ? '3000' : '8000', '--audio', 'off', '--progress'];
  if (opcoes.previa) args.push('--start', '0', '--end', String(SEGUNDOS_PREVIA_MOTION), '--resolution', 'half');
  return new Promise((ok, falha) => {
    const p = spawn(acharCli('effectcraft'), args, { stdio: ['ignore', 'ignore', 'pipe'], signal: opcoes.abortar });
    let resto = '';
    let ultimas = '';
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => {
      resto += d;
      const linhas = resto.split(/\r?\n/);
      resto = linhas.pop() ?? '';
      for (const l of linhas) {
        const m = /^progress (\d+) (\d+) [\d.]+ ([\d.]+|-)/.exec(l.trim());
        if (m) opcoes.aoAndar?.({ feitos: Number(m[1]), total: Number(m[2]), restam: m[3] === '-' ? null : Number(m[3]) });
        else ultimas = (ultimas + '\n' + l).slice(-600);
      }
    });
    p.on('error', falha);
    p.on('close', (codigo) => codigo === 0 ? ok() : falha(new Error(`o render do EffectCraft parou (${codigo}): ${ultimas.trim()}`)));
  });
}

/** Um quadro do projeto em PNG — é o que a conferência olha. */
export function quadroDoProjeto(projeto: string, segundos: number, saida: string) {
  execFileSync(acharCli('effectcraft'), ['render-frame', '--project', projeto, '--comp', COMP, '--time', String(segundos), '--out', saida], { stdio: 'ignore', timeout: 120_000 });
}

// ---------- o pedido ----------
// O roteiro e o agente montam e renderizam pelo mesmo caminho: o roteiro
// chama direto, o agente pelas ferramentas cena_da_marca e renderizar_motion.

/** O projeto editável do motion: um por skill. */
export const projetoDoMotion = (p: Pick<ParametrosAgente, 'pastaJob' | 'skill'>) =>
  path.join(p.pastaJob, 'editavel', p.skill.nome === 'carrossel-em-video' ? 'carrossel.ecproj' : 'abertura.ecproj');

export function montarCenaDoPedido(p: ParametrosAgente, o: { conjunto: Conjunto; titulo?: string; rotulo?: string | null }): unknown {
  const cena: Cena = {
    fonte: fonteDoEffectCraft(p.dados.fonte, p.dados.pesos.titulo),
    conjunto: o.conjunto,
    impacto: p.dados.impacto,
    alinhamento: p.dados.alinhamento,
    margem: p.dados.margem,
  };
  let script: string;
  if (p.skill.nome === 'carrossel-em-video') {
    const slides = listar(path.join(p.pastaJob, 'entrada', 'slides'), /^slide-\d+\.png$/);
    if (slides.length < 2) throw new Error(`o carrossel chegou com ${slides.length} imagem(ns)`);
    script = cenaDeCarrossel(cena, slides);
  } else {
    if (!o.titulo?.trim()) throw new Error('falta o título da abertura');
    script = cenaDeAbertura(cena, { titulo: o.titulo.trim(), rotulo: o.rotulo ?? null });
  }
  return montarCena(script, path.join(p.pastaJob, '.trabalho'), projetoDoMotion(p));
}

/**
 * A prévia (entregue na hora) ou o vídeo inteiro. No inteiro, a cada dois
 * segundos a tela do cliente recebe quanto já foi e quanto falta — a barra
 * anda de 30% a 85% junto com os quadros.
 */
export async function renderizarDoPedido(p: ParametrosAgente, previa: boolean) {
  const projeto = projetoDoMotion(p);
  if (previa) {
    await renderizarMotion(projeto, path.join(p.pastaJob, 'saida', 'previa.mp4'), { previa: true, abortar: p.abortar.signal });
    await p.entregarParcial('saida/previa.mp4');
    return;
  }
  let ultimo = 0;
  await renderizarMotion(projeto, path.join(p.pastaJob, 'saida', 'reel.mp4'), {
    abortar: p.abortar.signal,
    aoAndar: (a) => {
      const agora = Date.now();
      if (agora - ultimo < 2000 || !a.total) return;
      ultimo = agora;
      p.aoMudarEtapa({ etapa: 'animando', progresso: Math.round(30 + (55 * a.feitos) / a.total), restamSegundos: a.restam == null ? null : Math.ceil(a.restam) })
        .catch(() => { /* a barra perde um passo; o render continua */ });
    },
  });
}

/** As fontes de cada texto do projeto, lidas do .ecproj (que é JSON). */
export function fontesDoProjeto(json: string): string[] {
  const fontes: string[] = [];
  const andar = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.t === 'Text' && o.v && typeof (o.v as { font?: unknown }).font === 'string') fontes.push((o.v as { font: string }).font);
    for (const v of Object.values(o)) andar(v);
  };
  andar(JSON.parse(json));
  return [...new Set(fontes)];
}

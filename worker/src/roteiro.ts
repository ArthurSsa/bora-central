// O roteiro: a fábrica sem o Claude. Para cada skill, um passo a passo fixo
// com os MESMOS comandos que o SKILL.md manda o agente usar, falando com o
// PhotoCraft pelo mesmo servidor MCP preso à pasta do job.
//
// Serve pra três coisas: provar o caminho inteiro sem chave da Anthropic e
// sem custo; provar que os comandos escritos em cada skill existem e fazem o
// que ela diz (se o roteiro passa na conferência de marca, a receita é boa);
// e, depois, separar "a máquina quebrou" de "o agente errou".
//
// Não interpreta nada. O título é o começo do que o cliente escreveu; a
// legenda é o texto dele, a chamada e as hashtags da marca. Escrever bem é do
// Claude.
//
//   FABRICA_AGENTE=roteiro npm start
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { servidorMcp } from './apps.ts';
import { abrirMcp } from './mcp-cru.ts';
import { desenharLegendas, exportarReel, lerSrt, lerTranscricao, somDoReel, trechosACortar } from './reel.ts';
import { TICKS_POR_SEGUNDO, listar, sondar, transcricaoParaFilmCraft } from './video.ts';
import { montarCenaDoPedido, renderizarDoPedido } from './motion.ts';
import { CUSTO_ZERO, FalhaDoAgente, salvarTexto, type Agente, type ParametrosAgente } from './agente.ts';
import type { Ajuste } from './fila.ts';
import type { Conjunto } from './marca.ts';
import { materialDoPedido } from './diagramacao.ts';
import { cartazDoPedido, logoParaOFundo } from './vetor.ts';

/** O título que o roteiro consegue tirar sem interpretar: as primeiras oito palavras, sem o que vem depois de ":". */
export function tituloDoTexto(texto: string, maxPalavras = 8): string {
  const antes = texto.split(':')[0].trim() || texto.trim();
  const palavras = antes.split(/\s+/).filter(Boolean);
  const curto = palavras.slice(0, maxPalavras).join(' ');
  return curto.replace(/[.,;!?]+$/, '') || 'Teste da fábrica';
}

/** As frases do pedido, na ordem: é o que o carrossel tem pra distribuir. */
export function frasesDoTexto(texto: string): string[] {
  return texto.split(/[.;:!?\n]+/).map((f) => f.trim()).filter((f) => f.split(/\s+/).length >= 2);
}

/**
 * O que o roteiro sabe fazer dos atalhos de ajuste, somando todos os pedidos
 * até aqui (ele refaz do zero, então precisa da história inteira):
 * "outra cor da marca" anda um conjunto por vez; "mais curto" corta o título
 * pra quatro palavras. O resto — texto livre, "mais sério", "troca a foto" —
 * pede interpretação, e isso é do Claude.
 */
export function aplicarAtalhos(ajustes: Ajuste[], totalConjuntos: number) {
  const todos = ajustes.flatMap((a) => a.atalhos);
  const ignorados = [
    // Os de música valem igual pros dois: quem aplica é o som (somDaRodada).
    ...todos.filter((t) => !['mais curto', 'outra cor da marca', 'sem música', 'música mais baixa'].includes(t)),
    ...ajustes.filter((a) => a.texto).map((a) => `"${a.texto}"`),
  ];
  return {
    conjunto: todos.filter((t) => t === 'outra cor da marca').length % Math.max(totalConjuntos, 1),
    maxPalavras: todos.includes('mais curto') ? 4 : 8,
    ignorados,
  };
}

type Passo = (ferramenta: string, args: Record<string, unknown>) => Promise<string>;
type Contexto = { p: ParametrosAgente; passo: Passo; c: Conjunto; maxPalavras: number };

const caixa = (texto: string) => JSON.parse(texto) as { bounds: [number, number, number, number]; layer: number };

/** Título no jeito da fonte: a de impacto vai em caixa alta e 20% maior. */
const titulo = (p: ParametrosAgente, texto: string, tamanho: number) =>
  p.dados.impacto ? { text: texto.toUpperCase(), size: Math.round(tamanho * 1.2) } : { text: texto, size: tamanho };

async function faixa(passo: Passo, x: number, y: number, largura: number, cor: string) {
  await passo('command_run', { id: 'select.rect', params: { x, y, width: largura, height: 14 } });
  await passo('command_run', { id: 'layer.newFillLayer.solidColor', params: { color: cor } });
  await passo('command_run', { id: 'select.deselect', params: {} });
}

/** Encolhe o texto até ele terminar antes de `limite` — o mesmo ajuste que a skill pede. */
async function caber(passo: Passo, criado: { bounds: number[]; layer: number }, limite: number, tamanhos: number[]) {
  let fim = criado.bounds[3];
  for (const size of tamanhos) {
    if (fim <= limite) return fim;
    await passo('command_run', { id: 'type.setStyle', params: { layer: criado.layer, size } });
    const info = JSON.parse(await passo('command_run', { id: 'type.info', params: { layer: criado.layer } }));
    fim = info.bounds[3];
  }
  return fim;
}

function legenda(p: ParametrosAgente): string {
  const partes = [p.dados.textoDoCliente.trim()];
  if (p.dados.chamada) partes.push(p.dados.chamada);
  const hashtags = (p.dados.hashtags ?? '').split(/\s+/).filter((h) => h.startsWith('#')).slice(0, 12);
  return partes.join('\n\n') + (hashtags.length ? `\n\n${hashtags.join(' ')}` : '');
}

async function logo(x: Contexto, centro: [number, number], largura: number) {
  const l = x.p.dados.elementos.find((e) => e.tipo === 'logo' && e.largura);
  if (!l) return;
  // Uma cor do logo some no fundo deste conjunto: vai a versão de uma cor, na tinta dele.
  await x.passo('doc_place', { path: logoParaOFundo(l, x.c), scale: (largura / l.largura!) * 100, center: centro });
}

async function postDeTeste({ p, passo, c, maxPalavras }: Contexto) {
  const m = p.dados.margem;
  await p.aoMudarEtapa({ etapa: 'desenhando o post', progresso: 20 });
  await passo('doc_new', { width: 1080, height: 1350, background: c.fundo, name: 'post' });
  await faixa(passo, m, 1180, 180, c.faixa);
  await p.aoMudarEtapa({ etapa: 'escrevendo o título', progresso: 45 });
  const t = caixa(await passo('command_run', {
    id: 'type.create',
    params: { text: tituloDoTexto(p.dados.textoDoCliente, maxPalavras), box: [m, 420, 1080 - 2 * m, 600], font: p.dados.fonte, size: 88, weight: p.dados.pesos.titulo, color: c.tinta, align: p.dados.alinhamento },
  }));
  await p.aoMudarEtapa({ etapa: 'conferindo o post', progresso: 70 });
  await caber(passo, t, 1180 - 24, [72, 60]);
  await passo('doc_save', { path: 'editavel/post.psd' });
  await passo('doc_save', { path: 'saida/post.png' });
}

async function postFeed(x: Contexto) {
  const { p, passo, c, maxPalavras } = x;
  const m = p.dados.margem;
  await p.aoMudarEtapa({ etapa: 'desenhando o post', progresso: 15 });
  await passo('doc_new', { width: 1080, height: 1350, background: c.fundo, name: 'post' });
  await faixa(passo, m, 1350 - m - 120, 140, c.faixa);

  await p.aoMudarEtapa({ etapa: 'escrevendo o título', progresso: 35 });
  const tt = titulo(p, tituloDoTexto(p.dados.textoDoCliente, maxPalavras), 92);
  const t = caixa(await passo('command_run', {
    id: 'type.create',
    params: { ...tt, box: [m, 300, 1080 - 2 * m, 600], font: p.dados.fonte, weight: p.dados.pesos.titulo, color: c.tinta, align: p.dados.alinhamento },
  }));
  const fimTitulo = await caber(passo, t, 1350 - m - 300, [76, 64]);

  // A segunda informação do pedido (o que vem depois de ":") vira apoio.
  const depois = p.dados.textoDoCliente.split(':').slice(1).join(':').trim();
  if (depois && maxPalavras > 4) {
    const apoio = depois.split(/\s+/).slice(0, 14).join(' ').replace(/[.,;!?]+$/, '');
    await passo('command_run', {
      id: 'type.create',
      params: { text: apoio, box: [m, fimTitulo + 40, 1080 - 2 * m, 220], font: p.dados.fonte, size: 40, weight: p.dados.pesos.texto, color: c.tinta, align: p.dados.alinhamento },
    });
  }
  const assinatura = [p.dados.instagram, p.dados.registro].filter(Boolean).join(' · ');
  if (assinatura) {
    await passo('command_run', {
      id: 'type.create',
      params: { text: assinatura, x: m, y: 1350 - m, font: p.dados.fonte, size: 30, weight: p.dados.pesos.texto, color: c.tinta },
    });
  }
  await logo(x, [1080 - m - 70, 1350 - m - 30], 140);

  await p.aoMudarEtapa({ etapa: 'conferindo o post', progresso: 70 });
  await passo('doc_save', { path: 'editavel/post.psd' });
  await passo('doc_save', { path: 'saida/post.png' });
  await p.aoMudarEtapa({ etapa: 'escrevendo a legenda', progresso: 85 });
  salvarTexto(p.pastaJob, p.dados.saidas, 'saida/legenda.txt', legenda(p));
}

async function carrossel(x: Contexto) {
  const { p, passo, c, maxPalavras } = x;
  const m = p.dados.margem;
  const total = p.dados.saidas.filter((s) => /^saida\/slide-\d+\.png$/.test(s.caminho)).length;
  const frases = frasesDoTexto(p.dados.textoDoCliente);
  const meio = frases.slice(1);
  const nn = (i: number) => String(i).padStart(2, '0');

  for (let i = 1; i <= total; i++) {
    await p.aoMudarEtapa({ etapa: `desenhando o slide ${i} de ${total}`, progresso: Math.round(10 + (70 * (i - 1)) / total) });
    await passo('doc_new', { width: 1080, height: 1350, background: c.fundo, name: `slide-${nn(i)}` });
    if (i === 1) {
      const t = caixa(await passo('command_run', {
        id: 'type.create',
        params: { ...titulo(p, tituloDoTexto(p.dados.textoDoCliente, maxPalavras), 96), box: [m, 340, 1080 - 2 * m, 620], font: p.dados.fonte, weight: p.dados.pesos.titulo, color: c.tinta },
      }));
      await caber(passo, t, 1350 - m - 160, [80, 68]);
      await faixa(passo, m, 1350 - m - 120, 140, c.faixa);
      await passo('command_run', { id: 'type.create', params: { text: 'Arrasta pro lado →', x: m, y: 1350 - m, font: p.dados.fonte, size: 30, weight: p.dados.pesos.texto, color: c.tinta } });
    } else if (i < total) {
      const frase = meio[(i - 2) % Math.max(meio.length, 1)] ?? frases[0] ?? p.dados.textoDoCliente;
      const palavras = frase.split(/\s+/);
      await passo('command_run', { id: 'type.create', params: { text: nn(i), x: m, y: m + 110, font: p.dados.fonte, size: 120, weight: p.dados.pesos.titulo, color: c.destaque } });
      const t = caixa(await passo('command_run', {
        id: 'type.create',
        params: { ...titulo(p, palavras.slice(0, 6).join(' '), 64), box: [m, 380, 1080 - 2 * m, 300], font: p.dados.fonte, weight: p.dados.pesos.titulo, color: c.tinta },
      }));
      await caber(passo, t, 690, [56, 48]);
      if (palavras.length > 6) {
        await passo('command_run', {
          id: 'type.create',
          params: { text: palavras.slice(6, 36).join(' '), box: [m, 720, 1080 - 2 * m, 420], font: p.dados.fonte, size: 38, weight: p.dados.pesos.texto, color: c.tinta },
        });
      }
    } else {
      await passo('command_run', {
        id: 'type.create',
        params: { ...titulo(p, p.dados.chamada ?? 'Salva pra ver depois', 72), box: [m, 420, 1080 - 2 * m, 480], font: p.dados.fonte, weight: p.dados.pesos.titulo, color: c.tinta },
      });
      await faixa(passo, m, 1350 - m - 120, 140, c.faixa);
      if (p.dados.instagram) {
        await passo('command_run', { id: 'type.create', params: { text: p.dados.instagram, x: m, y: 1350 - m, font: p.dados.fonte, size: 34, weight: p.dados.pesos.texto, color: c.tinta } });
      }
    }
    if (p.dados.numerar && i > 1) {
      await passo('command_run', {
        id: 'type.create',
        params: { text: `${i}/${total}`, box: [1080 - m - 160, 1350 - m - 40, 160, 50], font: p.dados.fonte, size: 28, weight: p.dados.pesos.texto, color: c.tinta, align: 'right' },
      });
    }
    await passo('doc_save', { path: `editavel/slide-${nn(i)}.psd` });
    await passo('doc_save', { path: `saida/slide-${nn(i)}.png` });
    await passo('doc_close', {});
  }
  await p.aoMudarEtapa({ etapa: 'escrevendo a legenda', progresso: 85 });
  salvarTexto(p.pastaJob, p.dados.saidas, 'saida/legenda.txt', legenda(p));
}

async function capa(x: Contexto) {
  const { p, passo, c, maxPalavras } = x;
  const m = 64;
  const base = tituloDoTexto(p.dados.textoDoCliente, Math.min(6, maxPalavras));
  const palavras = base.split(/\s+/);
  // Três ângulos sem interpretar nada: o começo, uma pergunta e o mais curto.
  const titulos = [base, `${palavras.slice(0, 5).join(' ')}?`, palavras.slice(0, 3).join(' ')];

  for (let n = 1; n <= 3; n++) {
    await p.aoMudarEtapa({ etapa: `desenhando a capa ${n} de 3`, progresso: [15, 35, 55][n - 1] });
    await passo('doc_new', { width: 1280, height: 720, background: c.fundo, name: `capa-${n}` });
    await passo('command_run', { id: 'select.rect', params: { x: 640, y: 0, width: 640, height: 720 } });
    await passo('command_run', { id: 'layer.newFillLayer.gradient', params: { from: c.fundo, to: c.destaque, angle: 0 } });
    await passo('command_run', { id: 'select.deselect', params: {} });
    const foto = p.dados.elementos.find((e) => e.tipo === 'foto');
    if (foto) await passo('doc_place', { path: foto.arquivo, center: [960, 400], fit: true });
    const t = caixa(await passo('command_run', {
      id: 'type.create',
      params: { ...titulo(p, titulos[n - 1], 84), box: [m, 150, 600, 420], font: p.dados.fonte, weight: p.dados.pesos.titulo, color: c.tinta },
    }));
    await caber(passo, t, 720 - m - 40, [72, 60]);
    await faixa(passo, m, 720 - m - 14, 120, c.faixa);
    await passo('doc_save', { path: `editavel/capa-${n}.psd` });
    await passo('doc_save', { path: `saida/capa-${n}.png` });
    await passo('doc_close', {});
  }
  await p.aoMudarEtapa({ etapa: 'escrevendo os títulos', progresso: 80 });
  const primeira = frasesDoTexto(p.dados.textoDoCliente)[0] ?? base;
  salvarTexto(p.pastaJob, p.dados.saidas, 'saida/titulos.txt', [primeira.slice(0, 70), `${base} | ${p.dados.instagram ?? 'vídeo'}`.slice(0, 70)].join('\n'));
  salvarTexto(p.pastaJob, p.dados.saidas, 'saida/legenda.txt', legenda(p));
}

/**
 * O reel a partir do vídeo bruto, com os mesmos comandos que a skill manda o
 * agente usar. A transcrição já está em entrada/transcricao.json (o worker
 * faz antes, com o whisper.cpp). Este roteiro não precisa interpretar nada:
 * cortar muleta, frase repetida e pausa é regra; o que o Claude faria a mais
 * é escolher melhor onde aproximar e o que dizer na legenda do post.
 */
async function reelDeBruto(x: Contexto) {
  const { p, c } = x;
  const fc = await abrirMcp(servidorMcp('filmcraft', p.pastaJob));
  const fcPasso = async (ferramenta: string, args: Record<string, unknown> = {}) => {
    const t = performance.now();
    const r = await fc.chamar(ferramenta, args);
    p.aoUsarFerramenta(`roteiro:filmcraft:${ferramenta}${args.id ? `:${args.id}` : ''}`, Math.round(performance.now() - t), r.erro);
    if (r.erro) throw new FalhaDoAgente(`${ferramenta} ${args.id ?? ''} falhou: ${r.texto}`, CUSTO_ZERO);
    return r.texto ? JSON.parse(r.texto) : null;
  };
  const cmd = (id: string, params: Record<string, unknown> = {}) => fcPasso('command_run', { id, params });
  const projeto = path.join(p.pastaJob, 'editavel', 'reel.fcproj');
  const bruto = listar(path.join(p.pastaJob, 'entrada'), /^bruto\./)[0];
  if (!bruto) throw new FalhaDoAgente('não achei o vídeo bruto em entrada/', CUSTO_ZERO);

  try {
    await p.aoMudarEtapa({ etapa: 'preparando o vídeo', progresso: 8 });
    const { items: [item] } = await fcPasso('media_import', { paths: [bruto] });
    const sonda = sondar(bruto);
    await cmd('file.newSequence', { name: 'reel', width: 1080, height: 1920, fps: 30, video: 2, audio: 1 });
    await cmd('timeline.place', { item, track: 'V1', seconds: 0 });
    // Vídeo deitado ou de outra proporção: amplia até cobrir o quadro em pé.
    const base = Math.max(1080 / (sonda.largura || 1080), 1920 / (sonda.altura || 1920)) * 100;
    const clipes = async () => (await fcPasso('sequence_inspect')).video[0].items.map((i: { clip: number }) => i.clip) as number[];
    if (Math.abs(base - 100) > 0.5) for (const clip of await clipes()) await cmd('effects.setParam', { clip, effect: 'motion', param: 'scale', value: base });
    await cmd('transcript.set', { item, transcript: transcricaoParaFilmCraft(lerTranscricao(p.pastaJob)) });

    await p.aoMudarEtapa({ etapa: 'cortando as pausas', progresso: 20 });
    const { words } = await cmd('transcript.inspect', {});
    for (const [de, ate] of trechosACortar((words as Array<{ text: string }>).map((w) => ({ texto: w.text })))) {
      await cmd('transcript.extract', { from: de, to: ate });
    }
    await cmd('transcript.removePauses', { minSeconds: 0.5, keepSeconds: 0.12 });

    // O "punch-in" de reel: um corte sim, um não, a câmera chega 12% mais perto.
    await p.aoMudarEtapa({ etapa: 'aproximando a câmera', progresso: 32 });
    const todos = await clipes();
    for (let k = 1; k < todos.length; k += 2) await cmd('effects.setParam', { clip: todos[k], effect: 'motion', param: 'scale', value: Math.round(base * 1.12 * 100) / 100 });

    await p.aoMudarEtapa({ etapa: 'legendando', progresso: 42 });
    await cmd('transcript.createCaptions', { maxChars: 18, lines: 1, minSeconds: 0.5, maxSeconds: 2.2 });
    await cmd('captions.export', { path: path.join(p.pastaJob, 'saida', 'legendas.srt') });
    await cmd('captions.setTrack', { track: 'C1', enabled: false });
    const legendas = lerSrt(readFileSync(path.join(p.pastaJob, 'saida', 'legendas.srt'), 'utf8'));
    const pngs = await desenharLegendas(p.pastaJob, legendas, { fonte: p.dados.fonte, peso: p.dados.pesos.titulo, conjunto: c, impacto: p.dados.impacto });
    const { items: imagens } = await fcPasso('media_import', { paths: pngs });
    for (const [k, l] of legendas.entries()) {
      await cmd('timeline.place', { item: imagens[k], track: k === 0 ? 'new' : 'V2', seconds: l.inicio, duration: Math.round((l.fim - l.inicio) * TICKS_POR_SEGUNDO) });
    }
    await cmd('file.saveAs', { path: projeto });
  } finally {
    fc.fechar();
  }

  await p.aoMudarEtapa({ etapa: 'cuidando do som', progresso: 52 });
  somDoReel(p);

  await p.aoMudarEtapa({ etapa: 'preparando a prévia', progresso: 58 });
  exportarReel(projeto, path.join(p.pastaJob, 'saida', 'previa.mp4'), { previaSegundos: 15 });
  await p.entregarParcial('saida/previa.mp4');

  await p.aoMudarEtapa({ etapa: 'finalizando o som', progresso: 72 });
  exportarReel(projeto, path.join(p.pastaJob, 'saida', 'reel.mp4'));

  await p.aoMudarEtapa({ etapa: 'escrevendo a legenda', progresso: 88 });
  const fala = lerTranscricao(p.pastaJob).map((w) => w.texto).join(' ');
  const pDeLegenda = { ...p, dados: { ...p.dados, textoDoCliente: [p.dados.textoDoCliente, frasesDoTexto(fala).slice(0, 2).join('. ')].filter(Boolean).join('\n\n') } };
  salvarTexto(p.pastaJob, p.dados.saidas, 'saida/legenda.txt', legenda(pDeLegenda));
}

/** A abertura: o título que o roteiro sabe tirar sem interpretar, o @ embaixo. */
async function aberturaComMotion({ p, c, maxPalavras }: Contexto) {
  await p.aoMudarEtapa({ etapa: 'montando a cena', progresso: 10 });
  montarCenaDoPedido(p, { conjunto: c, titulo: tituloDoTexto(p.dados.textoDoCliente, maxPalavras), rotulo: p.dados.instagram });
  await motionAteOFim(p);
}

async function carrosselEmVideo({ p, c }: Contexto) {
  await p.aoMudarEtapa({ etapa: 'montando a cena', progresso: 10 });
  montarCenaDoPedido(p, { conjunto: c });
  await motionAteOFim(p);
}

async function motionAteOFim(p: ParametrosAgente) {
  await p.aoMudarEtapa({ etapa: 'preparando a prévia', progresso: 20 });
  await renderizarDoPedido(p, true);
  await p.aoMudarEtapa({ etapa: 'animando', progresso: 30 });
  await renderizarDoPedido(p, false);
  await p.aoMudarEtapa({ etapa: 'escrevendo a legenda', progresso: 90 });
  salvarTexto(p.pastaJob, p.dados.saidas, 'saida/legenda.txt', legenda(p));
}

/** O cartaz: o título sem o que vem depois de ":", e isso como a linha de apoio. */
async function cartaz({ p, c, maxPalavras }: Contexto) {
  await p.aoMudarEtapa({ etapa: 'montando o cartaz', progresso: 20 });
  const depois = p.dados.textoDoCliente.split(':').slice(1).join(':').trim();
  const apoio = depois && maxPalavras > 4 ? depois.split(/\s+/).slice(0, 12).join(' ').replace(/[.,;!?]+$/, '') : null;
  cartazDoPedido(p, { titulo: tituloDoTexto(p.dados.textoDoCliente, maxPalavras), apoio, conjunto: c });
  await p.aoMudarEtapa({ etapa: 'conferindo o cartaz', progresso: 80 });
}

/**
 * O guia e o folheto: a primeira frase do pedido é o título, as outras são as
 * ideias, na ordem — o roteiro não escreve conteúdo, só distribui o que o
 * cliente mandou (uma ideia por página ou painel).
 */
async function material({ p, c, maxPalavras }: Contexto) {
  await p.aoMudarEtapa({ etapa: p.skill.nome === 'folheto-dobravel' ? 'diagramando o folheto' : 'diagramando o guia', progresso: 20 });
  const frases = frasesDoTexto(p.dados.textoDoCliente);
  materialDoPedido(p, { titulo: tituloDoTexto(frases[0] ?? p.dados.textoDoCliente, maxPalavras), ideias: frases.slice(1).map((f) => f.replace(/[.,;]+$/, '') + '.'), conjunto: c });
  await p.aoMudarEtapa({ etapa: 'conferindo as páginas', progresso: 80 });
}

const ROTEIROS: Record<string, (x: Contexto) => Promise<void>> = {
  'cartaz-impressao': cartaz,
  'guia-pdf': material,
  'folheto-dobravel': material,
  'abertura-com-motion': aberturaComMotion,
  'carrossel-em-video': carrosselEmVideo,
  'post-feed-teste': postDeTeste,
  'post-feed': postFeed,
  carrossel,
  'capa-thumbnail': capa,
  'reel-de-bruto': reelDeBruto,
};

export const rodarRoteiro: Agente = async (p) => {
  const fazer = ROTEIROS[p.skill.nome];
  if (!fazer) throw new FalhaDoAgente(`o roteiro não sabe fazer a skill ${p.skill.nome}`, CUSTO_ZERO);
  const atalhos = aplicarAtalhos(p.dados.ajustes, p.dados.conjuntos.length);
  const c = p.dados.conjuntos[atalhos.conjunto] ?? p.dados.conjunto;
  let renderMs = 0;
  const mcp = await abrirMcp(servidorMcp('photocraft', p.pastaJob));

  const passo: Passo = async (ferramenta, args) => {
    if (p.abortar.signal.aborted) throw new FalhaDoAgente('job cancelado', { ...CUSTO_ZERO, render_segundos: renderMs / 1000 });
    const t = performance.now();
    const r = await mcp.chamar(ferramenta, args);
    const ms = Math.round(performance.now() - t);
    renderMs += ms;
    p.aoUsarFerramenta(`roteiro:${ferramenta}${args.id ? `:${args.id}` : ''}`, ms, r.erro);
    if (r.erro) throw new FalhaDoAgente(`${ferramenta} falhou: ${r.texto}`, { ...CUSTO_ZERO, render_segundos: renderMs / 1000 });
    return r.texto;
  };

  try {
    await fazer({ p, passo, c, maxPalavras: atalhos.maxPalavras });
  } finally {
    mcp.fechar();
  }

  return {
    custos: { ...CUSTO_ZERO, render_segundos: Math.round(renderMs / 10) / 100 },
    resumo:
      `Roteiro (sem Claude), skill ${p.skill.nome}: conjunto "${c.nome}", fonte ${p.dados.fonte}, título "${tituloDoTexto(p.dados.textoDoCliente, atalhos.maxPalavras)}".` +
      (atalhos.ignorados.length ? ` Não sabe aplicar sem o Claude: ${atalhos.ignorados.join(', ')}.` : ''),
    turnos: 0,
  };
};

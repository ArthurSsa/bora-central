// O reel a partir do vídeo bruto: as peças que o roteiro e o agente usam do
// mesmo jeito.
//
//   - o que cortar (vícios de fala e a frase começada duas vezes), a partir
//     da transcrição, sem interpretar;
//   - as legendas na marca: o FilmCraft desenha errado as fontes de marca
//     (a Manrope e a Anton saem com ganchinhos embaixo das letras; só fonte
//     de sistema sai limpa), então cada legenda vira um PNG transparente
//     desenhado no PhotoCraft, que desenha certo, e entra no vídeo como
//     camada por cima — no tempo que o FilmCraft calculou;
//   - a exportação, sempre pelo CLI: pelo MCP ela vira um job que não anda
//     enquanto o servidor espera o próximo pedido.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { servidorMcp } from './apps.ts';
import { acharCli } from './config.ts';
import type { Conjunto } from './marca.ts';
import { abrirMcp } from './mcp-cru.ts';
import type { Palavra } from './video.ts';

// ---------- o que cortar ----------

const normal = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').trim();

/** Muletas de fala, quando vêm soltas e seguidas de vírgula: "É, tipo assim, …". */
const MULETAS = new Set(['e', 'entao', 'tipo', 'assim', 'ne', 'ahn', 'hum', 'eh', 'tipo assim', 'olha']);

/**
 * Os trechos a tirar, em índices de palavra, já juntados e do fim pro começo
 * (cortar do fim não muda o índice do que ainda falta cortar).
 *
 * Muleta: uma sequência de muletas que começa uma frase e termina em vírgula
 * ("É, então,"). "é" no meio da frase ("o que funciona é começar") é verbo e
 * fica — por isso a vírgula e o começo de frase.
 *
 * Frase repetida: quando a frase é o começo da seguinte ("Mas não precisa.
 * Mas não precisa mesmo."), sai a primeira.
 */
export function trechosACortar(palavras: Array<{ texto: string }>): Array<[number, number]> {
  const t = palavras.map((p) => p.texto);
  const trechos: Array<[number, number]> = [];
  const comecoDeFrase = (k: number) => k === 0 || /[.!?]$/.test(t[k - 1]);
  for (let k = 0; k < t.length; k++) {
    if (!comecoDeFrase(k) || !MULETAS.has(normal(t[k]))) continue;
    let fim = k;
    while (fim + 1 < t.length && MULETAS.has(normal(t[fim + 1])) && !/[.!?]$/.test(t[fim])) fim++;
    // recua até a última muleta que fecha com vírgula
    while (fim >= k && !/,$/.test(t[fim])) fim--;
    if (fim >= k) trechos.push([k, fim]);
  }
  const frases: Array<[number, number]> = [];
  let ini = 0;
  t.forEach((w, k) => { if (/[.!?]$/.test(w) || k === t.length - 1) { frases.push([ini, k]); ini = k + 1; } });
  const textoDe = ([a, b]: [number, number]) => normal(t.slice(a, b + 1).join(' '));
  for (let f = 0; f + 1 < frases.length; f++) {
    const a = textoDe(frases[f]), b = textoDe(frases[f + 1]);
    if (a.split(' ').length >= 2 && b !== a && b.startsWith(a)) trechos.push(frases[f]);
  }
  // junta o que se sobrepõe ou encosta: cortar "É," e depois "É, então,"
  // separadamente apagaria uma palavra que devia ficar
  trechos.sort((x, y) => x[0] - y[0]);
  const juntos: Array<[number, number]> = [];
  for (const [a, b] of trechos) {
    const ultimo = juntos[juntos.length - 1];
    if (ultimo && a <= ultimo[1] + 1) ultimo[1] = Math.max(ultimo[1], b);
    else juntos.push([a, b]);
  }
  return juntos.reverse();
}

// ---------- legendas ----------

export type Legenda = { inicio: number; fim: number; texto: string };

export function lerSrt(srt: string): Legenda[] {
  const tempo = (s: string) => {
    const [h, m, resto] = s.trim().replace(',', '.').split(':');
    return Number(h) * 3600 + Number(m) * 60 + Number(resto);
  };
  return srt.replace(/^﻿/, '').trim().split(/\r?\n\s*\r?\n/).map((bloco) => {
    const linhas = bloco.split(/\r?\n/);
    const i = linhas.findIndex((l) => l.includes('-->'));
    const [a, b] = linhas[i].split('-->');
    return { inicio: tempo(a), fim: tempo(b), texto: linhas.slice(i + 1).join(' ').trim() };
  }).filter((l) => l.texto);
}

export type EstiloDeLegenda = { fonte: string; peso: number; conjunto: Conjunto; impacto: boolean };

/**
 * Desenha cada legenda como PNG transparente 1080×1920: o texto na fonte e no
 * peso da marca, sobre uma caixa no fundo do conjunto. A caixa fica entre 72%
 * e 80% da altura — acima de onde o Instagram põe nome, legenda e botões.
 */
export async function desenharLegendas(pastaJob: string, legendas: Legenda[], estilo: EstiloDeLegenda): Promise<string[]> {
  mkdirSync(path.join(pastaJob, 'editavel', 'legendas'), { recursive: true });
  const mcp = await abrirMcp(servidorMcp('photocraft', pastaJob));
  const passo = async (ferramenta: string, args: Record<string, unknown>) => {
    const r = await mcp.chamar(ferramenta, args);
    if (r.erro) throw new Error(`legenda: ${ferramenta}: ${r.texto}`);
    return r.texto;
  };
  const caminhos: string[] = [];
  try {
    for (const [i, l] of legendas.entries()) {
      const texto = estilo.impacto ? l.texto.toUpperCase() : l.texto;
      await passo('doc_new', { width: 1080, height: 1920, background: 'transparent', name: `legenda-${i + 1}` });
      const t = JSON.parse(await passo('command_run', {
        id: 'type.create',
        params: { text: texto, box: [90, 1400, 900, 220], font: estilo.fonte, size: estilo.impacto ? 78 : 66, weight: estilo.peso, color: estilo.conjunto.tinta, align: 'center' },
      }));
      const [x0, y0, x1, y1] = t.bounds as number[];
      await passo('command_run', { id: 'select.rect', params: { x: Math.round(x0 - 28), y: Math.round(y0 - 18), width: Math.round(x1 - x0 + 56), height: Math.round(y1 - y0 + 36) } });
      const caixa = JSON.parse(await passo('command_run', { id: 'layer.newFillLayer.solidColor', params: { color: estilo.conjunto.fundo } }));
      await passo('command_run', { id: 'layer.arrange.sendBackward', params: { layer: caixa.layer } });
      await passo('command_run', { id: 'select.deselect', params: {} });
      const nome = `editavel/legendas/leg-${String(i + 1).padStart(3, '0')}.png`;
      await passo('doc_save', { path: nome });
      await passo('doc_close', {});
      caminhos.push(path.join(pastaJob, nome));
    }
  } finally {
    mcp.fechar();
  }
  return caminhos;
}

// ---------- exportação ----------

/**
 * Exporta pelo CLI, que só volta com o arquivo pronto. Legenda já está na
 * imagem (é camada), então nada de burnCaptions; o volume sai em -16 LUFS,
 * o padrão dos Reels; 6 Mbps é o que o Instagram recomenda e o que faz um
 * minuto caber nos 50 MB por arquivo do Supabase gratuito.
 */
export function exportarReel(projeto: string, saida: string, opcoes: { previaSegundos?: number } = {}) {
  const exportar = (kbps: number) => {
    const args = ['--project', projeto, 'export', saida, '--preset', 'Social Vertical 1080×1920',
      '--settings', JSON.stringify({ bitrateKbps: kbps, maxBitrateKbps: Math.round(kbps * 4 / 3), burnCaptions: false, effects: { loudness: { enabled: true, target_lufs: -16, true_peak_dbtp: -1 } } })];
    if (opcoes.previaSegundos) args.push('--start', '0', '--end', String(opcoes.previaSegundos), '--scale', '0.5');
    execFileSync(acharCli('filmcraft'), args, { stdio: 'ignore', timeout: 30 * 60_000 });
  };
  exportar(6000);
  // O balde do plano grátis recusa arquivo acima de 50 MB: um reel longo sai
  // de novo, com a taxa reduzida na proporção do que passou.
  const bytes = statSync(saida).size;
  if (bytes > TETO_REEL) exportar(Math.floor(6000 * (TETO_REEL * 0.9) / bytes));
}
const TETO_REEL = 48 * 1024 * 1024;

/** O áudio final em WAV, com a mesma normalização da exportação — é o que a conferência mede. */
export function exportarAudioFinal(projeto: string, saida: string) {
  execFileSync(acharCli('filmcraft'), ['--project', projeto, 'export', saida, '--format', 'wav', '--settings',
    JSON.stringify({ audio: { sample_rate: 48000, channels: 2, bits: 16, codec: 'pcm' }, effects: { loudness: { enabled: true, target_lufs: -16, true_peak_dbtp: -1 } } })],
  { stdio: 'ignore', timeout: 10 * 60_000 });
}

/** A transcrição guardada pelo worker na pasta do job, antes do agente começar. */
export const lerTranscricao = (pastaJob: string): Palavra[] => JSON.parse(readFileSync(path.join(pastaJob, 'entrada', 'transcricao.json'), 'utf8'));

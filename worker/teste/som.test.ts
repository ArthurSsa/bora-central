// O som dos vídeos: as regras (onde há fala, a curva da trilha, os atalhos
// de música) sem programa nenhum, e a mixagem de verdade no SoundCraft — a
// voz e a trilha em -16 LUFS, a trilha abaixando na fala, o editável que abre
// em outro PC — e a abertura que sai com a trilha da marca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli, RAIZ_REPO, type Config } from '../src/config.ts';
import { fontesInstaladas } from '../src/apps.ts';
import {
  curvaDaSessao, curvaDaTrilha, escreverWav, mixarSom, picoDb, prepararTrilha, somDaRodada, trechosDeFala, trilhaAbaixaNaFala, valorNaCurva, zipar,
} from '../src/som.ts';
import { lerWav, loudnessIntegrado, sondar } from '../src/video.ts';
import { audioDe } from '../src/som.ts';
import { produzir } from '../src/worker.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { BEATRIZ } from './marcas.ts';
import { temSoundCraft, trilhaDeTeste } from './trilha.ts';

test('trechos de fala: legendas com pausa curta viram um trecho só', () => {
  assert.deepEqual(trechosDeFala([
    { inicio: 0.2, fim: 1.0 }, { inicio: 1.3, fim: 2.0 }, { inicio: 4.0, fim: 5.0 }, { inicio: 5.5, fim: 5.4 },
  ]), [[0.2, 2.0], [4.0, 5.0]]);
});

test('a curva da trilha desce antes da fala, sobe depois e some no fim', () => {
  const c = curvaDaTrilha(10, [[2, 4]]);
  assert.equal(valorNaCurva(c, 1), -12);
  assert.equal(valorNaCurva(c, 3), -24);
  assert.equal(valorNaCurva(c, 6), -12);
  assert.equal(valorNaCurva(c, 10), -60);
  assert.ok(valorNaCurva(c, 1.9) < -12 && valorNaCurva(c, 1.9) > -24, 'desce em rampa');
  // Sem fala, a trilha vai sozinha no nível cheio; "mais baixa" desce 6 dB.
  assert.equal(valorNaCurva(curvaDaTrilha(10, []), 5), 0);
  assert.equal(valorNaCurva(curvaDaTrilha(10, [], 'baixa'), 5), -6);
  assert.equal(valorNaCurva(curvaDaTrilha(10, [[2, 4]], 'baixa'), 3), -30);
});

test('atalhos de música: "sem música" tira a trilha, "música mais baixa" traz de volta mais baixa', () => {
  const t = 'entrada/trilha.mp3';
  assert.deepEqual(somDaRodada(t, []), { trilha: t, nivel: 'normal' });
  assert.deepEqual(somDaRodada(t, [{ atalhos: ['sem música'] }]), { trilha: null, nivel: 'normal' });
  assert.deepEqual(somDaRodada(t, [{ atalhos: ['sem música'] }, { atalhos: ['música mais baixa'] }]), { trilha: t, nivel: 'baixa' });
  assert.deepEqual(somDaRodada(null, [{ atalhos: ['música mais baixa'] }]), { trilha: null, nivel: 'baixa' });
});

test('a conferência pega trilha que não abaixa na fala', () => {
  const falas: Array<[number, number]> = [[2, 4], [6, 8]];
  assert.deepEqual(trilhaAbaixaNaFala(curvaDaTrilha(10, falas), falas), []);
  const reta = [{ at: 0, value: -12 }, { at: 10, value: -12 }];
  assert.equal(trilhaAbaixaNaFala(reta, falas).length, 2);
  assert.match(trilhaAbaixaNaFala([], falas)[0], /não tem curva/);
});

test('mixagem no SoundCraft: voz e trilha em -16 LUFS, pico abaixo de -1 dB, trilha abaixando na fala, editável completo', {
  skip: !temSoundCraft && 'falta o SoundCraft', timeout: 180_000,
}, () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'som-'));
  // A "voz": rajadas de tom de fala (220 Hz com harmônicos) de 1 a 3 s e de 5 a 7 s.
  const taxa = 48000, dur = 9;
  const voz = Array.from({ length: dur * taxa }, (_, i) => {
    const t = i / taxa;
    const fala = (t > 1 && t < 3) || (t > 5 && t < 7);
    return fala ? 0.3 * (Math.sin(2 * Math.PI * 220 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 880 * t)) / 1.75 : 0;
  });
  escreverWav(path.join(pasta, 'voz.wav'), { taxa, canais: [voz] });
  const trilha = prepararTrilha(trilhaDeTeste(), path.join(pasta, 'trilha.wav'), dur);
  assert.equal(Math.round(lerWav(readFileSync(trilha)).canais[0].length / taxa), dur + 2, 'a trilha sai cortada no tamanho do vídeo');

  const falas = trechosDeFala([{ inicio: 1, fim: 3 }, { inicio: 5, fim: 7 }]);
  const m = mixarSom({ pasta, duracao: dur, voz: path.join(pasta, 'voz.wav'), trilha, falas });
  const a = lerWav(readFileSync(m.mix));
  assert.equal(a.canais[0].length, dur * taxa);
  const lufs = loudnessIntegrado(a);
  assert.ok(Math.abs(lufs + 16) <= 0.6, `${lufs.toFixed(2)} LUFS`);
  assert.ok(picoDb(a) <= -2.4, `pico ${picoDb(a).toFixed(2)} dB`);
  assert.ok(m.picoReal <= -1, `pico real ${m.picoReal.toFixed(2)} dB`);

  // A curva que ficou salva na sessão é a que a conferência lê.
  const curva = curvaDaSessao(m.sessao, 'trilha');
  assert.equal(valorNaCurva(curva, 2), -24);
  assert.equal(valorNaCurva(curva, 4.2), -12);
  assert.deepEqual(trilhaAbaixaNaFala(curva, falas), []);

  // O editável: um zip com a sessão e o áudio em 16 bits, que o próprio
  // SoundCraft abre de novo (extraído em outra pasta).
  zipar(pasta, path.join(pasta, 'som.zip'));
  const zip = readFileSync(path.join(pasta, 'som.zip'));
  // O registro final do zip diz quantos arquivos há dentro.
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50, 'não é um zip');
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 3, 'som.scraft e os dois arquivos de áudio');
  assert.ok(zip.length < 4 * 1024 * 1024, `${(zip.length / 1048576).toFixed(1)} MB`);
});

test('abertura com a trilha da marca: o vídeo sai com som em -16 LUFS e o editável do som', {
  skip: (!temSoundCraft || !existsSync(acharCli('effectcraft'))) && 'falta SoundCraft ou EffectCraft', timeout: 300_000,
}, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const raiz = mkdtempSync(path.join(tmpdir(), 'abertura-som-'));
  const fazer = (id: string, ajustes: Array<{ texto: string | null; atalhos: string[] }> = []) => produzir({
    cfg: { pastaJobs: raiz, tetoUsd: 1 } as Config, job: { id }, skill: skills.get('abertura-com-motion')!, skills,
    pedido: { id: 'p', tipo: 'reel', titulo: null, briefing: { texto: 'Turma nova do laboratório', formato: 'abertura' }, publicar_em: null },
    cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro, ajustes,
    arquivos: [{ nome: 'trilha.wav', conteudo: readFileSync(trilhaDeTeste()) }],
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {}, entregarParcial: async () => {},
  });

  const r = await fazer('abertura-com-trilha');
  const video = path.join(r.pastaJob, 'saida', 'reel.mp4');
  assert.ok(sondar(video).temAudio, 'a abertura saiu muda');
  const som = audioDe(video, path.join(r.pastaJob, '.trabalho', 'teste.wav'));
  assert.ok(Math.abs(loudnessIntegrado(som) + 16) <= 1, `${loudnessIntegrado(som).toFixed(1)} LUFS`);
  assert.ok(r.conferidas.some((c) => c.caminho === 'editavel/som.zip' && c.mime === 'application/zip'), 'o editável do som não subiria');

  // "Sem música" num ajuste: a mesma abertura, muda.
  const sem = await fazer('abertura-sem-musica', [{ texto: null, atalhos: ['sem música'] }]);
  assert.equal(sondar(path.join(sem.pastaJob, 'saida', 'reel.mp4')).temAudio, false);
  assert.ok(!sem.conferidas.some((c) => c.caminho === 'editavel/som.zip'));
});

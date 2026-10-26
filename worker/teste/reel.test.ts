// O reel de ponta a ponta, sem modelo e sem banco: um vídeo bruto com fala
// (gerada pela voz pt-BR do Windows) vira reel pelo roteiro — transcrição
// com o whisper.cpp, cortes, zoom, legendas na marca, prévia e completo — e
// passa na conferência de vídeo.
//
// Só roda no Windows (a fala de teste vem da voz do sistema) e com FilmCraft,
// PhotoCraft e whisper.cpp na máquina. PASTA_PREVIAS guarda o resultado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RAIZ_REPO, type Config } from '../src/config.ts';
import { fontesInstaladas } from '../src/apps.ts';
import { lerWav, loudnessIntegrado, sondar } from '../src/video.ts';
import { exportarAudioFinal, lerSrt } from '../src/reel.ts';
import { produzir } from '../src/worker.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { montarBrutoDeTeste, temTudoProReel } from './bruto.ts';
import { BEATRIZ } from './marcas.ts';
import { curvaDaSessao, trechosDeFala, trilhaAbaixaNaFala, valorNaCurva } from '../src/som.ts';
import { temSoundCraft, trilhaDeTeste } from './trilha.ts';

test('reel de bruto pelo roteiro: corta, legenda na marca, a trilha abaixando na fala, -16 LUFS e passa na conferência', {
  skip: !temTudoProReel && 'falta FilmCraft, PhotoCraft, whisper.cpp ou a voz do Windows', timeout: 600_000,
}, async () => {
  const bruto = montarBrutoDeTeste();
  const segundosBruto = sondar(bruto).segundos;
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const etapas: string[] = [];
  const parciais: string[] = [];
  const raiz = process.env.PASTA_PREVIAS ?? mkdtempSync(path.join(tmpdir(), 'jobs-'));
  const r = await produzir({
    cfg: { pastaJobs: raiz, tetoUsd: 1 } as Config, job: { id: 'reel-beatriz' }, skill: skills.get('reel-de-bruto')!, skills,
    pedido: { id: 'p', tipo: 'reel', titulo: null, briefing: { texto: 'Turma nova do laboratório de redes' }, publicar_em: null },
    cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro,
    arquivos: [{ nome: 'bruto.mp4', conteudo: readFileSync(bruto) }, ...(temSoundCraft ? [{ nome: 'trilha.wav', conteudo: readFileSync(trilhaDeTeste()) }] : [])],
    abortar: new AbortController(), aoMudarEtapa: async (e) => { etapas.push(e.etapa); }, aoUsarFerramenta: () => {},
    entregarParcial: async (c) => { parciais.push(c); },
  });

  // A transcrição saiu em português, com acento, antes do agente.
  const fala = readFileSync(path.join(r.pastaJob, 'entrada', 'transcricao.txt'), 'utf8');
  assert.match(fala, /laboratório/);
  assert.match(fala, /Mas não precisa\. Mas não precisa mesmo\./);
  assert.equal(etapas[0], 'ouvindo o vídeo');
  // A prévia foi entregue antes do reel completo existir.
  assert.deepEqual(parciais, ['saida/previa.mp4']);
  assert.ok(etapas.indexOf('preparando a prévia') < etapas.indexOf('finalizando o som'));

  // Cortou: o reel é bem mais curto que o bruto, e a frase repetida saiu.
  const reel = sondar(path.join(r.pastaJob, 'saida', 'reel.mp4'));
  assert.ok(reel.segundos < segundosBruto * 0.85, `reel ${reel.segundos}s de ${segundosBruto}s`);
  assert.deepEqual([reel.largura, reel.altura], [1080, 1920]);
  const legendas = lerSrt(readFileSync(path.join(r.pastaJob, 'saida', 'legendas.srt'), 'utf8'));
  const tudo = legendas.map((l) => l.texto).join(' ');
  assert.equal((tudo.match(/Mas não precisa/g) ?? []).length, 1, 'a frase repetida ficou');
  assert.doesNotMatch(tudo, /tipo assim/);
  assert.ok(legendas.length > 10);
  // O som em -16 LUFS, medido aqui de novo.
  const wav = path.join(r.pastaJob, '.trabalho', 'medido-no-teste.wav');
  exportarAudioFinal(path.join(r.pastaJob, 'editavel', 'reel.fcproj'), wav);
  const lufs = loudnessIntegrado(lerWav(readFileSync(wav)));
  assert.ok(Math.abs(lufs + 16) <= 1, `${lufs.toFixed(1)} LUFS`);

  // O som passou pelo SoundCraft: a trilha abaixa em cada trecho com legenda,
  // e o editável do som sobe junto.
  assert.ok(etapas.indexOf('cuidando do som') < etapas.indexOf('preparando a prévia'));
  assert.ok(r.conferidas.some((c) => c.caminho === 'editavel/som.zip'), 'o editável do som não subiria');
  if (temSoundCraft) {
    // Sem as pausas, a fala do reel vira um trecho quase contínuo: a trilha
    // fica baixa debaixo dela toda e só sobe nas pontas.
    const falas = trechosDeFala(legendas);
    assert.ok(falas.length >= 1);
    const curva = curvaDaSessao(path.join(r.pastaJob, 'editavel', 'som', 'som.scraft'), 'trilha');
    assert.deepEqual(trilhaAbaixaNaFala(curva, falas), []);
    assert.equal(valorNaCurva(curva, (falas[0][0] + falas[0][1]) / 2), -24);
  }
});

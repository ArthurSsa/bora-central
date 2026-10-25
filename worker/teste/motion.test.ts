// O motion pelo roteiro, com o EffectCraft de verdade: a abertura de 10 s, e
// um carrossel feito no PhotoCraft que vira vídeo. Os dois passam na
// conferência de motion (duração, fonte, cores dos quadros, área segura).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli, RAIZ_REPO, type Config } from '../src/config.ts';
import { fontesInstaladas } from '../src/apps.ts';
import { cenaDeAbertura, fontesDoProjeto, montarCena, SEGUNDOS_ABERTURA, SEGUNDOS_POR_SLIDE } from '../src/motion.ts';
import { conferirMotion } from '../src/conferencia.ts';
import { produzir } from '../src/worker.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { sondar } from '../src/video.ts';
import { BEATRIZ, MOACYR } from './marcas.ts';

const temTudo = existsSync(acharCli('effectcraft')) && existsSync(acharCli('photocraft'));
const raiz = process.env.PASTA_PREVIAS ?? mkdtempSync(path.join(tmpdir(), 'motion-'));
const cfg = { pastaJobs: raiz, tetoUsd: 1 } as Config;
const conjunto = { nome: 'Azul', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' };

test('a cena leva o texto do cliente só como literal: aspas, barra e quebra de linha não viram código', () => {
  const malicioso = 'Turma "nova"); app.quit(); ("\\ e\nlinha */';
  const s = cenaDeAbertura({ fonte: 'Manrope-ExtraBold', conjunto, impacto: false, alinhamento: 'left', margem: 96 }, { titulo: malicioso, rotulo: '@conta' });
  assert.ok(s.includes(JSON.stringify(malicioso)), 'o título não entrou como literal JSON');
  assert.ok(!s.includes(malicioso), 'o título apareceu cru no script');
  assert.equal(s.split('app.quit').length, 2, 'só a ocorrência dentro do literal');
});

test('as fontes do projeto saem do .ecproj', () => {
  const proj = { items: [{ layers: [{ props: { children: [{ value: { t: 'Text', v: { text: 'a', font: 'Manrope-ExtraBold' } } }, { value: { t: 'Text', v: { font: 'Anton-Regular' } } }] } }] }] };
  assert.deepEqual(fontesDoProjeto(JSON.stringify(proj)), ['Manrope-ExtraBold', 'Anton-Regular']);
});

test('a conferência de motion reprova cor fora da paleta e texto fora da área segura', {
  skip: !temTudo && 'falta EffectCraft', timeout: 120_000,
}, () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'motion-torto-'));
  const projeto = path.join(pasta, 'editavel', 'abertura.ecproj');
  const torta = { ...conjunto, faixa: '#FF00FF' };
  montarCena(cenaDeAbertura({ fonte: 'Manrope-ExtraBold', conjunto: torta, impacto: false, alinhamento: 'left', margem: 96 }, { titulo: 'Título', rotulo: null }), path.join(pasta, '.trabalho'), projeto);
  const cores = ['#1E2A3A', '#FFFFFF', '#A4E830'];
  const r = conferirMotion(pasta, [], { cores, fonte: 'Manrope', projeto, segundos: 10, momentos: [9.9] });
  assert.ok(r.erros.some((e) => /#F[0-9A-F]00F[0-9A-F]|não é da paleta/.test(e)), r.erros.join('; '));

  // Texto colado no topo: a área segura começa em 10% da altura.
  const alto = cenaDeAbertura({ fonte: 'Manrope-ExtraBold', conjunto, impacto: false, alinhamento: 'left', margem: 96 }, { titulo: 'Título', rotulo: null })
    .replace('var y = 880 -', 'var y = 60 -');
  montarCena(alto, path.join(pasta, '.trabalho'), projeto);
  const r2 = conferirMotion(pasta, [], { cores, fonte: 'Anton', projeto, segundos: 10, momentos: [9.9] });
  assert.ok(r2.erros.some((e) => /área segura/.test(e)), r2.erros.join('; '));
  assert.ok(r2.erros.some((e) => /a fonte da marca é "Anton"/.test(e)), 'fonte errada passou');
});

const nada = { abortar: new AbortController(), aoUsarFerramenta: () => {} };
const pedidoDe = (briefing: Record<string, unknown>) => ({ id: 'p', tipo: 'reel', titulo: null, briefing, publicar_em: null });

for (const [quem, cliente] of [['beatriz', BEATRIZ], ['moacyr', MOACYR]] as const) {
  test(`${quem}: abertura de 10 s pelo roteiro, com prévia antes e quanto falta durante`, {
    skip: !temTudo && 'falta EffectCraft ou PhotoCraft', timeout: 300_000,
  }, async () => {
    const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
    const etapas: Array<{ etapa: string; progresso: number; restam?: number | null }> = [];
    const parciais: string[] = [];
    const r = await produzir({
      cfg, job: { id: `${quem}-abertura` }, skill: skills.get('abertura-com-motion')!, skills,
      pedido: pedidoDe({ texto: 'Turma nova do laboratório: inscrições até sexta', formato: 'abertura' }),
      cliente, instaladas: fontesInstaladas(), agente: rodarRoteiro, ...nada,
      aoMudarEtapa: async (e) => { etapas.push({ etapa: e.etapa, progresso: e.progresso, restam: e.restamSegundos }); },
      entregarParcial: async (c) => { parciais.push(c); },
    });
    assert.deepEqual(parciais, ['saida/previa.mp4']);
    const ordem = etapas.map((e) => e.etapa);
    assert.ok(ordem.indexOf('preparando a prévia') < ordem.indexOf('animando'));
    for (let i = 1; i < etapas.length; i++) assert.ok(etapas[i].progresso >= etapas[i - 1].progresso, 'a barra voltou');
    // O render contou os quadros e disse quanto faltava (medido, não chutado).
    assert.ok(etapas.some((e) => e.etapa === 'animando' && e.restam != null), JSON.stringify(etapas));

    const reel = sondar(path.join(r.pastaJob, 'saida', 'reel.mp4'));
    assert.deepEqual([reel.largura, reel.altura], [1080, 1920]);
    assert.ok(Math.abs(reel.segundos - SEGUNDOS_ABERTURA) <= 0.25, `${reel.segundos} s`);
    const previa = sondar(path.join(r.pastaJob, 'saida', 'previa.mp4'));
    assert.ok(previa.segundos <= 3.5, `prévia de ${previa.segundos} s`);
    const fontes = fontesDoProjeto(readFileSync(path.join(r.pastaJob, 'editavel', 'abertura.ecproj'), 'utf8'));
    assert.ok(fontes.every((f) => f.toLowerCase().startsWith(r.fonte.usada.replace(/\s+/g, '').toLowerCase())), fontes.join(', '));
    assert.match(readFileSync(path.join(r.pastaJob, 'saida', 'legenda.txt'), 'utf8'), /Turma nova do laboratório/);
  });
}

test('carrossel em vídeo: as imagens aprovadas entram na ordem, sobre o fundo da marca', {
  skip: !temTudo && 'falta EffectCraft ou PhotoCraft', timeout: 300_000,
}, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const instaladas = fontesInstaladas();
  const texto = 'Não existe atalho pra liderar. Liderança se aprende fazendo. Organização vem antes de talento';
  const car = await produzir({
    cfg, job: { id: 'beatriz-carrossel-origem' }, skill: skills.get('carrossel')!, skills,
    pedido: { id: 'c', tipo: 'carrossel', titulo: null, briefing: { texto, slides: 3 }, publicar_em: null },
    cliente: BEATRIZ, instaladas, agente: rodarRoteiro, ...nada, aoMudarEtapa: async () => {},
  });
  const slides = car.conferidas.filter((c) => /^saida\/slide-\d+\.png$/.test(c.caminho))
    .map((c) => ({ nome: `slides/${path.basename(c.caminho)}`, conteudo: readFileSync(path.join(car.pastaJob, c.caminho)) }));
  assert.equal(slides.length, 3);

  const r = await produzir({
    cfg, job: { id: 'beatriz-carrossel-video' }, skill: skills.get('carrossel-em-video')!, skills,
    pedido: pedidoDe({ texto, formato: 'carrossel', de_pedido: 'c' }),
    cliente: BEATRIZ, instaladas, agente: rodarRoteiro, ...nada, arquivos: slides,
    aoMudarEtapa: async () => {}, entregarParcial: async () => {},
  });
  const reel = sondar(path.join(r.pastaJob, 'saida', 'reel.mp4'));
  assert.deepEqual([reel.largura, reel.altura], [1080, 1920]);
  assert.ok(Math.abs(reel.segundos - (3 * SEGUNDOS_POR_SLIDE + 0.5)) <= 0.25, `${reel.segundos} s`);
});

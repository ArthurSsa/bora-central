// O VectorCraft na fábrica: a regra de qual logo vai sobre cada fundo e a
// leitura do PDF sem programa nenhum; e com o app de verdade, o logo vetorial
// virando PNG (nas cores dele e de uma cor), o cartaz A4 e A3 pelo roteiro
// passando na conferência, e o post saindo com o logo que lê sobre o fundo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli, RAIZ_REPO, type Config } from '../src/config.ts';
import { fontesInstaladas } from '../src/apps.ts';
import { lerPng } from '../src/png.ts';
import { produzir } from '../src/worker.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { dimensoesPng } from '../src/verificar.ts';
import { caixasDoPdf, estiloDoPeso, logoParaOFundo, prepararLogoVetorial, SANGRIA_PT } from '../src/vetor.ts';
import { BEATRIZ } from './marcas.ts';

const temVectorCraft = existsSync(acharCli('vectorcraft'));
const NOITE = { nome: 'Azul-noite', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' };
const LIMAO = { nome: 'Verde-limão', fundo: '#A4E830', tinta: '#1E2A3A', destaque: '#1E2A3A', faixa: '#1E2A3A' };

/** Um logo de duas cores da Beatriz: um quadrado verde-limão e um círculo azul-noite. */
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">'
  + '<rect x="0" y="10" width="80" height="80" rx="16" fill="#A4E830"/><circle cx="140" cy="50" r="40" fill="#1E2A3A"/></svg>';

test('o logo de cores some quando uma cor dele é a do fundo: vai a versão de uma cor, na tinta do conjunto', () => {
  const l = { arquivo: 'logo.png', cores: ['#A4E830', '#1E2A3A'], mono: { '#FFFFFF': 'logo-mono-FFFFFF.png', '#1E2A3A': 'logo-mono-1E2A3A.png' } };
  assert.equal(logoParaOFundo(l, NOITE), 'logo-mono-FFFFFF.png');
  assert.equal(logoParaOFundo(l, LIMAO), 'logo-mono-1E2A3A.png');
  // Verde-limão sobre branco dá 1,3:1 — também some. Num vermelho médio, as duas leem.
  assert.equal(logoParaOFundo(l, { ...NOITE, fundo: '#FFFFFF', tinta: '#1E2A3A' }), 'logo-mono-1E2A3A.png');
  assert.equal(logoParaOFundo(l, { ...NOITE, fundo: '#C0392B' }), 'logo.png', 'sobre o vermelho as duas cores leem');
  assert.equal(logoParaOFundo({ arquivo: 'foto.png' }, NOITE), 'foto.png', 'logo em PNG fica como veio');
});

test('as caixas do PDF e o estilo de cada peso', () => {
  const pdf = Buffer.from('<< /Type /Page /MediaBox [0 0 648.78 895.4] /TrimBox [26.75 26.75 622.03 868.64] /BleedBox [18.25 18.25 630.53 877.14] >>', 'latin1');
  const c = caixasDoPdf(pdf);
  assert.deepEqual(c.trim, [26.75, 26.75, 622.03, 868.64]);
  assert.ok(Math.abs(c.trim![0] - c.bleed![0] - SANGRIA_PT) < 0.1);
  assert.deepEqual(caixasDoPdf(Buffer.from('nada')), { trim: null, bleed: null, media: null });
  assert.equal(estiloDoPeso(700), 'Bold');
  assert.equal(estiloDoPeso(520), 'Medium');
});

test('logo vetorial vira PNG nítido nas cores dele e de uma cor em cada tinta', {
  skip: !temVectorCraft && 'falta o VectorCraft', timeout: 120_000,
}, () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'logo-'));
  writeFileSync(path.join(pasta, 'logo.svg'), LOGO_SVG);
  const l = prepararLogoVetorial(path.join(pasta, 'logo.svg'), pasta, 'logo-1', ['#FFFFFF', '#1E2A3A']);
  assert.deepEqual([l.largura, l.altura], [1200, 533], 'o lado maior em 1200 px, na proporção do desenho');
  assert.deepEqual(l.cores.sort(), ['#1E2A3A', '#A4E830']);
  // A versão branca: todo pixel que aparece é branco.
  const branco = lerPng(readFileSync(l.mono['#FFFFFF']));
  let opacos = 0, fora = 0;
  for (let i = 0; i < branco.largura * branco.altura; i++) {
    if (branco.alfa[i] < 250) continue;
    opacos++;
    if (branco.rgb[i * 3] < 250 || branco.rgb[i * 3 + 1] < 250 || branco.rgb[i * 3 + 2] < 250) fora++;
  }
  assert.ok(opacos > 100_000, `${opacos} pixels opacos`);
  assert.equal(fora, 0, 'a versão de uma cor tem pixel de outra cor');
});

for (const folha of ['a4', 'a3'] as const) {
  test(`cartaz ${folha.toUpperCase()} pelo roteiro: PDF com sangria, PNG, editáveis, logo de uma cor no fundo escuro, e passa na conferência`, {
    skip: !temVectorCraft && 'falta o VectorCraft', timeout: 180_000,
  }, async () => {
    const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
    const r = await produzir({
      cfg: { pastaJobs: mkdtempSync(path.join(tmpdir(), 'cartaz-')), tetoUsd: 1 } as Config, job: { id: `cartaz-${folha}` },
      skill: skills.get('cartaz-impressao')!, skills,
      pedido: { id: 'p', tipo: 'cartaz', titulo: null, briefing: { texto: 'Turma nova do laboratório: inscrições até sexta', folha }, publicar_em: null },
      cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro,
      arquivos: [{ nome: 'elementos/logo-1.svg', conteudo: Buffer.from(LOGO_SVG) }],
      elementos: [{ tipo: 'logo', nome: 'Logo', arquivo: 'entrada/elementos/logo-1.svg', largura: null, altura: null }],
      abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {}, entregarParcial: async () => {},
    });
    assert.deepEqual(r.conferidas.map((c) => c.caminho).sort(),
      ['editavel/cartaz.ai', 'editavel/cartaz.vectorcraft', 'saida/cartaz.pdf', 'saida/cartaz.png']);
    assert.equal(r.conferidas.find((c) => c.caminho.endsWith('.pdf'))!.mime, 'application/pdf');
    const { trim, bleed } = caixasDoPdf(readFileSync(path.join(r.pastaJob, 'saida', 'cartaz.pdf')));
    const mm = (pt: number) => Math.round(pt / (72 / 25.4));
    assert.deepEqual([mm(trim![2] - trim![0]), mm(trim![3] - trim![1])], folha === 'a4' ? [210, 297] : [297, 420]);
    assert.deepEqual([mm(bleed![2] - bleed![0]), mm(bleed![3] - bleed![1])], folha === 'a4' ? [216, 303] : [303, 426]);
    assert.deepEqual(dimensoesPng(readFileSync(path.join(r.pastaJob, 'saida', 'cartaz.png'))), { largura: 1080, altura: 1527 });

    // O logo entrou na versão branca (o círculo azul-noite sumiria no fundo azul-noite):
    // no canto do logo há branco e nenhum verde-limão.
    const img = lerPng(readFileSync(path.join(r.pastaJob, 'saida', 'cartaz.png')));
    let brancos = 0, limoes = 0;
    for (let y = 1300; y < 1480; y++) for (let x = 760; x < 1030; x++) {
      const i = (y * img.largura + x) * 3;
      const [cr, cg, cb] = [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
      if (cr > 245 && cg > 245 && cb > 245) brancos++;
      if (Math.abs(cr - 0xa4) < 12 && Math.abs(cg - 0xe8) < 12 && Math.abs(cb - 0x30) < 12) limoes++;
    }
    assert.ok(brancos > 4000, `${brancos} px brancos no canto do logo`);
    assert.equal(limoes, 0, 'o logo entrou nas cores originais sobre o fundo azul-noite');
  });
}

test('post com logo vetorial: sobre o azul-noite, o logo sai branco e passa na conferência de marca', {
  skip: !temVectorCraft && 'falta o VectorCraft', timeout: 180_000,
}, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const r = await produzir({
    cfg: { pastaJobs: mkdtempSync(path.join(tmpdir(), 'post-logo-')), tetoUsd: 1 } as Config, job: { id: 'post-logo-svg' },
    skill: skills.get('post-feed')!, skills,
    pedido: { id: 'p', tipo: 'post-feed', titulo: null, briefing: { texto: 'Turma nova do laboratório: inscrições até sexta' }, publicar_em: null },
    cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro,
    arquivos: [{ nome: 'elementos/logo-1.svg', conteudo: Buffer.from(LOGO_SVG) }],
    elementos: [{ tipo: 'logo', nome: 'Logo', arquivo: 'entrada/elementos/logo-1.svg', largura: null, altura: null }],
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {}, entregarParcial: async () => {},
  });
  const img = lerPng(readFileSync(path.join(r.pastaJob, 'saida', 'post.png')));
  // O logo vai centrado em (1080 - margem - 70, 1350 - margem - 30), com 140 px.
  let brancos = 0, limoes = 0;
  for (let y = 1195; y < 1255; y++) for (let x = 846; x < 984; x++) {
    const i = (y * img.largura + x) * 3;
    const [cr, cg, cb] = [img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]];
    if (cr > 245 && cg > 245 && cb > 245) brancos++;
    if (Math.abs(cr - 0xa4) < 12 && Math.abs(cg - 0xe8) < 12 && Math.abs(cb - 0x30) < 12) limoes++;
  }
  assert.ok(brancos > 1500, `${brancos} px brancos onde vai o logo`);
  assert.equal(limoes, 0, 'o logo entrou nas cores originais');
});

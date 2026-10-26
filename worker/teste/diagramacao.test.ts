// O DesignCraft na fábrica: a distribuição das caixas sem programa nenhum; e
// com o app de verdade, o guia de 8 páginas e o folheto dobrável pelo roteiro
// passando na conferência, a letra encolhendo quando a ideia é longa, e o
// pedido com ideias de menos recusado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli, RAIZ_REPO, type Config } from '../src/config.ts';
import { fontesInstaladas } from '../src/apps.ts';
import { caixasDoMaterial, lerMaterial, MODELOS, validarPdfX4, type Material } from '../src/diagramacao.ts';
import { produzir } from '../src/worker.ts';
import { rodarRoteiro } from '../src/roteiro.ts';
import { carregarSkills } from '../src/skills.ts';
import { caixasDoPdf } from '../src/vetor.ts';
import { BEATRIZ } from './marcas.ts';

const temDesignCraft = existsSync(acharCli('designcraft'));
const NOITE = { nome: 'Azul-noite', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' };
const PEDIDO_GUIA = 'Cinco erros de quem começa a treinar. Começar pesado demais na primeira semana. Pular o aquecimento. '
  + 'Treinar todo dia sem descanso. Copiar o treino de quem treina há anos. Desistir quando o resultado demora. Não beber água durante o treino.';

const material = (o: Partial<Material>): Material => ({
  modelo: 'guia', paginas: 8, conjunto: NOITE, fonte: 'Manrope', pesos: { titulo: 700, texto: 500 }, impacto: false, alinhamento: 'left',
  titulo: 'Título', apoio: null, ideias: ['a', 'b', 'c', 'd', 'e', 'f'], chamada: null, assinatura: '@conta', logo: 'logo.png', ...o,
});

test('as caixas do guia e do folheto ficam dentro da margem, e o guia tem uma página de miolo por ideia', () => {
  for (const modelo of ['guia', 'folheto'] as const) {
    const { caixas, paginas } = caixasDoMaterial(material({ modelo }));
    const md = MODELOS[modelo];
    for (const c of caixas) {
      const [x0, y0, x1, y1] = c.rect;
      assert.ok(x0 >= md.margem - 0.01 && y0 >= md.margem - 0.01 && x1 <= md.largura - md.margem + 0.01 && y1 <= md.altura - md.margem + 0.01, `${modelo} ${c.chave} fora da margem`);
    }
    assert.equal(paginas, modelo === 'guia' ? 8 : 2);
  }
  const ideias = caixasDoMaterial(material({})).caixas.filter((c) => c.chave.startsWith('ideia-'));
  assert.deepEqual(ideias.map((c) => c.pagina), [1, 2, 3, 4, 5, 6]);
});

test('guia de 8 páginas pelo roteiro: PDF leve, oito prévias, editável e IDML, e passa na conferência', {
  skip: !temDesignCraft && 'falta o DesignCraft', timeout: 180_000,
}, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const r = await produzir({
    cfg: { pastaJobs: mkdtempSync(path.join(tmpdir(), 'guia-')), tetoUsd: 1 } as Config, job: { id: 'guia-8' }, skill: skills.get('guia-pdf')!, skills,
    pedido: { id: 'p', tipo: 'material', titulo: null, briefing: { texto: PEDIDO_GUIA, formato: 'guia', paginas: 8 }, publicar_em: null },
    cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro,
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {}, entregarParcial: async () => {},
  });
  const nomes = r.conferidas.map((c) => c.caminho);
  assert.ok(nomes.includes('saida/guia.pdf') && nomes.includes('editavel/guia.designcraft') && nomes.includes('editavel/guia.idml'));
  assert.equal(nomes.filter((n) => /pagina-\d+\.png$/.test(n)).length, 8);
  const pdf = readFileSync(path.join(r.pastaJob, 'saida', 'guia.pdf'));
  assert.ok(pdf.length < 2 * 1024 * 1024, `${pdf.length} bytes: o guia é pra mandar no WhatsApp`);
  assert.equal(caixasDoPdf(pdf).bleed?.[0] ?? 0, caixasDoPdf(pdf).trim?.[0] ?? 0, 'o guia de tela não leva sangria');
  // O texto da página 2 é a primeira ideia do pedido, e nada sobrou.
  assert.equal(lerMaterial(path.join(r.pastaJob, 'editavel', 'guia.designcraft'), r.pastaJob).sobrando, 0);
});

test('folheto dobrável pelo roteiro: PDF/X-4 com 3 mm de sangria, frente e verso, e o aviso da cor que o CMYK não alcança', {
  skip: !temDesignCraft && 'falta o DesignCraft', timeout: 180_000,
}, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const r = await produzir({
    cfg: { pastaJobs: mkdtempSync(path.join(tmpdir(), 'folheto-')), tetoUsd: 1 } as Config, job: { id: 'folheto' }, skill: skills.get('folheto-dobravel')!, skills,
    pedido: { id: 'p', tipo: 'material', titulo: null, briefing: { texto: PEDIDO_GUIA, formato: 'folheto' }, publicar_em: null },
    cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro,
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {}, entregarParcial: async () => {},
  });
  const pdf = path.join(r.pastaJob, 'saida', 'folheto.pdf');
  assert.deepEqual(validarPdfX4(pdf), { valido: true, problemas: [] });
  const { trim, bleed } = caixasDoPdf(readFileSync(pdf));
  const mm = (pt: number) => Math.round(pt / (72 / 25.4));
  assert.deepEqual([mm(trim![2] - trim![0]), mm(trim![3] - trim![1])], [297, 210]);
  assert.deepEqual([mm(bleed![2] - bleed![0]), mm(bleed![3] - bleed![1])], [303, 216]);
  assert.ok(r.avisos.some((a) => /#A4E830 sai como/.test(a)), r.avisos.join(' | '));
});

test('ideia longa: a letra encolhe até caber; ideias de menos: o pedido volta dizendo quantas faltam', {
  skip: !temDesignCraft && 'falta o DesignCraft', timeout: 180_000,
}, async () => {
  const skills = carregarSkills(path.join(RAIZ_REPO, 'skills'));
  const fazer = (texto: string, id: string) => produzir({
    cfg: { pastaJobs: mkdtempSync(path.join(tmpdir(), 'guia-')), tetoUsd: 1 } as Config, job: { id }, skill: skills.get('guia-pdf')!, skills,
    pedido: { id: 'p', tipo: 'material', titulo: null, briefing: { texto, formato: 'guia', paginas: 6 }, publicar_em: null },
    cliente: BEATRIZ, instaladas: fontesInstaladas(), agente: rodarRoteiro,
    abortar: new AbortController(), aoMudarEtapa: async () => {}, aoUsarFerramenta: () => {}, entregarParcial: async () => {},
  });
  const longa = 'Cada repetição feita com pressa, sem controlar a descida do peso e sem respirar no ritmo certo, ensina ao corpo um movimento que depois vai cobrar o preço nas articulações, nos tendões e na vontade de voltar no dia seguinte';
  const r = await fazer(`Quatro lembretes. ${longa}. Dormir bem conta. Comer antes do treino ajuda. Alongar no fim.`, 'guia-longa');
  assert.equal(lerMaterial(path.join(r.pastaJob, 'editavel', 'guia.designcraft'), r.pastaJob).sobrando, 0);
  await assert.rejects(fazer('Três lembretes. Dormir bem. Comer antes.', 'guia-curta'), /faltam ideias: o guia de 6 páginas leva 4/);
});

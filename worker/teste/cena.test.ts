// A cena do v2 (src/cena.ts) e a medida de fidelidade (scripts/fidelidade.ts):
//   - os comandos que a fábrica roda pra cada objeto;
//   - a comparação de imagens que a medida usa;
//   - com o PhotoCraft: a cena vira PSD e PNG, as linhas de cada texto voltam,
//     e a linha de base da primeira linha é a que o Studio usa pra alinhar
//     (se um PhotoCraft novo mudar isso, a prévia desalinha: este teste avisa).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fontesInstaladas } from '../src/apps.ts';
import { baselineDaFabrica, comandosDaCena, exportarCena, type Cena } from '../src/cena.ts';
import { compararImagens } from '../scripts/fidelidade.ts';

let instaladas: string[] = [];
try { instaladas = fontesInstaladas(); } catch { /* sem PhotoCraft */ }
const semFontes = !instaladas.includes('Manrope') || !instaladas.includes('Anton') ? 'PhotoCraft, Manrope ou Anton fora da máquina' : false;

const CENA: Cena = { versao: 1, nome: 'teste', largura: 1080, altura: 1350, fundo: '#1E2A3A', objetos: [
  { tipo: 'forma', id: 'faixa', x: 72, y: 240, largura: 140, altura: 14, cor: '#A4E830' },
  { tipo: 'texto', id: 'titulo', x: 72, y: 280, largura: 936, texto: 'Turma nova do laboratório de redes: inscrições até sexta', fonte: 'Manrope', peso: 700, tamanho: 92, cor: '#FFFFFF', alinhamento: 'left', entrelinha: 1.2 },
] };

test('cada objeto da cena vira uma camada, na mesma ordem, com a entrelinha em pt', () => {
  const cmds = comandosDaCena(CENA);
  assert.deepEqual(cmds.map((c) => c.cmd), ['shape.create', 'type.create']);
  assert.deepEqual(cmds[0].params.rect, [72, 240, 140, 14]);
  assert.equal(cmds[1].params.leading, 110.4);
  assert.equal(cmds[1].params.name, 'titulo');
});

test('a comparação conta os pixels diferentes na peça e só nas caixas de texto', () => {
  const img = (cor: number) => ({ largura: 10, altura: 10, rgba: new Uint8Array(400).fill(cor) });
  const a = img(0), b = img(0);
  for (let p = 0; p < 10; p++) b.rgba.set([255, 255, 255, 255], p * 4); // a primeira linha de pixels
  const r = compararImagens(a, b, [[0, 0, 10, 2]]);
  assert.equal(r.geral, 0.1);
  assert.equal(r.texto, 0.5);
});

test('a fábrica exporta a cena e devolve as linhas; a linha de base da Manrope e da Anton é a que o Studio usa', { skip: semFontes, timeout: 120_000 }, () => {
  const r = exportarCena(CENA, mkdtempSync(path.join(tmpdir(), 'cena-')));
  assert.deepEqual(r.textos[0].linhas, ['Turma nova do', 'laboratório de redes:', 'inscrições até sexta']);
  assert.equal(Math.round(baselineDaFabrica('Manrope', 700) * 100) / 100, 0.72);
  assert.equal(Math.round(baselineDaFabrica('Manrope', 400) * 100) / 100, 0.72);
  assert.equal(Math.round(baselineDaFabrica('Anton', 400) * 100) / 100, 0.86);
});

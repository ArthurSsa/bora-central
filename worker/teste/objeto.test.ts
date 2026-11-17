// A imagem gerada vira objeto (src/objeto.ts), com uma ilustração chapada
// desenhada aqui no PhotoCraft, sem provedor pago: o fundo liso é achado e
// sai; o vetor sai sem o fundo, com as cores da ilustração, e recolore pela
// paleta da marca. Pula sem PhotoCraft ou VectorCraft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli } from '../src/config.ts';
import { corDoFundoLiso, corMaisPerto, julgarObjeto, recortar, vetorizar } from '../src/objeto.ts';
import { lerPngRgba } from '../src/png.ts';

const semApps = !existsSync(acharCli('photocraft')) || !existsSync(acharCli('vectorcraft')) ? 'falta o PhotoCraft ou o VectorCraft' : false;

test('fundo liso: os quatro cantos da mesma cor; fundo cheio devolve null', () => {
  const img = (cantoDiferente: boolean) => {
    const rgba = new Uint8Array(100 * 100 * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([244, 235, 221, 255], i);
    if (cantoDiferente) for (let y = 90; y < 100; y++) for (let x = 90; x < 100; x++) rgba.set([20, 20, 20, 255], (y * 100 + x) * 4);
    return { largura: 100, altura: 100, rgba };
  };
  assert.equal(corDoFundoLiso(img(false)), '#F4EBDD');
  assert.equal(corDoFundoLiso(img(true)), null);
  assert.equal(corMaisPerto('#C8843F', ['#1E2A3A', '#E8A33D', '#FFFFFF']), '#E8A33D');
});

test('ilustração chapada: o fundo sai, o objeto fica com a caixa certa, e o vetor recolore pela paleta', { skip: semApps, timeout: 180_000 }, () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'objeto-'));
  const imagem = path.join(pasta, 'pao.png');
  execFileSync(acharCli('photocraft'), ['run', '--new', JSON.stringify({ width: 1024, height: 1024, background: '#F4EBDD' }),
    '--cmd', 'shape.create', '--params', JSON.stringify({ kind: 'ellipse', rect: [212, 380, 600, 300], fill: '#C8843F' }),
    '--cmd', 'shape.create', '--params', JSON.stringify({ kind: 'ellipse', rect: [262, 410, 500, 180], fill: '#E2A65E' }),
    '--cmd', 'file.saveACopy', '--params', JSON.stringify({ path: imagem })], { stdio: 'ignore' });

  const r = recortar(imagem, path.join(pasta, 'pao-recorte.png'));
  assert.equal(r.fundoLiso, '#F4EBDD');
  // A caixa do objeto é a da elipse maior (com 1 px de folga pela borda suavizada).
  assert.ok(Math.abs(r.area[0] - 212) <= 2 && Math.abs(r.area[1] - 380) <= 2 && Math.abs(r.area[2] - 600) <= 3 && Math.abs(r.area[3] - 300) <= 3, String(r.area));
  const recorte = lerPngRgba(readFileSync(r.arquivo));
  assert.equal(recorte.rgba[3], 0, 'o canto do recorte (fora da elipse) ficou opaco');

  const v = vetorizar(imagem, path.join(pasta, 'pao.svg'), { cores: 4, fundo: r.fundoLiso, paleta: ['#7A3E1D', '#E8A33D', '#FFFFFF'] });
  const svg = readFileSync(v.arquivo, 'utf8');
  assert.doesNotMatch(svg, /#f4ebdd/i, 'o fundo ficou no vetor');
  assert.ok(v.cores.every((c) => ['#7A3E1D', '#E8A33D', '#FFFFFF'].includes(c)), v.cores.join(', '));
  assert.equal(julgarObjeto(r, v), null);
});

// O vídeo bruto de teste, usado pelo teste do roteiro e pelo do app: fala
// gerada pela voz pt-BR do Windows sobre um quadro parado, montada no FilmCraft.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli, RAIZ_WORKER } from '../src/config.ts';
import { acharWhisper } from '../src/video.ts';

/** Tem tudo pra fazer reel nesta máquina: FilmCraft, PhotoCraft, whisper.cpp e a voz do Windows. */
export const temTudoProReel = process.platform === 'win32' && existsSync(acharCli('filmcraft')) && existsSync(acharCli('photocraft'))
  && existsSync(acharWhisper().cli) && existsSync(acharWhisper().modelo);

export function montarBrutoDeTeste(): string {
  const base = mkdtempSync(path.join(tmpdir(), 'bruto-'));
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(RAIZ_WORKER, 'teste', 'video-de-teste', 'gerar-fala.ps1'), '-Saida', base], { stdio: 'ignore' });
  execFileSync(acharCli('photocraft'), ['run', '--new', JSON.stringify({ width: 1080, height: 1920, background: '#4A4F57' }), '--out', path.join(base, 'quadro.png')], { stdio: 'ignore' });
  execFileSync(process.execPath, [path.join(RAIZ_WORKER, 'scripts', 'montar-bruto-de-teste.ts'), base], { stdio: 'ignore' });
  return path.join(base, 'bruto.mp4');
}

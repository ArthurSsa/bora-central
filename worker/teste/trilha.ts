// A trilha de teste: a música de demonstração do SoundCraft, que ele mesmo
// sintetiza (não é gravação de ninguém), exportada uma vez por rodada de teste.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acharCli } from '../src/config.ts';

export const temSoundCraft = existsSync(acharCli('soundcraft'));

let feita: string | null = null;
export function trilhaDeTeste(): string {
  if (feita && existsSync(feita)) return feita;
  const arq = path.join(mkdtempSync(path.join(tmpdir(), 'trilha-')), 'trilha.wav');
  execFileSync(acharCli('soundcraft'), ['run', '--demo', '--bounce', arq], { stdio: 'ignore', timeout: 120_000 });
  feita = arq;
  return arq;
}

// Instala as fontes das marcas onde o PhotoCraft procura, sem mexer nas fontes
// do sistema nem no registro do Windows:
//
//   Windows  %LOCALAPPDATA%\Microsoft\Windows\Fonts   (o PhotoCraft lê essa pasta)
//   Linux    ~/.local/share/fonts  + fc-cache
//
// Baixa de um commit fixo do google/fonts e confere o sha256 de fontes.json.
// Arquivo sem sha256 registrado é baixado, e o script imprime o sha pra ser
// gravado lá — a partir daí, um arquivo diferente é recusado.
//
//   npm run fontes
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { RAIZ_WORKER } from '../src/config.ts';

type Fonte = { familia: string; arquivo: string; url: string; licenca: string; sha256: string | null };
const { fontes } = JSON.parse(readFileSync(path.join(RAIZ_WORKER, 'fontes.json'), 'utf8')) as { fontes: Fonte[] };

const cache = path.join(RAIZ_WORKER, '.ferramentas', 'fontes');
mkdirSync(cache, { recursive: true });
const destino = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts')
  : path.join(homedir(), '.local', 'share', 'fonts');
mkdirSync(destino, { recursive: true });

let semSha = 0;
for (const f of fontes) {
  const local = path.join(cache, f.arquivo);
  if (!existsSync(local)) {
    const r = await fetch(f.url);
    if (!r.ok) throw new Error(`${f.familia}: ${r.status} em ${f.url}`);
    writeFileSync(local, Buffer.from(await r.arrayBuffer()));
    const lic = await fetch(f.licenca);
    if (lic.ok) writeFileSync(path.join(cache, `${f.familia}-OFL.txt`), Buffer.from(await lic.arrayBuffer()));
  }
  const sha = createHash('sha256').update(readFileSync(local)).digest('hex');
  if (f.sha256 && f.sha256 !== sha) throw new Error(`${f.familia}: sha256 não confere (esperado ${f.sha256}, veio ${sha})`);
  if (!f.sha256) {
    semSha++;
    console.log(`${f.familia}: sem sha256 em fontes.json — grave "${sha}"`);
  }
  copyFileSync(local, path.join(destino, f.arquivo));
  console.log(`${f.familia} → ${path.join(destino, f.arquivo)}`);
}
if (process.platform !== 'win32') execFileSync('fc-cache', ['-f', destino]);
if (semSha) process.exitCode = 2;

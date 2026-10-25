// A fábrica neste PC: liga sozinha quando a pessoa entra no Windows, volta
// sozinha se cair, roda com prioridade baixa pra não travar o computador, e
// escreve o que fez num log que não cresce sem fim.
//
//   npm run fabrica:instalar   põe o atalho na inicialização do Windows e liga
//   npm run fabrica:ligar      liga agora, escondida (sem janela)
//   npm run fabrica:estado     está ligada? desde quando? o que está fazendo?
//   npm run fabrica:desligar   termina o pedido atual e desliga
//   npm run fabrica:remover    desliga e tira o atalho da inicialização
//
// Tudo o que é da fábrica no PC fica em %LOCALAPPDATA%\BoraFabrica: o pid do
// vigia, o log, o atalho escondido e as pastas de trabalho dos pedidos.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { constants, hostname, setPriority } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { RAIZ_WORKER } from '../src/config.ts';

const CASA = path.join(process.env.LOCALAPPDATA ?? path.join(RAIZ_WORKER, '.jobs'), 'BoraFabrica');
const PID = path.join(CASA, 'vigia.pid');
const PARAR = path.join(CASA, 'parar');
const LOGS = path.join(CASA, 'logs');
const LOG = path.join(LOGS, 'fabrica.log');
const VBS = path.join(CASA, 'ligar-fabrica.vbs');
const ATALHO = path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Fábrica Bora.lnk');
const WORKER_ID = `${hostname()}-fabrica`;
const LOG_MAX = 5 * 1024 * 1024;

mkdirSync(LOGS, { recursive: true });

/** Uma linha no log, com a hora. Passou de 5 MB, gira: fabrica.log → .1 → .2 → .3, e o .3 sai. */
function registrar(texto: string) {
  try {
    if (existsSync(LOG) && statSync(LOG).size > LOG_MAX) {
      for (let i = 3; i >= 1; i--) {
        const de = i === 1 ? LOG : LOG.replace(/\.log$/, `.${i - 1}.log`);
        const para = LOG.replace(/\.log$/, `.${i}.log`);
        if (existsSync(de)) { rmSync(para, { force: true }); renameSync(de, para); }
      }
    }
    const hora = new Date().toLocaleString('pt-BR');
    appendFileSync(LOG, texto.split(/\r?\n/).filter(Boolean).map((l) => `[${hora}] ${l}`).join('\n') + '\n');
  } catch { /* log que não grava não pode derrubar a fábrica */ }
}

const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidDoVigia = (): number | null => {
  if (!existsSync(PID)) return null;
  const pid = Number(readFileSync(PID, 'utf8'));
  return pid && vivo(pid) ? pid : null;
};

// ---------- o vigia ----------

async function vigiar() {
  const outro = pidDoVigia();
  if (outro) { console.log(`a fábrica já está ligada (vigia ${outro})`); return; }
  writeFileSync(PID, String(process.pid));
  rmSync(PARAR, { force: true });
  try { setPriority(process.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sem permissão: segue normal */ }

  // Sem a chave da Anthropic e sem dizer o modo, a fábrica roda no roteiro —
  // em vez de cair na partida e ficar religando sem parar.
  const roteiro = process.env.FABRICA_AGENTE === 'roteiro' || (!process.env.FABRICA_AGENTE && !process.env.ANTHROPIC_API_KEY);
  registrar(`vigia ligado (pid ${process.pid}), fábrica ${WORKER_ID}, ${roteiro ? 'roteiro, sem o Claude' : 'com o Claude'}`);

  let worker: ChildProcess | null = null;
  let desligando = false;
  let espera = 5_000;

  const ligarWorker = () => {
    const inicio = Date.now();
    worker = spawn(process.execPath, ['src/worker.ts', ...(roteiro ? ['--roteiro'] : [])], {
      cwd: RAIZ_WORKER,
      env: { ...process.env, WORKER_ID },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    // Os apps que o worker abre herdam a prioridade baixa (o Windows passa a
    // classe "abaixo do normal" adiante): o render não disputa com quem usa o PC.
    try { setPriority(worker.pid!, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* idem */ }
    worker.stdout!.setEncoding('utf8').on('data', (d: string) => registrar(d));
    worker.stderr!.setEncoding('utf8').on('data', (d: string) => registrar(d));
    worker.on('exit', (codigo, sinal) => {
      worker = null;
      if (desligando) { registrar('fábrica desligada'); encerrar(); return; }
      // Caiu logo depois de ligar: espera mais a cada vez (até 1 min), pra
      // não virar um laço de religar. Ficou de pé um tempo: volta rápido.
      espera = Date.now() - inicio < 60_000 ? Math.min(espera * 2, 60_000) : 5_000;
      registrar(`a fábrica parou (${sinal ?? codigo}); religo em ${espera / 1000} s`);
      setTimeout(() => { if (!desligando) ligarWorker(); }, espera);
    });
  };

  const encerrar = () => {
    rmSync(PID, { force: true });
    process.exit(0);
  };

  // "Desligar" chega como um arquivo: no Windows não há sinal de terminar
  // que dê tempo de o pedido atual acabar.
  setInterval(() => {
    if (desligando || !existsSync(PARAR)) return;
    desligando = true;
    rmSync(PARAR, { force: true });
    registrar('pedido de desligar: termino o pedido atual e desligo');
    if (!worker) { encerrar(); return; }
    worker.send({ parar: true });
    // Um pedido longo pode levar minutos; mais que 15, desliga assim mesmo —
    // o que ficou pela metade volta pra fila quando a fábrica ligar de novo.
    setTimeout(() => { worker?.kill(); }, 15 * 60_000).unref();
  }, 2_000);

  ligarWorker();
}

// ---------- os comandos ----------

/** Liga escondida: pelo atalho escondido, como o Windows faz ao entrar. */
function ligarEscondida() {
  escreverVbs();
  if (pidDoVigia()) { console.log('a fábrica já está ligada.'); return; }
  spawn('wscript.exe', [VBS], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log('ligando a fábrica (sem janela). Veja com: npm run fabrica:estado');
}

/** O "atalho escondido": abre o vigia sem janela de terminal. */
function escreverVbs() {
  const aspas = (s: string) => s.replace(/"/g, '""');
  writeFileSync(VBS, [
    "' Liga a fábrica da Bora sem abrir janela. Gerado por worker/scripts/fabrica.ts.",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${aspas(RAIZ_WORKER)}"`,
    `sh.Run """${aspas(process.execPath)}"" --env-file-if-exists=.env scripts/fabrica.ts vigiar", 0, False`,
    '',
  ].join('\r\n'), 'utf8');
}

function instalar() {
  escreverVbs();
  const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${ATALHO.replace(/'/g, "''")}');`
    + `$s.TargetPath = 'wscript.exe'; $s.Arguments = '"${VBS.replace(/'/g, "''")}"';`
    + `$s.WorkingDirectory = '${RAIZ_WORKER.replace(/'/g, "''")}'; $s.Description = 'Liga a fábrica da Bora ao entrar no Windows'; $s.Save()`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  console.log(`atalho criado: ${ATALHO}`);
  console.log('a partir de agora a fábrica liga sozinha quando você entra no Windows.');
  ligarEscondida();
}

async function desligar(esperarMs = 15 * 60_000) {
  const pid = pidDoVigia();
  if (!pid) { console.log('a fábrica já está desligada.'); return; }
  writeFileSync(PARAR, '');
  console.log('pedi pra desligar: ela termina o pedido atual e desliga…');
  const ate = Date.now() + esperarMs;
  while (vivo(pid) && Date.now() < ate) await new Promise((r) => setTimeout(r, 1000));
  console.log(vivo(pid) ? 'ainda terminando um pedido; ela desliga sozinha quando acabar.' : 'desligada.');
}

async function remover() {
  await desligar();
  if (existsSync(ATALHO)) unlinkSync(ATALHO);
  console.log('atalho removido: a fábrica não liga mais sozinha.');
}

async function estado() {
  const pid = pidDoVigia();
  console.log(pid ? `vigia ligado (pid ${pid})` : 'vigia desligado');
  console.log(existsSync(ATALHO) ? 'liga sozinha ao entrar no Windows: sim' : 'liga sozinha ao entrar no Windows: não');
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (chave) {
    const sb = createClient(process.env.SUPABASE_URL ?? 'https://yxewmauwnxnrrhevlbtc.supabase.co', chave, { auth: { persistSession: false } });
    const { data } = await sb.from('fabrica_sinais').select('visto_em, ligado_em, agente, ocupado_com').eq('worker_id', WORKER_ID).maybeSingle();
    if (data) {
      const ha = Math.round((Date.now() - Date.parse(data.visto_em)) / 1000);
      console.log(`último sinal: há ${ha} s · ligada desde ${new Date(data.ligado_em).toLocaleString('pt-BR')} · ${data.agente}`
        + (data.ocupado_com ? ` · fazendo o job ${data.ocupado_com}` : ' · esperando pedido'));
    }
  }
  console.log(`log: ${LOG}`);
}

const comando = process.argv[2];
const comandos: Record<string, () => unknown> = {
  vigiar, ligar: ligarEscondida, instalar, desligar: () => desligar(), remover, estado,
};
if (!comandos[comando]) {
  console.log('uso: node scripts/fabrica.ts <instalar|ligar|estado|desligar|remover>');
  process.exit(1);
}
await comandos[comando]();

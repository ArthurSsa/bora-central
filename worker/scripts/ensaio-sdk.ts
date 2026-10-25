// Ensaio sem custo: sobe o agente com as MESMAS opções do worker e uma chave
// inválida, só pra ver o SDK montar a sessão — servidores MCP conectados e a
// lista de ferramentas que o modelo receberia. A primeira chamada à API falha
// (401) e o ensaio termina. Rode depois de instalar ou atualizar os apps.
//
//   npm run ensaio
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { servidorMcp, ferramentasBloqueadas, APPS, type App } from '../src/apps.ts';

const apps = (process.argv[2]?.split(',') ?? ['photocraft']) as App[];
for (const a of apps) if (!APPS.includes(a)) throw new Error(`app desconhecido: ${a}`);
const pasta = mkdtempSync(path.join(tmpdir(), 'ensaio-'));
const servidores = Object.fromEntries(apps.map((a) => [a, servidorMcp(a, pasta)]));

const q = query({
  prompt: 'oi',
  options: {
    model: 'claude-opus-5-5',
    tools: [],
    mcpServers: { ...servidores, fabrica: createSdkMcpServer({ name: 'fabrica', tools: [] }) },
    allowedTools: [...apps, 'fabrica'].map((s) => `mcp__${s}`),
    disallowedTools: ferramentasBloqueadas(apps),
    permissionMode: 'dontAsk',
    permissionPrompts: 'none',
    strictMcpConfig: true,
    settingSources: [],
    persistSession: false,
    cwd: pasta,
    maxTurns: 1,
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-ensaio-invalida' },
  },
});

let ok = false;
try {
  for await (const m of q) {
    if (m.type !== 'system' || m.subtype !== 'init') continue;
    const fora = m.mcp_servers.filter((s) => s.status !== 'connected');
    const embutidas = m.tools.filter((t) => !t.startsWith('mcp__'));
    const bloqueadas = m.tools.filter((t) => ferramentasBloqueadas(apps).includes(t));
    console.log(`servidores: ${m.mcp_servers.map((s) => `${s.name}=${s.status}`).join(' ')}`);
    console.log(`ferramentas: ${m.tools.length}`);
    if (fora.length) console.log(`NÃO CONECTOU: ${fora.map((s) => s.name).join(', ')}`);
    if (embutidas.length) console.log(`FERRAMENTA EMBUTIDA VAZOU: ${embutidas.join(', ')}`);
    if (bloqueadas.length) console.log(`BLOQUEADA APARECEU: ${bloqueadas.join(', ')}`);
    ok = !fora.length && !embutidas.length && !bloqueadas.length;
  }
} catch {
  // 401 da chave de ensaio: esperado.
}
console.log(ok ? 'ensaio ok' : 'ensaio FALHOU');
process.exit(ok ? 0 : 1);

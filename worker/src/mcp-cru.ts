// Cliente MCP mínimo por stdio: fala JSON-RPC linha a linha com o servidor do
// app, sem o agente no meio. Usado pelos testes e pelo roteiro (o modo sem
// Claude) — os dois falam com o PhotoCraft de verdade sem gastar token.
import { spawn } from 'node:child_process';
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk';

export type Resposta = { result?: { content?: Array<{ type: string; text?: string }>; isError?: boolean }; error?: { message: string } };

export async function abrirMcp(cfg: McpStdioServerConfig) {
  const p = spawn(cfg.command, cfg.args ?? [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let id = 0;
  const pendentes = new Map<number, (r: Resposta) => void>();
  p.stdout.setEncoding('utf8').on('data', (d: string) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const linha = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!linha) continue;
      const m = JSON.parse(linha);
      pendentes.get(m.id)?.(m);
      pendentes.delete(m.id);
    }
  });
  const rpc = (method: string, params: unknown) =>
    new Promise<Resposta>((ok) => {
      const n = ++id;
      pendentes.set(n, ok);
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '0' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  return {
    async chamar(nome: string, args: Record<string, unknown> = {}) {
      const r = await rpc('tools/call', { name: nome, arguments: args });
      const texto = r.result?.content?.map((c) => c.text ?? '').join('') ?? r.error?.message ?? '';
      return { erro: Boolean(r.error || r.result?.isError), texto };
    },
    fechar: () => p.kill(),
  };
}

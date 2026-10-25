// O roteiro: a fábrica sem o Claude. Segue a skill de teste passo a passo, com
// os mesmos comandos que ela manda o agente usar, falando com o PhotoCraft
// pelo mesmo servidor MCP preso à pasta do job.
//
// Serve pra provar o caminho inteiro — fila, app, conferência, Storage,
// Realtime — antes de existir uma chave da Anthropic, e depois pra separar
// "a máquina quebrou" de "o agente errou" quando algo der errado. Não escolhe
// nada: o título é o começo do texto do cliente, cortado em oito palavras.
//
//   FABRICA_AGENTE=roteiro npm start
import { servidorMcp } from './apps.ts';
import { abrirMcp } from './mcp-cru.ts';
import { CUSTO_ZERO, FalhaDoAgente, type Agente } from './agente.ts';
import type { Ajuste } from './fila.ts';

/** O título que o roteiro consegue tirar sem interpretar: as primeiras oito palavras, sem o que vem depois de ":". */
export function tituloDoTexto(texto: string, maxPalavras = 8): string {
  const antes = texto.split(':')[0].trim() || texto.trim();
  const palavras = antes.split(/\s+/).filter(Boolean);
  const curto = palavras.slice(0, maxPalavras).join(' ');
  return curto.replace(/[.,;!?]+$/, '') || 'Teste da fábrica';
}

/**
 * O que o roteiro sabe fazer dos atalhos de ajuste, somando todos os pedidos
 * até aqui (ele refaz do zero, então precisa da história inteira):
 * "outra cor da marca" anda um conjunto por vez; "mais curto" corta o título
 * pra quatro palavras. O resto — texto livre, "mais sério", "troca a foto" —
 * pede interpretação, e isso é do Claude.
 */
export function aplicarAtalhos(ajustes: Ajuste[], totalConjuntos: number) {
  const todos = ajustes.flatMap((a) => a.atalhos);
  const ignorados = [
    ...todos.filter((t) => t !== 'mais curto' && t !== 'outra cor da marca'),
    ...ajustes.filter((a) => a.texto).map((a) => `"${a.texto}"`),
  ];
  return {
    conjunto: todos.filter((t) => t === 'outra cor da marca').length % Math.max(totalConjuntos, 1),
    maxPalavras: todos.includes('mais curto') ? 4 : 8,
    ignorados,
  };
}

export const rodarRoteiro: Agente = async (p) => {
  if (p.skill.nome !== 'post-feed-teste') {
    throw new FalhaDoAgente(`o roteiro só sabe fazer a skill post-feed-teste, não ${p.skill.nome}`, CUSTO_ZERO);
  }
  const { fonte, margem: m, alinhamento } = p.dados;
  const atalhos = aplicarAtalhos(p.dados.ajustes, p.dados.conjuntos.length);
  const c = p.dados.conjuntos[atalhos.conjunto] ?? p.dados.conjunto;
  const titulo = tituloDoTexto(p.dados.textoDoCliente, atalhos.maxPalavras);
  let renderMs = 0;
  const mcp = await abrirMcp(servidorMcp('photocraft', p.pastaJob));

  const passo = async (ferramenta: string, args: Record<string, unknown>) => {
    if (p.abortar.signal.aborted) throw new FalhaDoAgente('job cancelado', { ...CUSTO_ZERO, render_segundos: renderMs / 1000 });
    const t = performance.now();
    const r = await mcp.chamar(ferramenta, args);
    const ms = Math.round(performance.now() - t);
    renderMs += ms;
    p.aoUsarFerramenta(`roteiro:${ferramenta}${args.id ? `:${args.id}` : ''}`, ms, r.erro);
    if (r.erro) throw new FalhaDoAgente(`${ferramenta} falhou: ${r.texto}`, { ...CUSTO_ZERO, render_segundos: renderMs / 1000 });
    return r.texto;
  };

  try {
    await p.aoMudarEtapa({ etapa: 'desenhando o post', progresso: 20 });
    await passo('doc_new', { width: 1080, height: 1350, background: c.fundo, name: 'post' });
    await passo('command_run', { id: 'select.rect', params: { x: m, y: 1180, width: 180, height: 16 } });
    await passo('command_run', { id: 'layer.newFillLayer.solidColor', params: { color: c.faixa } });
    await passo('command_run', { id: 'select.deselect', params: {} });

    await p.aoMudarEtapa({ etapa: 'escrevendo o título', progresso: 45 });
    const caixa = [m, 420, 1080 - 2 * m, 600];
    await passo('command_run', {
      id: 'type.create',
      params: { text: titulo, box: caixa, font: fonte, size: 88, weight: 700, color: c.tinta, align: alinhamento },
    });

    // O mesmo ajuste que a skill pede: título grande demais desce de tamanho.
    await p.aoMudarEtapa({ etapa: 'conferindo o post', progresso: 70 });
    for (const tamanho of [72, 60]) {
      const doc = JSON.parse(await passo('doc_inspect', {}));
      const texto = doc.layers.find((l: { kind: string }) => l.kind === 'Type');
      const [, y, , h] = texto.bounds as number[];
      if (y + h <= 1180 - 24) break;
      await passo('command_run', { id: 'type.setStyle', params: { layer: texto.id, size: tamanho } });
    }

    await passo('doc_save', { path: 'editavel/post.psd' });
    await passo('doc_save', { path: 'saida/post.png' });
  } finally {
    mcp.fechar();
  }

  return {
    custos: { ...CUSTO_ZERO, render_segundos: Math.round(renderMs / 10) / 100 },
    resumo:
      `Roteiro (sem Claude): conjunto "${c.nome}", fonte ${fonte}, título "${titulo}".` +
      (atalhos.ignorados.length ? ` Não sabe aplicar sem o Claude: ${atalhos.ignorados.join(', ')}.` : ''),
    turnos: 0,
  };
};

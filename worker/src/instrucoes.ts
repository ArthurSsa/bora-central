// O que o agente lê. Duas partes, separadas de propósito:
//
// - o SISTEMA é fixo por skill (papel + regras + o SKILL.md). Igual entre
//   clientes, então o cache de prompt reaproveita de um job pro outro;
// - o PEDIDO muda a cada job (marca do cliente, o que ele pediu, o que entregar).
import type { Skill } from './skills.ts';
import type { Ajuste, Pedido } from './fila.ts';

export function montarSistema(skill: Skill): string {
  return `Você é o designer da Bora Postar trabalhando dentro da fábrica: um servidor sem tela e sem ninguém do outro lado. Ninguém vai responder pergunta — decida com o que está aqui. Quem recebe a peça é o dono do negócio, que não sabe nem precisa saber o que é camada, PSD ou fonte.

Regras que não mudam:
1. Use só a identidade do cliente que vem no pedido: as cores da paleta, a fonte indicada, os obrigatórios, o que nunca fazer. Nenhuma cor ou fonte fora disso.
2. Nada de imagem gerada por IA.
3. Os arquivos ficam na pasta do job. Use caminhos relativos com barra normal, como saida/post.png.
4. Antes de salvar a versão final, olhe a peça com render_preview e corrija o que estiver fora do quadro, cortado, encostado na borda ou difícil de ler.
5. Ao começar cada parte do trabalho, chame avisar_etapa com uma frase curta em português que o cliente entenda ("desenhando o post", não "criando camada de texto").
6. Salve exatamente os arquivos pedidos em "Entregue", com esses nomes e tamanhos. Termine com um resumo de duas linhas do que você fez, para a equipe da Bora.

# Como fazer esta peça

${skill.corpo}
`;
}

const ROTULOS: Record<string, string> = {
  texto: 'O que o cliente escreveu',
  objetivo: 'Objetivo',
  rede: 'Rede',
  tom: 'Tom pedido para esta peça',
  titulo: 'Título',
  chamada: 'Chamada',
};

export function montarPedido(skill: Skill, pedido: Pedido, marca: string, ajustes: Ajuste[] = [], temAnterior = false): string {
  const linhas = ['# Cliente e marca', '', marca, '', '# O pedido', '', `Tipo: ${pedido.tipo}`];
  if (pedido.titulo) linhas.push(`Título do pedido: ${pedido.titulo}`);
  for (const [chave, valor] of Object.entries(pedido.briefing ?? {})) {
    if (valor === null || valor === '' || typeof valor === 'object') continue;
    linhas.push(`${ROTULOS[chave] ?? chave}: ${String(valor)}`);
  }
  if (ajustes.length) {
    const atual = ajustes[ajustes.length - 1];
    const descrever = (a: Ajuste) => [...a.atalhos.map((t) => `"${t}"`), a.texto ? `"${a.texto}"` : null].filter(Boolean).join(' e ');
    linhas.push('', '# Ajuste pedido', '');
    linhas.push(`O cliente viu a versão anterior e pediu: ${descrever(atual)}.`);
    if (ajustes.length > 1) {
      linhas.push('', 'Ajustes anteriores, que a versão anterior já tem e não podem ser desfeitos:');
      for (const a of ajustes.slice(0, -1)) linhas.push(`- ${descrever(a)}`);
    }
    if (temAnterior) {
      linhas.push('', 'A versão anterior está em entrada/anterior.psd. Abra com doc_open, mude SÓ o que foi pedido e salve as mesmas saídas. Não refaça a peça do zero.');
    }
  }
  linhas.push('', '# Entregue', '');
  for (const s of skill.saidas) {
    linhas.push(`- ${s.caminho}${s.largura ? ` (${s.largura}×${s.altura} px)` : ''}`);
  }
  return linhas.join('\n');
}

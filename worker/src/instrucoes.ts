// O que o agente lê. Duas partes, separadas de propósito:
//
// - o SISTEMA é fixo por skill (papel + regras + o SKILL.md e as skills que ela
//   usa). Igual entre clientes, então o cache de prompt reaproveita de um job
//   pro outro;
// - o PEDIDO muda a cada job (marca do cliente, o que ele pediu, o que entregar).
import type { Skill, SaidaEsperada } from './skills.ts';
import type { Ajuste, Elemento, Pedido } from './fila.ts';

export function montarSistema(skill: Skill, todas: Map<string, Skill> = new Map()): string {
  const partes = skill.usa.map((u) => todas.get(u)).filter((s): s is Skill => Boolean(s));
  return `Você é o designer da Bora Postar trabalhando dentro da fábrica: um servidor sem tela e sem ninguém do outro lado. Ninguém vai responder pergunta — decida com o que está aqui. Quem recebe a peça é o dono do negócio, que não sabe nem precisa saber o que é camada, PSD ou fonte.

Regras que não mudam:
1. Use só a identidade do cliente que vem no pedido: as cores da paleta, a fonte e os pesos indicados, os obrigatórios, o que nunca fazer. Nenhuma cor ou fonte fora disso.
2. Nada de imagem gerada por IA. Foto e logo, só os da lista de elementos.
3. Não invente fato sobre o cliente: número, prêmio, preço, data ou promessa que não estão no pedido não entram na peça nem na legenda.
4. Os arquivos ficam na pasta do job. Use caminhos relativos com barra normal, como saida/post.png.
5. Antes de salvar a versão final, olhe a peça com render_preview e corrija o que estiver fora do quadro, cortado, encostado na borda ou difícil de ler.
6. Ao começar cada parte do trabalho, chame avisar_etapa com uma frase curta em português que o cliente entenda ("desenhando o post", não "criando camada de texto").
7. Salve exatamente os arquivos pedidos em "Entregue", com esses nomes e tamanhos. Texto (legenda, títulos) se salva com salvar_texto.
8. Depois de você, uma conferência automática mede cor, fonte, peso, margem e contraste em cada imagem. Se ela reprovar, o pedido volta pra você com o motivo.
9. Termine com um resumo de duas linhas do que você fez, para a equipe da Bora.

# Como fazer esta peça

${skill.corpo}
${partes.map((p) => `\n# Parte "${p.nome}"\n\n${p.corpo}\n`).join('')}`;
}

const ROTULOS: Record<string, string> = {
  texto: 'O que o cliente escreveu',
  objetivo: 'Objetivo',
  rede: 'Rede',
  tom: 'Tom pedido para esta peça',
  titulo: 'Título',
  chamada: 'Chamada',
  slides: 'Quantidade de slides',
};

export type OpcoesDoPedido = {
  saidas: SaidaEsperada[];
  ajustes?: Ajuste[];
  temAnterior?: boolean;
  elementos?: Elemento[];
  /** Por que a tentativa anterior foi reprovada — a próxima precisa saber. */
  erroAnterior?: string | null;
  /** O pedido traz foto da pessoa: o post sai pela ferramenta post_com_pessoa. */
  pessoa?: { recorteOk: boolean; motivo: string | null } | null;
};

export function montarPedido(skill: Skill, pedido: Pedido, marca: string, o: OpcoesDoPedido): string {
  const linhas = ['# Cliente e marca', '', marca];
  if (o.elementos?.length) {
    linhas.push('', 'Elementos da marca nesta pasta (use só estes):');
    for (const e of o.elementos) {
      linhas.push(`- ${e.arquivo} — ${e.tipo}${e.nome ? ` "${e.nome}"` : ''}${e.largura ? `, ${e.largura}×${e.altura} px` : ''}`);
      // O logo vetorial vem com versões de uma cor: são as que leem quando uma cor dele é a do fundo.
      for (const [tinta, arq] of Object.entries(e.mono ?? {})) linhas.push(`  - ${arq} — o mesmo, todo em ${tinta}; use sobre fundo onde ${(e.cores ?? []).join(', ')} somem`);
    }
  } else {
    linhas.push('', 'Elementos da marca: nenhum cadastrado. Não ponha logo nem foto.');
  }
  linhas.push('', '# O pedido', '', `Tipo: ${pedido.tipo}`);
  if (pedido.titulo) linhas.push(`Título do pedido: ${pedido.titulo}`);
  for (const [chave, valor] of Object.entries(pedido.briefing ?? {})) {
    if (valor === null || valor === '' || typeof valor === 'object') continue;
    linhas.push(`${ROTULOS[chave] ?? chave}: ${String(valor)}`);
  }
  if (o.pessoa) {
    linhas.push('', '# A pessoa no post', '',
      'O pedido traz uma foto da pessoa, já tratada e recortada. Monte o post com a ferramenta post_com_pessoa (não monte à mão no PhotoCraft): ela encaixa o rosto e nunca deixa o texto por cima dele. Você decide o título, o apoio e, se tiver motivo, o jeito.',
      o.pessoa.recorteOk ? 'O recorte ficou bom: "auto" vai usar o recorte.' : `O recorte não ficou bom (${o.pessoa.motivo}): "auto" vai usar a foto inteira, e é o que deve ser usado.`);
  }
  const ajustes = o.ajustes ?? [];
  if (ajustes.length) {
    const atual = ajustes[ajustes.length - 1];
    const descrever = (a: Ajuste) => [...a.atalhos.map((t) => `"${t}"`), a.texto ? `"${a.texto}"` : null].filter(Boolean).join(' e ');
    linhas.push('', '# Ajuste pedido', '');
    linhas.push(`O cliente viu a versão anterior e pediu: ${descrever(atual)}.`);
    if (ajustes.length > 1) {
      linhas.push('', 'Ajustes anteriores, que a versão anterior já tem e não podem ser desfeitos:');
      for (const a of ajustes.slice(0, -1)) linhas.push(`- ${descrever(a)}`);
    }
    if (o.temAnterior) {
      linhas.push('', 'A versão anterior está em entrada/anterior/ (os mesmos nomes de arquivo). Abra com doc_open, mude SÓ o que foi pedido e salve as mesmas saídas. Não refaça a peça do zero.');
    }
  }
  if (o.erroAnterior) {
    linhas.push('', '# A tentativa anterior foi reprovada', '', o.erroAnterior, '', 'Corrija isso nesta tentativa.');
  }
  linhas.push('', '# Entregue', '');
  for (const s of o.saidas) {
    linhas.push(`- ${s.caminho}${s.largura ? ` (${s.largura}×${s.altura} px)` : ''}`);
  }
  return linhas.join('\n');
}

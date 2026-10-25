// A identidade do cliente, do jeito que o agente precisa ler.
//
// O que pode ser decidido sem gosto é decidido aqui, em código, e chega pronto:
// qual conjunto de cor usar, que cor de texto passa no contraste, que fonte
// existe de verdade nesta máquina. Deixar isso pro agente seria pedir que ele
// adivinhe o que dá pra calcular — e errar fonte é o que mais rápido faz uma
// peça parecer de outra marca.

/** As cinco fontes do Estúdio, com a mesma cadeia de substitutas do CSS dele. */
export const FONTES: Record<string, string[]> = {
  display: ['Space Grotesk', 'Segoe UI', 'DejaVu Sans', 'Arial'],
  corpo: ['Archivo', 'Helvetica Neue', 'Arial', 'DejaVu Sans'],
  impacto: ['Anton', 'Arial Narrow', 'Impact', 'DejaVu Sans Condensed', 'Arial'],
  serif: ['Playfair Display', 'Georgia', 'DejaVu Serif', 'Times New Roman'],
  mono: ['Space Mono', 'SFMono-Regular', 'Consolas', 'DejaVu Sans Mono'],
};

export type FonteResolvida = { pedida: string; usada: string; substituida: boolean };

export function resolverFonte(fonteMarca: string | undefined, falback: string | undefined, instaladas: string[]): FonteResolvida {
  const tem = new Map(instaladas.map((f) => [f.toLowerCase(), f]));
  const cadeia = [fonteMarca, ...(FONTES[falback || 'display'] ?? FONTES.display)].filter(Boolean) as string[];
  const pedida = cadeia[0];
  for (const f of cadeia) {
    const achou = tem.get(f.toLowerCase());
    if (achou) return { pedida, usada: achou, substituida: f !== pedida };
  }
  // Nenhuma da cadeia: a primeira instalada, e o aviso no log diz isso.
  return { pedida, usada: instaladas[0] ?? 'Arial', substituida: true };
}

// Contraste WCAG, igual ao que o Estúdio mostra no cartão de cada conjunto.
function luminancia(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export type Conjunto = { nome: string; fundo: string; tinta: string; destaque: string; faixa: string; quando?: string };

type MarcaBruta = {
  conjuntos?: Array<Partial<Conjunto> & { k?: string }>;
  conjuntoPadrao?: string;
  paleta?: Array<{ cor: string; nome?: string; uso?: string }>;
  fonteMarca?: string;
  fonteFalback?: string;
  cor2?: string;
  tom?: string;
  publico?: string;
  evitar?: string;
  obrigatorios?: string;
  chamada?: string;
  alinha?: string;
  margem?: string;
};

/** Texto escuro ou branco, o que ler melhor — é o que o Estúdio faz com tinta vazia. */
export function tintaPara(fundo: string): string {
  return contraste(fundo, '#FFFFFF') >= contraste(fundo, '#0A0A0A') ? '#FFFFFF' : '#0A0A0A';
}

/** Todos os conjuntos da marca, completos e com o padrão primeiro. */
export function todosOsConjuntos(marca: MarcaBruta, corCliente: string | null): Conjunto[] {
  const lista = (marca.conjuntos ?? []).filter((c) => c?.fundo);
  const padrao = lista.findIndex((x) => x.k === marca.conjuntoPadrao);
  if (padrao > 0) lista.unshift(...lista.splice(padrao, 1));
  const completos = lista.map((c) => ({
    nome: c.nome ?? 'padrão',
    fundo: c.fundo!,
    tinta: c.tinta || tintaPara(c.fundo!),
    destaque: c.destaque || marca.cor2 || c.fundo!,
    faixa: c.faixa || marca.cor2 || c.fundo!,
    quando: c.quando,
  }));
  if (completos.length) return completos;
  // Cliente sem conjuntos: deriva da cor, como o Estúdio já fazia antes deles.
  const fundo = corCliente || '#0A0A0A';
  return [{ nome: 'derivado da cor do cliente', fundo, tinta: tintaPara(fundo), destaque: marca.cor2 || fundo, faixa: marca.cor2 || fundo }];
}

export function conjuntoPadrao(marca: MarcaBruta, corCliente: string | null): Conjunto {
  return todosOsConjuntos(marca, corCliente)[0];
}

export type ClienteParaMarca = { nome: string; nome_preferido: string | null; cor: string | null; marca: MarcaBruta | null; registro_profissional: string | null };

export function marcaParaAgente(cliente: ClienteParaMarca, fonte: FonteResolvida): { texto: string; conjunto: Conjunto; conjuntos: Conjunto[] } {
  const m = cliente.marca ?? {};
  const conjuntos = todosOsConjuntos(m, cliente.cor);
  const conj = conjuntos[0];
  const ratio = contraste(conj.fundo, conj.tinta).toFixed(1);
  const linhas = [
    `Cliente: ${cliente.nome_preferido || cliente.nome}`,
    '',
    `Conjunto de cor a usar: "${conj.nome}"${conj.quando ? ` — ${conj.quando}` : ''}`,
    `- fundo ${conj.fundo}`,
    `- texto ${conj.tinta} (contraste ${ratio}:1 sobre o fundo, já conferido)`,
    `- destaque ${conj.destaque}`,
    `- faixa ${conj.faixa}`,
    '',
    `Fonte: use exatamente a família "${fonte.usada}".` +
      (fonte.substituida ? ` (A da marca é "${fonte.pedida}", que não está instalada nesta máquina; "${fonte.usada}" é a substituta definida.)` : ''),
  ];
  if (conjuntos.length > 1) {
    linhas.push('', 'Outros conjuntos da marca (para quando o pedido pedir outra cor):');
    for (const o of conjuntos.slice(1)) {
      linhas.push(`- "${o.nome}": fundo ${o.fundo}, texto ${o.tinta}, destaque ${o.destaque}, faixa ${o.faixa}${o.quando ? ` — ${o.quando}` : ''}`);
    }
  }
  if (m.paleta?.length) {
    linhas.push('', 'Paleta completa (só estas cores existem pra esta marca):');
    for (const p of m.paleta) linhas.push(`- ${p.cor}${p.nome ? ` ${p.nome}` : ''}${p.uso ? ` — ${p.uso}` : ''}`);
  }
  if (m.alinha) linhas.push('', `Alinhamento do texto: ${m.alinha === 'esq' ? 'à esquerda' : m.alinha === 'centro' ? 'centralizado' : m.alinha}`);
  if (m.margem) linhas.push(`Margem: ${m.margem}`);
  if (m.tom) linhas.push('', `Tom: ${m.tom}`);
  if (m.publico) linhas.push(`Público: ${m.publico}`);
  if (m.evitar) linhas.push('', `NUNCA: ${m.evitar}`);
  if (m.obrigatorios) linhas.push('', `Obrigatórios da marca (leitura do manual): ${m.obrigatorios}`);
  if (cliente.registro_profissional) linhas.push('', `Registro profissional que precisa aparecer: ${cliente.registro_profissional}`);
  return { texto: linhas.join('\n'), conjunto: conj, conjuntos };
}

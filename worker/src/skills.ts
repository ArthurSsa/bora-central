// Skills: uma pasta skills/<nome>/SKILL.md por tipo de pedido.
//
// O cabeçalho diz ao WORKER o que preparar (que apps subir, que arquivos cobrar
// no fim); o corpo diz ao AGENTE como fazer. O cliente não vê nenhum dos dois.
//
//   ---
//   name: post-feed
//   description: Post único para o feed.
//   tipos: [post-feed]
//   apps: [photocraft]
//   saidas:
//     - saida/post.png 1080x1350
//     - editavel/post.psd 1080x1350
//   ---
//
// O leitor de cabeçalho é de propósito pequeno: chave: valor, lista entre
// colchetes e lista com hífen. Uma dependência de YAML inteira pra isso seria
// mais coisa pra quebrar do que as seis linhas que ela leria.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { APPS, type App } from './apps.ts';

export type SaidaEsperada = { caminho: string; largura?: number; altura?: number };

/** "quantidade: slides de 3 a 10, padrão 5" — quantas vezes as saídas com {n} se repetem. */
export type Quantidade = { campo: string; min: number; max: number; padrao: number };

export type Skill = {
  nome: string;
  descricao: string;
  tipos: string[];
  apps: App[];
  saidas: SaidaEsperada[];
  quantidade: Quantidade | null;
  /** Outras skills cujo corpo entra junto (ex.: copy-e-hashtags). */
  usa: string[];
  /** "video": o pedido traz um vídeo do cliente, que o worker baixa e transcreve antes do agente. */
  entrada: 'video' | null;
  corpo: string;
};

export function lerCabecalho(texto: string): { campos: Record<string, string | string[]>; corpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(texto);
  if (!m) throw new Error('SKILL.md sem cabeçalho entre ---');
  const campos: Record<string, string | string[]> = {};
  let lista: string[] | null = null;
  for (const linha of m[1].split(/\r?\n/)) {
    if (!linha.trim() || linha.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(linha);
    if (item) {
      if (!lista) throw new Error(`item de lista fora de uma chave: "${linha}"`);
      lista.push(item[1].trim());
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(linha);
    if (!kv) throw new Error(`linha que não entendi no cabeçalho: "${linha}"`);
    const [, chave, valor] = kv;
    if (valor === '') {
      lista = campos[chave] = [];
    } else if (valor.startsWith('[') && valor.endsWith(']')) {
      campos[chave] = valor.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      lista = null;
    } else {
      campos[chave] = valor.replace(/^["']|["']$/g, '');
      lista = null;
    }
  }
  return { campos, corpo: m[2].trim() };
}

export function lerQuantidade(texto: string): Quantidade {
  const m = /^(\w+) de (\d+) a (\d+), padrão (\d+)$/.exec(texto.trim());
  if (!m) throw new Error(`quantidade "${texto}" não está no formato "slides de 3 a 10, padrão 5"`);
  const [min, max, padrao] = [m[2], m[3], m[4]].map(Number);
  if (!(min <= padrao && padrao <= max)) throw new Error(`quantidade "${texto}": o padrão precisa estar entre o mínimo e o máximo`);
  return { campo: m[1], min, max, padrao };
}

/**
 * As saídas deste pedido: as fixas como estão, e as com {n} repetidas pela
 * quantidade que o cliente escolheu (dentro do que a skill aceita).
 * slide-{n} vira slide-01, slide-02… — dois dígitos, pra ordenar certo.
 */
export function expandirSaidas(skill: Skill, briefing: Record<string, unknown> = {}): SaidaEsperada[] {
  const q = skill.quantidade;
  const pedido = q ? Number(briefing[q.campo]) : NaN;
  const n = q ? (Number.isInteger(pedido) ? Math.min(q.max, Math.max(q.min, pedido)) : q.padrao) : 1;
  return skill.saidas.flatMap((s) => s.caminho.includes('{n}')
    ? Array.from({ length: n }, (_, i) => ({ ...s, caminho: s.caminho.replace('{n}', String(i + 1).padStart(2, '0')) }))
    : [s]);
}

export function lerSaida(linha: string): SaidaEsperada {
  const [caminho, dim] = linha.split(/\s+/);
  if (!/^(saida|editavel)\/[\w.{}-]+$/.test(caminho) || /\{(?!n\})/.test(caminho)) {
    throw new Error(`saída "${caminho}" precisa estar em saida/ ou editavel/, sem subpasta`);
  }
  if (!dim) return { caminho };
  const d = /^(\d+)x(\d+)$/.exec(dim);
  if (!d) throw new Error(`dimensão "${dim}" não está no formato LARGURAxALTURA`);
  return { caminho, largura: Number(d[1]), altura: Number(d[2]) };
}

export function interpretarSkill(nomePasta: string, texto: string): Skill {
  const { campos, corpo } = lerCabecalho(texto);
  const lista = (k: string) => {
    const v = campos[k] ?? [];
    return Array.isArray(v) ? v : [v];
  };
  const nome = String(campos.name ?? '');
  if (nome !== nomePasta) throw new Error(`skill na pasta "${nomePasta}" se chama "${nome}"`);
  const apps = lista('apps');
  for (const a of apps) if (!APPS.includes(a as App)) throw new Error(`app desconhecido na skill ${nome}: ${a}`);
  const saidas = lista('saidas').map(lerSaida);
  if (!saidas.length) throw new Error(`skill ${nome} não declara nenhuma saída`);
  const quantidade = campos.quantidade ? lerQuantidade(String(campos.quantidade)) : null;
  if (saidas.some((s) => s.caminho.includes('{n}')) !== Boolean(quantidade)) {
    throw new Error(`skill ${nome}: saída com {n} e "quantidade" vêm juntas`);
  }
  return {
    nome,
    descricao: String(campos.description ?? ''),
    tipos: lista('tipos'),
    apps: apps as App[],
    saidas,
    quantidade,
    usa: lista('usa'),
    entrada: campos.entrada === 'video' ? 'video' : null,
    corpo,
  };
}

export function carregarSkills(pasta: string): Map<string, Skill> {
  const skills = new Map<string, Skill>();
  for (const nome of readdirSync(pasta)) {
    const arq = path.join(pasta, nome, 'SKILL.md');
    if (!existsSync(arq)) continue;
    skills.set(nome, interpretarSkill(nome, readFileSync(arq, 'utf8')));
  }
  // Skill que usa outra que não existe quebra na partida, não no primeiro pedido.
  for (const s of skills.values()) for (const u of s.usa) {
    if (!skills.has(u)) throw new Error(`skill ${s.nome} usa "${u}", que não existe em skills/`);
  }
  return skills;
}

/**
 * A skill forçada no job (só a Bora força) vence; senão, a primeira que atende
 * o tipo do pedido. Skill de teste tem `tipos: []` e só roda forçada.
 */
export function escolherSkill(skills: Map<string, Skill>, tipoPedido: string, forcada?: string | null): Skill {
  if (forcada) {
    const s = skills.get(forcada);
    if (!s) throw new Error(`skill "${forcada}" não existe em skills/`);
    return s;
  }
  for (const s of skills.values()) if (s.tipos.includes(tipoPedido)) return s;
  throw new Error(`nenhuma skill atende pedidos do tipo "${tipoPedido}" ainda`);
}

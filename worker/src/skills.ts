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

export type Skill = {
  nome: string;
  descricao: string;
  tipos: string[];
  apps: App[];
  saidas: SaidaEsperada[];
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

export function lerSaida(linha: string): SaidaEsperada {
  const [caminho, dim] = linha.split(/\s+/);
  if (!/^(saida|editavel)\/[\w.-]+$/.test(caminho)) {
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
  return {
    nome,
    descricao: String(campos.description ?? ''),
    tipos: lista('tipos'),
    apps: apps as App[],
    saidas,
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

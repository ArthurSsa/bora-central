// A entrega da equipe: quando a Bora assume um pedido, corrige no editor dela
// e sobe os arquivos. Aqui ninguém produz nada — o "agente" desta rodada só
// põe cada arquivo no lugar que a skill manda entregar, pelo nome. Depois vem
// a conferência de sempre: arquivo por arquivo, a marca, o texto, o vídeo. A
// Bora também não passa sem conferir.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CUSTO_ZERO, FalhaDoAgente, type Agente } from './agente.ts';

export const agenteDaBora: Agente = async (p) => {
  await p.aoMudarEtapa({ etapa: 'conferindo a entrega da equipe', progresso: 40 });
  const faltam: string[] = [];
  for (const s of p.dados.saidas) {
    const nome = path.basename(s.caminho);
    const origem = path.join(p.pastaJob, 'entrada', 'da_bora', nome);
    if (!existsSync(origem)) { faltam.push(nome); continue; }
    const destino = path.join(p.pastaJob, s.caminho);
    mkdirSync(path.dirname(destino), { recursive: true });
    copyFileSync(origem, destino);
  }
  if (faltam.length) {
    throw new FalhaDoAgente(`faltou na entrega da equipe: ${faltam.join(', ')}`, CUSTO_ZERO);
  }
  return { custos: CUSTO_ZERO, resumo: `Entrega da equipe da Bora: ${p.dados.saidas.length} arquivos, conferidos como qualquer rodada.`, turnos: 0 };
};

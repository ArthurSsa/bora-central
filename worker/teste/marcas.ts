// As marcas da Beatriz e do Moacyr como estão no banco (clientes.marca), só
// com o que a fábrica usa. Copiadas aqui pra os testes rodarem sem rede; se a
// marca mudar no Estúdio, mude aqui também — o teste de conferência é sobre
// ELAS, não sobre uma marca inventada.
import type { ClienteParaMarca } from '../src/marca.ts';

export const BEATRIZ: ClienteParaMarca = {
  nome: 'Ana Beatriz Leite', nome_preferido: null, cor: '#1E2A3A', registro_profissional: null, instagram: '@ana_aprendeai',
  marca: {
    margem: 'folgada', alinha: 'esq', numerar: true, cor2: '#A4E830',
    fonteMarca: 'Manrope', fonteFalback: 'display', conjuntoPadrao: 'j-noite',
    paleta: [{ cor: '#1E2A3A', nome: 'Azul-noite' }, { cor: '#FFFFFF', nome: 'Branco' }, { cor: '#A4E830', nome: 'Verde-limão' }],
    conjuntos: [
      { k: 'j-noite', nome: 'Azul-noite', fundo: '#1E2A3A', tinta: '#FFFFFF', destaque: '#A4E830', faixa: '#A4E830' },
      { k: 'j-limao', nome: 'Verde-limão', fundo: '#A4E830', tinta: '#1E2A3A', destaque: '#1E2A3A', faixa: '#1E2A3A' },
    ],
    chamada: 'Salva esse post pra testar depois.',
    evitar: 'Política partidária. Lifestyle de luxo. Conteúdo motivacional vazio. Emoji.',
    tom: 'Direta, honesta, reflexiva, prática.',
  },
};

export const MOACYR: ClienteParaMarca = {
  nome: 'Moacyr Regys Simões Moreira', nome_preferido: null, cor: '#E8A33D', registro_profissional: null, instagram: '@profmoacyrregys',
  marca: {
    margem: 'folgada', alinha: 'esq', numerar: true, cor2: '#E8A33D',
    fonteMarca: '', fonteFalback: 'impacto', conjuntoPadrao: 'j-autoridade',
    paleta: [
      { cor: '#15181C', nome: 'Grafite' }, { cor: '#F4F1EA', nome: 'Areia' }, { cor: '#E8A33D', nome: 'Âmbar' },
      { cor: '#8A5A05', nome: 'Âmbar escuro' }, { cor: '#FFFFFF', nome: 'Branco' }, { cor: '#9AA0A8', nome: 'Cinza' },
    ],
    conjuntos: [
      { k: 'j-autoridade', nome: 'Autoridade', fundo: '#15181C', tinta: '#FFFFFF', destaque: '#E8A33D', faixa: '#E8A33D' },
      { k: 'j-aula', nome: 'Aula', fundo: '#F4F1EA', tinta: '#15181C', destaque: '#8A5A05', faixa: '#15181C' },
      { k: 'j-convite', nome: 'Convite', fundo: '#E8A33D', tinta: '#15181C', destaque: '#15181C', faixa: '#15181C' },
    ],
    tom: 'Autoridade, inspirador e empático.',
    evitar: 'Política. Associação com bebida.',
  },
};

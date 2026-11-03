# CNPJ e conta pra receber: checklist (tarefa 10)

Pesquisado em 03/11/2026, em fontes oficiais (Planalto, Receita/Simples Nacional, gov.br, IBGE, JUCEC, Prefeitura de Fortaleza, Asaas); o que é leitura nossa ou não foi confirmado está marcado. Nada foi aberto nem cadastrado: abrir empresa e conta é com o Arthur (fila B).

## Resumo em quatro linhas

1. **Não dá pra ser MEI.** Nenhuma ocupação permitida no MEI cobre software, e nenhum CNAE 62xx, 6311 ou 6319 está na lista oficial ([Anexo XI](https://www8.receita.fazenda.gov.br/simplesnacional/arquivos/manual/anexo_xi.pdf)). O caminho é **ME no Simples Nacional**, numa LTDA de um sócio só (SLU).
2. **Imposto:** 6% do faturamento no Anexo III, se a folha com o pró-labore for pelo menos 28% da receita dos últimos 12 meses (Fator R); 15,5% no Anexo V, se for menos ([LC 123, art. 18](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm); alíquotas da 1ª faixa, até R$ 180 mil/ano, [LC 155](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp155.htm)).
3. **Abrir no Ceará** é isento na JUCEC pelo Registro Automático e leva em média 19 horas ([JUCEC](https://www.ce.gov.br/jucec/2026/01/09/jucec-atualiza-tabela-de-servicos-para-2026-e-reforca-isencoes-para-registro-automatico/); [O Povo](https://mais.opovo.com.br/jornal/economia/2026/09/02/com-saldo-de-447-mil-empresas-ceara-abre-80-mais-negocios-do-que-fecha-aponta-jucec.html)). Contando o alvará e a opção pelo Simples, uns dias.
4. **Asaas:** sem mensalidade; Pix R$ 2,15; cartão R$ 0,49 + 2,99%, que cai em ~32 dias; assinatura recorrente no cartão é automática ([preços](https://www.asaas.com/precos-e-taxas)).

## O que muda nos custos da Bora (`docs/progresso/arquivos/custos-bora.md`)

| Item | Estava | Fica |
|---|---|---|
| Imposto | DAS MEI R$ 86,05/mês fixo | percentual do faturamento: 6% (Anexo III, com pró-labore ≥ 28%) ou 15,5% (Anexo V) |
| Contador | não estava | R$ 189 a R$ 450/mês em contabilidade online ([Contabilidade.com](https://www.contabilidade.com/planos-e-precos)); escritório em Fortaleza, uns R$ 400 a 900 (estimativa) |
| Pix recebido no Asaas | R$ 1,99 | R$ 2,15 (R$ 1,08 nos 3 primeiros meses) |
| INSS do pró-labore | não estava | 11% do pró-labore (a confirmar com o contador) |

**Pró-labore e Fator R andam juntos.** Faturando R$ 10 mil/mês, o pró-labore de R$ 2.800 (28%) põe a empresa no Anexo III. Fica assim (conta nossa, a conferir):
- DAS de uns R$ 600, mais uns R$ 308 de INSS do sócio: R$ 908.
- No Anexo V, sem pró-labore, o DAS seria uns R$ 1.550.
- O pró-labore do Arthur (o nível N2 do ADR 0002) acaba pagando parte do próprio imposto. Até R$ 5 mil/mês ele não paga IR em 2026 ([Receita](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/tabelas/2026)).

## Passos (Redesim Ceará)

Fontes: [Redesim CE](https://redesim.ce.gov.br/) e [gov.br](https://www.gov.br/empresas-e-negocios/pt-br/redesim/abrir-cnpj).

- [ ] **Antes:** conversar com o contador (perguntas abaixo) e decidir o CNAE principal e o pró-labore.
- [ ] **1. Consulta de viabilidade:** o endereço vai pro município e o nome empresarial pra JUCEC. O Simulador de Risco diz se a atividade é de baixo risco.
- [ ] **2. DBE no Coletor Nacional** da Receita, com o protocolo da viabilidade.
- [ ] **3. Registro na JUCEC pelo Registro Automático (isento).** Fora dele, o contrato custa R$ 271,29.
- [ ] **4. Assinar os documentos.** Saem o CNPJ e a inscrição municipal. Não confirmamos se a inscrição de Fortaleza é automática.
- [ ] **5. Licença:** pedir a **Isenção Única para Funcionamento** na SEUMA, para atividade de baixo risco em até 200 m² ([manual](https://urbanismoemeioambiente.fortaleza.ce.gov.br/images/urbanismo-e-meio-ambiente/manuais/MANUAL_ISENCAO_UNICA_DO_FUNCIONAMENTO_v2.pdf)). Não confirmado: se é gratuita e se os CNAEs de software estão no anexo do decreto.
- [ ] **6. Optar pelo Simples Nacional** no MAT, até 30 dias depois do último deferimento e no máximo 60 dias depois do CNPJ. A opção volta à data de abertura ([Receita](https://www8.receita.fazenda.gov.br/simplesnacional/noticias/NoticiaCompleta.aspx?id=95f6d782-6096-4bdb-bc13-24b6b7785eac)). **Perder esse prazo é caro.**
- [ ] **7. Nota fiscal:** desde 01/11/2026, ME e EPP do Simples emitem NFS-e pelo **Emissor Nacional** ([Res. CGSN 191/2026](https://economia.df.gov.br/documents/d/seec/resol-cgsn-n-191-2026-pdf)). O serviço deve cair no item 1.03 ou 1.05 da [LC 116](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm).
- [ ] **8. Conta no Asaas:** documento e selfie do responsável e o CNPJ, com análise em até 48 h ([docs](https://docs.asaas.com/docs/onboarding-e-envio-de-documentos-via-link)). A lista exata pra LTDA só aparece no cadastro.
- [ ] **9. Configurar a cobrança:** assinatura por cartão (automática) e por Pix. O Pix comum é pago à mão a cada mês; o **Pix Automático** debita sozinho, com autorização (taxa não publicada) ([docs](https://docs.asaas.com/docs/diferen%C3%A7a-entre-pix-autom%C3%A1tico-e-assinaturas-1)).

## Perguntas pro contador

1. Qual o CNAE principal pra um software de criação de conteúdo por assinatura: 6203-1/00, 6311-9/00 ou 6319-4/00? Pelo IBGE, "acesso a programas pela internet" fica na 6319. Algum deles fica fora do Fator R?
2. Qual item da LC 116 vai na nota (1.03, 1.05 ou 1.09)? Vocês já emitem pelo Emissor Nacional?
3. Qual o pró-labore mínimo pra ficar no Anexo III nos primeiros meses, sem 12 meses de histórico? Compensa mais que o Anexo V sem pró-labore?
4. Com a regra nova do Fator R em 2027 (os 12 meses antes do mês anterior), quando começar o pró-labore?
5. IBS e CBS dentro do DAS ou por fora, a partir de 2027? Quando é a próxima janela?
6. Assinatura por cartão e Pix no Asaas: como reconhecer a receita (o regime de caixa acaba em 2027) e conciliar as taxas e os 32 dias do cartão?
7. Dá pra abrir como SLU pelo Registro Automático (isento), com o endereço de casa? Ele serve pra Isenção Única da SEUMA? Tem taxa municipal?
8. Qual o prazo exato pra optar pelo Simples, e quem faz? O que acontece se perder?
9. Como fica a retirada de lucro, e a retenção de 10% sobre dividendos acima de R$ 50 mil/mês (Lei 15.270/2025)?
10. O que entra na mensalidade (abertura, pró-labore no eSocial, DCTFWeb, nota, IR do sócio, certificado digital) e o que é cobrado à parte?

## Mudanças recentes que importam

- **Teto do MEI:** a LC 238, de 21/10/2026, sobe o teto pra R$ 110 mil em 2027 e R$ 140 mil em 2028, mas continua sem software ([Planalto](https://planalto.gov.br/ccivil_03/leis/lcp/lcp238.htm)).
- **Reforma tributária:** a partir de 2027, o IBS e a CBS entram no DAS, e o regime de caixa acaba ([Receita](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/setembro/simples-nacional-2027-entenda-os-novos-prazos-e-faca-sua-escolha-com-consciencia-e-tranquilidade)).
- **Salário mínimo de 2026:** R$ 1.621 ([Decreto 12.797](https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12797.htm)).

## Não confirmado

- Se as atividades 6311 e 6319 vão direto pro Anexo III, sem Fator R.
- Se a Isenção Única de Fortaleza é gratuita e se cobre software.
- A taxa municipal de funcionamento (TFF).
- A lista oficial de documentos do Asaas pra LTDA.
- A taxa do Pix Automático.
- Se o prazo de opção pelo Simples mudou em 2027.

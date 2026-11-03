# Geradores de imagem e de vídeo: preços (tarefas 4 e 6)

- **Pesquisado em:** 03/11/2026, nas páginas oficiais de preço e de modelo de cada provedor (links em cada linha). Nada foi comprado nem testado: falta a conta e a chave (fila B).
- **Ressalva:** os números foram lidos das páginas por um leitor automático. Os que decidem a escolha (Seedream 4.0, Recraft V4, Kling 2.5 Turbo Pro, BiRefNet) precisam ser conferidos no painel antes de fechar orçamento.
- **Como ler:** "exato" é o preço da configuração; "exemplo" é o custo de uma execução que a Runware mostra sem dizer os parâmetros; "a partir de" é a configuração mais barata; "cálculo" e "estimativa" são contas nossas.

## Imagem

| Modelo | fal.ai | Runware | Bom pra |
|---|---|---|---|
| FLUX.1 [schnell] | US$ 0,003/MP (exato); 1080×1350 = 2 MP = US$ 0,006 (cálculo) · [fonte](https://fal.ai/models/fal-ai/flux/schnell) | US$ 0,0006 a 1024×768 (exemplo, por tempo de GPU) · [fonte](https://runware.ai/models/bfl-flux-1-schnell) | rascunho rápido; licença Apache 2.0 |
| FLUX.1 [dev] | US$ 0,025/MP (exato), selo "uso comercial" · [fonte](https://fal.ai/models/fal-ai/flux/dev) | US$ 0,0013 (exemplo); **licença do modelo restringe uso comercial**, a Runware não diz se tem acordo · [fonte](https://runware.ai/models/bfl-flux-1-dev) | evitar na Runware |
| Seedream 4.0 / 4.5 | US$ 0,03 / 0,04 por imagem (exato) · [fonte](https://fal.ai/pricing) | US$ 0,03 / 0,04 por imagem · [fonte](https://runware.ai/models/bytedance-seedream-4-0) | foto e 3D suave |
| Recraft V4 | US$ 0,04 por imagem (exato); V3 em estilo vetorial US$ 0,08 · [fonte](https://fal.ai/models/fal-ai/recraft/v4/text-to-image/llms.txt) | V4 US$ 0,04; V4.1 US$ 0,035; V4.1 Flash US$ 0,007 (a partir de) · [fonte](https://runware.ai/collections/family-recraft) | flat e ilustração |
| Ideogram | V3: US$ 0,03 / 0,06 / 0,09 (turbo, balanced, quality) · [fonte](https://fal.ai/models/fal-ai/ideogram/v3/llms.txt) | 4.0: US$ 0,06 (a partir de), fundo transparente segundo a descrição; o 4.5 aparece a US$ 0,008 numa página e US$ 0,20 em outra (conflito) · [fonte](https://runware.ai/collections/best-text-to-image) | conferir antes de usar |
| Qwen-Image | US$ 0,02/MP (exato) · [fonte](https://fal.ai/models/fal-ai/qwen-image/llms.txt) | 2.1 Turbo US$ 0,0141 (1024×1024, a partir de) · [fonte](https://runware.ai/collections/fastest-image-generation) | alternativa barata |

**Remover o fundo:**
- **Runware:** BiRefNet US$ 0,0006 por imagem, Bria RMBG 2.0 US$ 0,018 · [fonte](https://runware.ai/collections/best-background-removal)
- **fal.ai:** Bria RMBG 2.0 US$ 0,018; BiRefNet aparece como "US$ 0 por segundo", o que precisa de teste · [fonte](https://fal.ai/pricing)
- **Na fábrica, sem custo:** o recorte da ArtCraft (`worker/src/objeto.ts`) resolve fundo liso, que é o que o pedido ao gerador vai exigir. O serviço pago fica pra quando o fundo não sair liso.

## Vídeo (clipe de 5 s)

| Modelo | fal.ai | Runware |
|---|---|---|
| Kling 2.5 Turbo Pro | US$ 0,35 por 5 s + US$ 0,07 por segundo extra (exato) · [fonte](https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video/llms.txt) | US$ 0,35 por 5 s (exemplo); Turbo Standard US$ 0,21 · [fonte](https://runware.ai/models/klingai-2-5-turbo-pro) |
| Seedance 1.0 Pro Fast | 1080p de 5 s ≈ US$ 0,243 (página); 720p ≈ US$ 0,108 (cálculo) · [fonte](https://fal.ai/models/fal-ai/bytedance/seedance/v1/pro/fast/image-to-video/llms.txt) | US$ 0,16 por 5 s imagem→vídeo (exemplo) · [fonte](https://runware.ai/models/bytedance-seedance-1-0-pro-fast) |
| Hailuo 02 Standard | US$ 0,045/s em 768p (US$ 0,27 por 6 s) · [fonte](https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video/llms.txt) | US$ 0,28 a 0,49 por 6 s (exemplos) · [fonte](https://runware.ai/models/minimax-hailuo-02) |
| Wan 2.5 | US$ 0,05 / 0,10 / 0,15 por segundo em 480p / 720p / 1080p · [fonte](https://fal.ai/models/fal-ai/wan-25-preview/text-to-video/llms.txt) | US$ 0,454 por 5 s em 720p com áudio (não conferido na página) |
| Veo 3.1 Fast | US$ 0,10/s sem áudio (exato) · [fonte](https://fal.ai/models/fal-ai/veo3.1/fast/llms.txt) | US$ 0,60 por 4 s (a partir de) |

## Licença e pagamento

| | fal.ai | Runware |
|---|---|---|
| Dono da saída | os termos não dizem; o selo "Commercial use" vale por modelo ([termos](https://fal.ai/terms)) | "you own your Outputs"; uso comercial permitido, mas a licença de cada modelo prevalece ([termos](https://runware.ai/terms)) |
| Crédito | pré-pago; **expira em 365 dias** | pré-pago; **não expira**; recarga mínima US$ 20 ([ajuda](https://help.runware.ai/articles/7648578038-payments-and-credits)) |
| Crédito grátis | não publicado oficialmente | US$ 2 com e-mail corporativo ([preços](https://runware.ai/pricing)); programa de startups até US$ 1.000 |
| Cartão internacional | não publicado | sim (Stripe), em dólar; soma IOF |

## Recomendação

- **Provedor principal: Runware.** Os créditos não expiram, ela é até 30 vezes mais barata nos modelos abertos e dá US$ 2 pra testar. Nos modelos de parceiros (Seedream, Recraft, Kling) o preço é o mesmo nos dois.
- **Plano B: fal.ai,** que tem o selo comercial por modelo e documentação mais clara.
- **Modelos do teste:**
  - **Seedream 4.0** (US$ 0,03) pra foto e 3D suave;
  - **Recraft V4** (US$ 0,04) pra flat e ilustração;
  - **Kling 2.5 Turbo Pro** (US$ 0,35 por 5 s) pro vídeo.

| Teste (tarefas 4 e 6) | Conta | Custo |
|---|---|---|
| 10 pedidos × 3 variações no Seedream 4.0 | 30 × 0,03 | US$ 0,90 |
| os mesmos 30 no Recraft V4 | 30 × 0,04 | US$ 1,20 |
| 3 clipes de 5 s no Kling 2.5 Turbo Pro | 3 × 0,35 | US$ 1,05 |
| **Total** | | **≈ US$ 3,15** (sem IOF) |

**No custo de um cliente:** um post com imagem gerada soma uns US$ 0,09 aos US$ 0,17 do post (3 variações no Seedream). Um vídeo com 2 clipes gerados soma uns US$ 0,70. É o maior custo novo do v2, e a cota de vídeo por plano precisa sair daqui.

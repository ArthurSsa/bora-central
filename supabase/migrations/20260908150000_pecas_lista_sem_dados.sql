-- A peça agora carrega imagens dentro de `dados`. Carregar todas na abertura da
-- Central passaria a puxar megabytes que ninguém vai olhar, então a lista pede
-- só o cabeçalho e o número de slides, e o desenho inteiro vem quando a peça é
-- aberta. O número fica numa coluna de verdade, mantida por gatilho, porque é
-- coisa que a lista mostra e ordena — a regra de sempre: jsonb só pro que se lê
-- junto com a linha.
alter table public.pecas add column if not exists qtd_slides int not null default 0;

create or replace function public.pecas_resumir() returns trigger
language plpgsql as $$
begin
  new.qtd_slides := case
    when jsonb_typeof(new.dados -> 'slides') = 'array'
      then jsonb_array_length(new.dados -> 'slides')
    else 0
  end;
  return new;
end $$;

drop trigger if exists pecas_resumo on public.pecas;
create trigger pecas_resumo
  before insert or update on public.pecas
  for each row execute function public.pecas_resumir();

-- Recalcula o que já estava guardado.
update public.pecas set dados = dados;

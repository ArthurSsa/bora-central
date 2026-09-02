-- Tira do anon o direito de executar as funções da camada da agência.
-- is_bora_member() é SECURITY DEFINER: quem pode chamá-la sem estar logado
-- ganha um oráculo de graça sobre quem é da Bora.

revoke execute on function public.is_bora_member() from anon, public;
grant execute on function public.is_bora_member() to authenticated, service_role;
revoke execute on function public.touch_updated_at() from anon, public;

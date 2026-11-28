-- Motol Simulator v3.0 – POUŽÍT AŽ PŘI VYDÁNÍ v3.0 (po sloučení do main), jinak by současní hráči přišli o žebříček.
-- starý vstup: neověřený výsledek (bez race_start) je skrytý v žebříčku a dostane polovinu odměny podle serveru;
-- p_reward od klienta se ignoruje
create or replace function public.submit_result(p_mode text, p_time_s numeric, p_points integer, p_position integer, p_reward integer)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return public.record_result(auth.uid(), p_mode, p_time_s, p_points, p_position, false, null, true, 0.5);
end $$;


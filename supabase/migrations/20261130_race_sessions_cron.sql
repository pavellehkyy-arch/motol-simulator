-- Denní úklid race_sessions (zásady slibují smazání po 30 dnech, i když nikdo nehraje).
create extension if not exists pg_cron;
select cron.schedule('race_sessions_cleanup', '17 3 * * *',
  $$delete from public.race_sessions where started_at < now() - interval '30 days'$$);

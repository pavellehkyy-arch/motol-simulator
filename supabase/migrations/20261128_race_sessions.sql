-- Motol Simulator v3.0: ověřené výsledky závodů a signalizace online závodu (WebRTC).
-- Závod začíná race_start (čas podle serveru), končí race_finish (kontrola věrohodnosti, odměnu počítá server).
-- Starý submit_result se přepne až při vydání (20261129_submit_result_unverified.sql).

create table if not exists public.race_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,
  race_key uuid,                 -- online závod: společné id od hostitele (null = závod proti botům)
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'run' check (status in ('run','done','rejected','abandoned','disputed')),
  reason text,
  position smallint,
  race_order uuid[],             -- online: pořadí účtů v cíli, jak ho viděl tento hráč (null = bot)
  result_id bigint
);
create index if not exists race_sessions_user on public.race_sessions (user_id, started_at desc);
create index if not exists race_sessions_started on public.race_sessions (started_at);
create index if not exists race_sessions_key on public.race_sessions (race_key) where race_key is not null;
alter table public.race_sessions enable row level security;   -- hráč do ní přímo nesahá
revoke all on public.race_sessions from anon, authenticated;

-- ---------- odměna podle stejných tabulek jako earnedCredits() ve hře ----------
create or replace function public.race_reward(p_mode text, p_pos integer, p_time numeric, p_dnf boolean, p_pb boolean, p_extra jsonb)
returns integer language plpgsql immutable set search_path to '' as $$
declare
  n integer := 0; sp numeric; e jsonb := coalesce(p_extra, '{}'::jsonb);
  beer integer := least(greatest(coalesce((e->>'beer')::integer, 0), 0), 30);
  lap integer := least(greatest(coalesce((e->>'lap')::integer, 0), 0), 5);
  s0 integer := least(greatest(coalesce((e->>'s0')::integer, 0), 0), 1);
  s1 integer := least(greatest(coalesce((e->>'s1')::integer, 0), 0), 2);
begin
  if p_dnf then return 0; end if;
  if p_mode = 'kilometr' then
    if p_time is null or p_time <= 0 then return 0; end if;
    sp := 1000 / p_time * 3.6;
    n := 20 + greatest(0, round((sp - 48) * 4))::integer + case when p_pb then 50 else 0 end;
  elsif p_mode = 'team_sprint' then
    if p_time is null or p_time <= 0 then return 0; end if;
    sp := 5 * 153.846 / p_time * 3.6;
    n := 30 + case when p_pos = 1 then 70 else 0 end + greatest(0, round((sp - 46) * 4))::integer;
  elsif p_pos is null or p_pos < 1 then return 0;
  elsif p_mode = 'omnium' then n := coalesce((array[200,150,110,85,65,50,40,32,26,20])[p_pos], 20);
  elsif p_mode = 'madison' then n := coalesce((array[120,80,55,35,25])[p_pos], 20);
  elsif p_mode = 'vylucovacka' then n := coalesce((array[110,75,55,40,30,24,18,14,10])[p_pos], 10);
  elsif p_mode = 'bodovacka' then n := coalesce((array[120,85,60,45,35,28,22,18,14,10])[p_pos], 10) + 15 * lap;
  elsif p_mode = 'keirin' then n := coalesce((array[110,75,55,40,30,24])[p_pos], 15);
  elsif p_mode = 'sprint' then n := case when p_pos = 1 then 110 + case when s1 = 0 then 25 else 0 end else 40 + 15 * s0 end;
  else n := coalesce((array[100,70,50,35,28,22,18,15,12])[p_pos], 10);   -- scratch
  end if;
  return least(n + beer, 400);
end $$;
revoke all on function public.race_reward(text, integer, numeric, boolean, boolean, jsonb) from public, anon, authenticated;

-- nejkratší věrohodná doba závodu (s, skutečný čas od race_start) pro dojetí na daném místě
-- (rychlost v cíli hry nepřesáhne ~20 m/s; vylučovačka: kdo vypadne dřív, jede kratší dobu)
create or replace function public.race_min_elapsed(p_mode text, p_pos integer)
returns numeric language sql immutable set search_path to '' as $$
  select case p_mode
    when 'scratch' then 90
    when 'bodovacka' then 260
    when 'madison' then 200
    when 'omnium' then 300
    when 'keirin' then 55
    when 'sprint' then 45
    when 'vylucovacka' then greatest(0, 8 - coalesce(p_pos, 12)) * 12 + 10
    else 0 end::numeric
$$;
revoke all on function public.race_min_elapsed(text, integer) from public, anon, authenticated;

-- ---------- společný zápis výsledku (dřív tělo submit_result) ----------
create or replace function public.record_result(p_uid uuid, p_mode text, p_time_s numeric, p_points integer, p_position integer,
  p_dnf boolean, p_extra jsonb, p_hidden boolean, p_reward_scale numeric)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_last timestamptz; v_reward integer; v_day integer; v_money integer; v_before jsonb; v_after jsonb;
  v_pb boolean := false; v_id bigint;
begin
  if p_mode is null or p_mode not in
     ('kilometr','sprint','keirin','bodovacka','vylucovacka','madison','scratch','omnium','team_sprint') then
    raise exception 'invalid_mode';
  end if;
  if p_time_s is not null and (p_time_s < 30 or p_time_s > 600) then raise exception 'invalid_time'; end if;
  if p_points is not null and (p_points < -1000 or p_points > 1000) then raise exception 'invalid_points'; end if;
  if p_position is not null and (p_position < 1 or p_position > 12) then raise exception 'invalid_position'; end if;
  if p_mode in ('kilometr','team_sprint') and p_time_s is null and p_position is not null then raise exception 'invalid_time'; end if;

  insert into public.profiles (id) values (p_uid) on conflict (id) do nothing;
  select max(created_at) into v_last from public.results where user_id = p_uid;
  if v_last is not null and v_last > now() - interval '5 seconds' then raise exception 'too_fast'; end if;

  v_before := public.rank_of(p_mode, p_uid);
  if v_before is not null and not p_hidden then
    if p_mode in ('kilometr','team_sprint') then
      v_pb := p_time_s is not null and (v_before->>'best_time_s' is null or p_time_s < (v_before->>'best_time_s')::numeric);
    elsif p_mode in ('bodovacka','madison','omnium') then
      v_pb := p_points is not null and (v_before->>'best_points' is null or p_points > (v_before->>'best_points')::integer);
    end if;
  end if;

  -- odměnu počítá server; max 400 za závod a 5000 za 24 hodin
  select coalesce(sum(reward), 0) into v_day from public.results where user_id = p_uid and created_at > now() - interval '24 hours';
  v_reward := floor(public.race_reward(p_mode, p_position, p_time_s, coalesce(p_dnf, false), v_pb and p_mode = 'kilometr', p_extra) * p_reward_scale)::integer;
  v_reward := least(greatest(v_reward, 0), 400, greatest(5000 - v_day, 0));

  insert into public.results (user_id, mode, time_s, points, position, reward, hidden)
    values (p_uid, p_mode, p_time_s, p_points, p_position, v_reward, p_hidden) returning id into v_id;
  update public.profiles set money = money + v_reward, updated_at = now() where id = p_uid returning money into v_money;
  v_after := public.rank_of(p_mode, p_uid);

  return jsonb_build_object('reward', v_reward, 'money', v_money, 'pb', v_pb, 'result_id', v_id,
    'place', (v_after->>'place')::integer, 'prev_place', (v_before->>'place')::integer,
    'approved', coalesce((v_after->>'approved')::boolean, false), 'verified', not p_hidden);
end $$;
revoke all on function public.record_result(uuid, text, numeric, integer, integer, boolean, jsonb, boolean, numeric) from public, anon, authenticated;

-- ---------- začátek závodu: čas podle serveru ----------
create or replace function public.race_start(p_mode text, p_race_key uuid default null)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_mode is null or p_mode not in
     ('kilometr','sprint','keirin','bodovacka','vylucovacka','madison','scratch','omnium','team_sprint') then
    raise exception 'invalid_mode';
  end if;
  if p_race_key is not null and not public.can_walk_online() then raise exception 'not_allowed'; end if;
  select count(*) into v_n from public.race_sessions where user_id = v_uid and started_at > now() - interval '1 hour';
  if v_n >= 120 then raise exception 'too_many'; end if;
  update public.race_sessions set status = 'abandoned' where user_id = v_uid and status = 'run';
  -- úklid: sezení starší 30 dnů (všech hráčů, po malých dávkách)
  delete from public.race_sessions where id in (select id from public.race_sessions where started_at < now() - interval '30 days' limit 200);
  insert into public.race_sessions (user_id, mode, race_key) values (v_uid, p_mode, p_race_key) returning id into v_id;
  return v_id;
end $$;

-- ---------- konec závodu: kontrola věrohodnosti, zápis výsledku ----------
-- p_order (online): pořadí účtů v cíli tak, jak ho viděl hráč, boti = null
create or replace function public.race_finish(p_session uuid, p_time_s numeric, p_points integer, p_position integer,
  p_dnf boolean default false, p_extra jsonb default null, p_order uuid[] default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid(); S public.race_sessions; v_el numeric; v_pos integer := p_position; v_res jsonb;
  v_agree integer; v_dis integer; o record; v_why text; v_order uuid[]; v_n integer; v_med integer; v_hide boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into S from public.race_sessions where id = p_session and user_id = v_uid for update;
  if not found then raise exception 'no_session'; end if;
  if S.status <> 'run' then raise exception 'session_closed'; end if;
  if S.started_at < now() - interval '24 hours' then raise exception 'session_expired'; end if;
  v_el := extract(epoch from now() - S.started_at);

  -- čas závodu nemůže být delší než skutečně uplynulý čas, a ne rychlejší než lidsky možné
  if p_time_s is not null and p_time_s > v_el + 3 then v_why := 'time_vs_clock';
  elsif S.mode = 'kilometr' and p_time_s is not null and p_time_s < 55 then v_why := 'time_too_fast';
  elsif S.mode = 'team_sprint' and p_time_s is not null and p_time_s < 40 then v_why := 'time_too_fast';
  elsif not coalesce(p_dnf, false) and v_pos is not null and v_el < public.race_min_elapsed(S.mode, v_pos) then v_why := 'too_short';
  end if;
  if v_why is not null then
    update public.race_sessions set status = 'rejected', reason = v_why, finished_at = now() where id = S.id;
    return jsonb_build_object('rejected', true, 'reason', v_why);
  end if;

  -- online závod: pořadí podle hlášení ostatních účastníků
  if S.race_key is not null and p_order is null then
    update public.race_sessions set status = 'rejected', reason = 'no_order', finished_at = now() where id = S.id;
    return jsonb_build_object('rejected', true, 'reason', 'no_order');
  end if;
  if S.race_key is not null then
    if coalesce(array_length(p_order, 1), 0) > 12 then raise exception 'invalid_order'; end if;
    -- do pořadí patří jen účty, které tenhle závod opravdu jely (mají sezení se stejným race_key, start do 5 min od prvního)
    select array_agg(case when u = any(v_mem) then u else null end order by i) into v_order
      from unnest(p_order) with ordinality t(u, i),
           (select array_agg(x.user_id) v_mem from public.race_sessions x
             where x.race_key = S.race_key and x.started_at < (select min(started_at) from public.race_sessions where race_key = S.race_key) + interval '5 minutes') m;
    if array_position(v_order, v_uid) is not null then v_pos := array_position(v_order, v_uid); end if;
    -- jak mě viděli ostatní: od dvou hlášení medián, od jednoho horší z obou (a výsledek se nezobrazí v žebříčku)
    select count(*), percentile_disc(0.5) within group (order by array_position(x.race_order, v_uid))
      into v_n, v_med from public.race_sessions x
      where x.race_key = S.race_key and x.user_id <> v_uid and x.status in ('done','disputed') and array_position(x.race_order, v_uid) is not null;
    if v_pos is not null and v_n >= 2 and v_med > v_pos then v_pos := v_med;
    elsif v_pos is not null and v_n = 1 and v_med > v_pos then v_pos := v_med; v_hide := true;
    end if;
    -- a zpětně: tvrdil někdo dřív lepší místo, než jak ho vidí většina? skryj jeho výsledek
    for o in select x.* from public.race_sessions x
      where x.race_key = S.race_key and x.user_id <> v_uid and x.status = 'done' and x.position is not null loop
      select count(*) filter (where array_position(y.race_order, o.user_id) > o.position),
             count(*) filter (where array_position(y.race_order, o.user_id) <= o.position)
        into v_dis, v_agree
        from (select x2.race_order from public.race_sessions x2
               where x2.race_key = S.race_key and x2.user_id <> o.user_id and x2.status in ('done','disputed') and x2.race_order is not null
              union all select v_order) y;
      -- jeho vlastní hlášení se počítá jako souhlas: rozhoduje většina; při dvou rozporných hlášeních se skryjí oba výsledky
      if v_dis > v_agree + 1 or (v_n = 1 and v_hide and v_dis > 0) then
        update public.race_sessions set status = 'disputed', reason = 'order' where id = o.id;
        update public.results set hidden = true where id = o.result_id;
      end if;
    end loop;
  end if;

  v_res := public.record_result(v_uid, S.mode, p_time_s, p_points, v_pos, p_dnf, p_extra, v_hide, 1);
  update public.race_sessions set status = case when v_hide then 'disputed' else 'done' end, finished_at = now(), position = v_pos, race_order = v_order,
    result_id = (v_res->>'result_id')::bigint where id = S.id;
  return v_res || jsonb_build_object('position', v_pos);
end $$;

revoke all on function public.race_start(text, uuid) from public, anon;
revoke all on function public.race_finish(uuid, numeric, integer, integer, boolean, jsonb, uuid[]) from public, anon;
grant execute on function public.race_start(text, uuid) to authenticated;
grant execute on function public.race_finish(uuid, numeric, integer, integer, boolean, jsonb, uuid[]) to authenticated;

-- ---------- Realtime: signalizace online závodu (kanály zavod:<režim>:N) ----------
drop policy if exists zavod_read on realtime.messages;
drop policy if exists zavod_write on realtime.messages;
create policy zavod_read on realtime.messages for select to authenticated
  using (realtime.topic() like 'zavod:%' and extension in ('broadcast','presence') and public.can_walk_online());
create policy zavod_write on realtime.messages for insert to authenticated
  with check (realtime.topic() like 'zavod:%' and extension in ('broadcast','presence') and public.can_walk_online());

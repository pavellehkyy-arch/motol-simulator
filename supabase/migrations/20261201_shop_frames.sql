-- v3.5: rámy v obchodě (záložka Rámy). frame_std je zdarma a jen ve hře.
insert into public.shop_items (id, name, price, active) values
  ('frame_alu', 'Hliníkový rám', 700, true),
  ('frame_carbon', 'Karbonový monokok', 1800, true),
  ('frame_tt', 'Aero rám na časovku', 3500, true)
on conflict (id) do update set name = excluded.name, price = excluded.price, active = excluded.active;

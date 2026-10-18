-- Run once in Supabase > SQL Editor.
-- Turns on Row Level Security for every table so the public Supabase data API cannot read or change anything.
-- The BookHaven server connects with the database owner role, so the website keeps working.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

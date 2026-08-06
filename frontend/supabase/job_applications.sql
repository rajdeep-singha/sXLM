-- ============================================================================
-- StelloFi — Career applications table
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- ============================================================================

create table if not exists public.job_applications (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  position_id    text        not null,
  position_title text        not null,
  full_name      text        not null,
  email          text        not null,
  phone          text,
  linkedin_url   text,
  portfolio_url  text,
  cover_letter   text
);

-- Row Level Security: lock the table down, then open ONLY anonymous inserts.
alter table public.job_applications enable row level security;

-- Table-level privilege: the anon/authenticated roles need INSERT granted
-- (RLS decides *which* rows; GRANT decides whether the role can touch the table
--  at all). Without this you get: "permission denied for table job_applications".
grant insert on public.job_applications to anon, authenticated;

-- Allow the public (anon + authenticated) to submit applications...
create policy "Public can submit applications"
  on public.job_applications
  for insert
  to anon, authenticated
  with check (true);

-- ...but NOT read anyone's applications from the client.
-- (No SELECT policy = no read access via the anon key. View submissions in the
--  Supabase Table Editor / with the service role only.)

-- Optional: index for browsing newest-first in the dashboard.
create index if not exists job_applications_created_at_idx
  on public.job_applications (created_at desc);

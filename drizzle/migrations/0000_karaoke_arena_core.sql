create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','finished')),
  started_at timestamptz, ended_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  stage_name text,
  participant_number int not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (session_id, participant_number)
);
create index on public.participants(session_id);
create table public.playback_sources (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  title text not null,
  channel_name text, thumbnail_url text, duration text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);
create table public.performances (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  playback_source_id uuid not null references public.playback_sources(id),
  status text not null default 'queued' check (status in ('queued','active','completed','cancelled')),
  started_at timestamptz, ended_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.performances(session_id, status);
create index on public.performances(participant_id);
create table public.controllers (
  id uuid primary key default gen_random_uuid(),
  device_code text not null unique,
  status text not null default 'inactive',
  last_seen timestamptz, firmware_version text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid not null references public.performances(id) on delete cascade,
  controller_id uuid not null references public.controllers(id) on delete cascade,
  vote_type text not null check (vote_type in ('like','dislike')),
  created_at timestamptz not null default now(),
  unique (performance_id, controller_id)
);
create index on public.votes(performance_id);
create table public.provider_api_calls (
  id uuid primary key default gen_random_uuid(),
  provider text not null, endpoint text not null, query text,
  cached boolean not null default false, ok boolean not null default true, error text,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_sessions before update on public.sessions for each row execute function public.set_updated_at();
create trigger t_participants before update on public.participants for each row execute function public.set_updated_at();
create trigger t_performances before update on public.performances for each row execute function public.set_updated_at();
create trigger t_controllers before update on public.controllers for each row execute function public.set_updated_at();

create or replace function public.set_participant_number() returns trigger language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.session_id::text));
  select coalesce(max(participant_number),0)+1 into new.participant_number from public.participants where session_id = new.session_id;
  return new;
end $$;
create trigger t_participant_number before insert on public.participants for each row execute function public.set_participant_number();

grant select, insert, update on public.sessions, public.participants, public.performances to anon, authenticated;
grant select, insert on public.playback_sources to anon, authenticated;
grant select on public.provider_api_calls to anon, authenticated;
grant all on public.sessions, public.participants, public.playback_sources, public.performances, public.controllers, public.votes, public.provider_api_calls to service_role;

alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.playback_sources enable row level security;
alter table public.performances enable row level security;
alter table public.controllers enable row level security;
alter table public.votes enable row level security;
alter table public.provider_api_calls enable row level security;

create policy "mvp read sessions" on public.sessions for select using (true);
create policy "mvp insert sessions" on public.sessions for insert with check (true);
create policy "mvp update sessions" on public.sessions for update using (true);
create policy "mvp read participants" on public.participants for select using (true);
create policy "mvp insert participants" on public.participants for insert with check (true);
create policy "mvp update participants" on public.participants for update using (true);
create policy "mvp read sources" on public.playback_sources for select using (true);
create policy "mvp insert sources" on public.playback_sources for insert with check (provider in ('youtube'));
create policy "mvp read performances" on public.performances for select using (true);
create policy "mvp insert performances" on public.performances for insert with check (true);
create policy "mvp update performances" on public.performances for update using (true);
create policy "mvp read api calls" on public.provider_api_calls for select using (true);

alter publication supabase_realtime add table public.sessions, public.participants, public.performances;
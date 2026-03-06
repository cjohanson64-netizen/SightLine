create table if not exists public.student_progress_events (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  student_id text not null,
  exercise_id uuid null references public.exercises(id) on delete set null,
  event_type text not null check (event_type in ('start', 'stop', 'attempt')),
  duration_seconds int null check (duration_seconds >= 0),
  created_at timestamptz not null default now()
);

create index if not exists student_progress_events_folder_student_created_idx
  on public.student_progress_events (folder_id, student_id, created_at desc);

create index if not exists student_progress_events_exercise_created_idx
  on public.student_progress_events (exercise_id, created_at desc);

alter table public.student_progress_events enable row level security;

create table if not exists public.join_attempts (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  join_code text not null,
  created_at timestamptz not null default now()
);

create index if not exists join_attempts_ip_created_idx
  on public.join_attempts (ip, created_at desc);

create index if not exists join_attempts_join_code_created_idx
  on public.join_attempts (join_code, created_at desc);

alter table public.join_attempts enable row level security;

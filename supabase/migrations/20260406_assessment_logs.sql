create table if not exists public.assessment_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  teacher_id uuid null,
  class_id uuid null references public.folders(id) on delete set null,
  folder_id uuid null references public.folders(id) on delete set null,
  student_id text null,
  assignment_id text null,
  exercise_id uuid null references public.exercises(id) on delete set null,
  exercise_title text not null,
  seed int null,
  assessment_mode text not null check (
    assessment_mode in ('literal', 'octave_flexible', 'transposition_aware')
  ),
  weighted_score numeric(6, 2) not null,
  total_possible numeric(6, 2) not null,
  percent numeric(5, 2) not null,
  correct_count int not null default 0,
  ambiguous_count int not null default 0,
  low_confidence_count int not null default 0,
  incorrect_count int not null default 0,
  recovery_kind text null,
  tonal_state_kind text null,
  signal_quality_level text null check (
    signal_quality_level is null or signal_quality_level in ('high', 'medium', 'low')
  ),
  signal_quality_score numeric(5, 3) null,
  summary_text text null,
  note_details jsonb not null default '[]'::jsonb,
  summary_json jsonb null,
  created_at timestamptz not null default now()
);

alter table public.assessment_logs add column if not exists teacher_id uuid null;
alter table public.assessment_logs add column if not exists class_id uuid null references public.folders(id) on delete set null;

create index if not exists assessment_logs_owner_created_idx
  on public.assessment_logs (owner_id, created_at desc);

create index if not exists assessment_logs_folder_created_idx
  on public.assessment_logs (folder_id, created_at desc);

alter table public.assessment_logs enable row level security;

drop policy if exists "teacher_select_assessment_logs" on public.assessment_logs;
create policy "teacher_select_assessment_logs"
  on public.assessment_logs
  for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "teacher_delete_assessment_logs" on public.assessment_logs;
create policy "teacher_delete_assessment_logs"
  on public.assessment_logs
  for delete
  to authenticated
  using (owner_id = auth.uid());

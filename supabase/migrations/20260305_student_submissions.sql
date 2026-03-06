create table if not exists public.student_submissions (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  student_id text not null,
  title text not null,
  seed int not null,
  music_xml text not null,
  spec_json jsonb null,
  melody_json jsonb null,
  beats_per_measure int null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists student_submissions_folder_status_created_idx
  on public.student_submissions(folder_id, status, created_at desc);

alter table public.student_submissions enable row level security;

drop policy if exists "teacher_select_student_submissions" on public.student_submissions;
create policy "teacher_select_student_submissions"
  on public.student_submissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.folders f
      where f.id = student_submissions.folder_id
        and f.owner_id = auth.uid()
    )
  );

drop policy if exists "teacher_update_student_submissions" on public.student_submissions;
create policy "teacher_update_student_submissions"
  on public.student_submissions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.folders f
      where f.id = student_submissions.folder_id
        and f.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.folders f
      where f.id = student_submissions.folder_id
        and f.owner_id = auth.uid()
    )
  );

drop policy if exists "teacher_delete_student_submissions" on public.student_submissions;
create policy "teacher_delete_student_submissions"
  on public.student_submissions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.folders f
      where f.id = student_submissions.folder_id
        and f.owner_id = auth.uid()
    )
  );

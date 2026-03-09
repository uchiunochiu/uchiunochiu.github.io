-- 2026-03-06: project detail data model expansion
-- Additive migration for project detail dynamic data:
-- - project registration metadata fields
-- - project activity logs
-- - open questions
-- - project whiteboards
-- - rollback history

create extension if not exists pgcrypto;

-- 1) Project registration fields
alter table public.projects add column if not exists goal text;
alter table public.projects add column if not exists definition_of_done jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists constraints jsonb not null default '[]'::jsonb;
alter table public.projects add column if not exists links jsonb not null default '[]'::jsonb;

-- 2) Open questions
create table if not exists public.open_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  question_key text,
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open','in_talk','resolved')),
  created_by uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_open_questions_project on public.open_questions(project_id, created_at desc);
create index if not exists idx_open_questions_status on public.open_questions(status);

-- 3) Whiteboard per project
create table if not exists public.project_whiteboards (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  board_key text not null unique,
  title text,
  board_url text,
  board_state jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_whiteboards_project on public.project_whiteboards(project_id);

-- 4) Rollback points
create table if not exists public.project_rollbacks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  note text,
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_project_rollbacks_project on public.project_rollbacks(project_id, created_at desc);

-- 5) Project activity log (append only)
create table if not exists public.project_activity_logs (
  id bigserial primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  entity_type text not null,
  entity_id text,
  action text not null,
  summary text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_activity_logs_project on public.project_activity_logs(project_id, created_at desc);
create index if not exists idx_project_activity_logs_entity on public.project_activity_logs(entity_type, entity_id);

create or replace function public.touch_updated_at_generic()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.append_project_activity_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_actor_id uuid;
  v_entity_id text;
  v_action text;
  v_summary text;
  v_payload jsonb;
  v_status text;
begin
  v_actor_id := auth.uid();
  v_action := lower(tg_op);

  if tg_table_name = 'projects' then
    v_project_id := coalesce(new.id, old.id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_status := coalesce(new.status::text, old.status::text);
    v_summary := format('Project %s: %s (%s)', v_action, coalesce(new.title, old.title, '(no title)'), coalesce(v_status, '-'));
  elsif tg_table_name = 'tickets' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := jsonb_build_object(
      'old', case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
    );
    v_summary := format('Ticket %s: %s', v_action, coalesce(new.ticket_no, old.ticket_no, coalesce(new.title, old.title, '(no title)')));
  elsif tg_table_name = 'project_comments' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_summary := format('Project comment %s', v_action);
  elsif tg_table_name = 'ticket_comments' then
    select t.project_id into v_project_id from public.tickets t where t.id = coalesce(new.ticket_id, old.ticket_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_summary := format('Ticket comment %s', v_action);
  elsif tg_table_name = 'open_questions' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_summary := format('Open question %s: %s', v_action, coalesce(new.question_key, old.question_key, coalesce(new.title, old.title, '(no title)')));
  elsif tg_table_name = 'project_rollbacks' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_summary := format('Rollback point %s: %s', v_action, coalesce(new.label, old.label, '(no label)'));
  elsif tg_table_name = 'project_whiteboards' then
    v_project_id := coalesce(new.project_id, old.project_id);
    v_entity_id := coalesce(new.id, old.id)::text;
    v_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
    v_summary := format('Whiteboard %s: %s', v_action, coalesce(new.board_key, old.board_key, '(no key)'));
  else
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if v_project_id is not null then
    insert into public.project_activity_logs(project_id, actor_id, entity_type, entity_id, action, summary, payload)
    values (v_project_id, v_actor_id, tg_table_name, v_entity_id, v_action, v_summary, coalesce(v_payload, '{}'::jsonb));
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Keep updated_at in sync

drop trigger if exists trg_open_questions_touch on public.open_questions;
create trigger trg_open_questions_touch
before update on public.open_questions
for each row execute function public.touch_updated_at_generic();

drop trigger if exists trg_project_whiteboards_touch on public.project_whiteboards;
create trigger trg_project_whiteboards_touch
before update on public.project_whiteboards
for each row execute function public.touch_updated_at_generic();

-- Auto-create project whiteboard row on project creation
create or replace function public.ensure_project_whiteboard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_whiteboards(project_id, board_key, title, created_by)
  values (new.id, 'wb_' || replace(coalesce(new.project_key, left(new.id::text, 8)), '-', '_'), coalesce(new.title, 'Project Whiteboard'), new.created_by)
  on conflict (project_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_project_whiteboard_seed on public.projects;
create trigger trg_project_whiteboard_seed
after insert on public.projects
for each row execute function public.ensure_project_whiteboard();

-- Activity log triggers

drop trigger if exists trg_project_activity_projects on public.projects;
create trigger trg_project_activity_projects
after insert or update or delete on public.projects
for each row execute function public.append_project_activity_log();

drop trigger if exists trg_project_activity_tickets on public.tickets;
create trigger trg_project_activity_tickets
after insert or update or delete on public.tickets
for each row execute function public.append_project_activity_log();

drop trigger if exists trg_project_activity_project_comments on public.project_comments;
create trigger trg_project_activity_project_comments
after insert or update or delete on public.project_comments
for each row execute function public.append_project_activity_log();

drop trigger if exists trg_project_activity_ticket_comments on public.ticket_comments;
create trigger trg_project_activity_ticket_comments
after insert or update or delete on public.ticket_comments
for each row execute function public.append_project_activity_log();

drop trigger if exists trg_project_activity_open_questions on public.open_questions;
create trigger trg_project_activity_open_questions
after insert or update or delete on public.open_questions
for each row execute function public.append_project_activity_log();

drop trigger if exists trg_project_activity_rollbacks on public.project_rollbacks;
create trigger trg_project_activity_rollbacks
after insert or update or delete on public.project_rollbacks
for each row execute function public.append_project_activity_log();

drop trigger if exists trg_project_activity_whiteboards on public.project_whiteboards;
create trigger trg_project_activity_whiteboards
after insert or update or delete on public.project_whiteboards
for each row execute function public.append_project_activity_log();

-- RLS
alter table public.open_questions enable row level security;
alter table public.project_whiteboards enable row level security;
alter table public.project_rollbacks enable row level security;
alter table public.project_activity_logs enable row level security;

drop policy if exists open_questions_all on public.open_questions;
create policy open_questions_all on public.open_questions for all to authenticated using (true) with check (true);

drop policy if exists project_whiteboards_all on public.project_whiteboards;
create policy project_whiteboards_all on public.project_whiteboards for all to authenticated using (true) with check (true);

drop policy if exists project_rollbacks_all on public.project_rollbacks;
create policy project_rollbacks_all on public.project_rollbacks for all to authenticated using (true) with check (true);

drop policy if exists project_activity_logs_select on public.project_activity_logs;
create policy project_activity_logs_select on public.project_activity_logs for select to authenticated using (true);

revoke insert, update, delete on public.project_activity_logs from authenticated;

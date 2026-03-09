-- Project/Ticket Git integration fields
alter table if exists public.projects
  add column if not exists repo_url text,
  add column if not exists default_branch text;

alter table if exists public.tickets
  add column if not exists working_branch text,
  add column if not exists pr_url text;

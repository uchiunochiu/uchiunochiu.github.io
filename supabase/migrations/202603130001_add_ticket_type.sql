alter table if exists public.tickets
  add column if not exists ticket_type text not null default 'OtherTask';

alter table if exists public.tickets
  drop constraint if exists tickets_ticket_type_check;

alter table if exists public.tickets
  add constraint tickets_ticket_type_check
  check (ticket_type in ('Marketing','Develop','OtherTask'));

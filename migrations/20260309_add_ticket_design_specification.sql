-- Add design/specification fields to tickets
alter table if exists public.tickets
  add column if not exists design text,
  add column if not exists specification text;

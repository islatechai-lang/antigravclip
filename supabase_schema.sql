-- AntigravClip: Supabase Schema for Cloud Database & Storage
-- Run this in your Supabase Dashboard: SQL Editor -> New Query -> Run

-- 1. Create clips table
create table if not exists public.clips (
  id text primary key,
  file text,
  channel text default 'ishowspeed',
  hook_title text not null,
  caption text,
  hashtags text[] default array['#gta6', '#ishowspeed', '#gaming', '#shorts', '#viral', '#fyp'],
  virality_score numeric default 8.0,
  reasoning text,
  duration_seconds numeric default 15.0,
  what_happens text,
  storyboard_url text,
  video_url text,
  status text default 'pending',
  created_at timestamp with time zone default timezone('utc'::text, now()),
  approved_at timestamp with time zone,
  declined_at timestamp with time zone,
  posted_channels text[],
  buffer_post_ids jsonb default '{}'::jsonb
);

-- 2. Enable Row Level Security and allow public access with anon key
alter table public.clips enable row level security;

create policy "Allow public read access"
  on public.clips for select
  using (true);

create policy "Allow public insert access"
  on public.clips for insert
  with check (true);

create policy "Allow public update access"
  on public.clips for update
  using (true);

-- 3. Create Storage bucket 'clips' for public video hosting
insert into storage.buckets (id, name, public) 
values ('clips', 'clips', true)
on conflict (id) do nothing;

create policy "Public Storage Read" 
  on storage.objects for select 
  using ( bucket_id = 'clips' );

create policy "Public Storage Upload" 
  on storage.objects for insert 
  with check ( bucket_id = 'clips' );

create policy "Public Storage Update" 
  on storage.objects for update 
  using ( bucket_id = 'clips' );

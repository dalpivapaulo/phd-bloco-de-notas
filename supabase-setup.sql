create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.app_settings (
  id integer primary key check (id=1),
  project_code_hash text not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings(id,project_code_hash)
values(1,crypt('46201915',gen_salt('bf')))
on conflict(id) do update set project_code_hash=excluded.project_code_hash,updated_at=now();

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(name) between 2 and 60),
  username citext not null unique check(username ~ '^[a-zA-Z0-9._-]{3,30}$'),
  pin_hash text not null,
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.user_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null default(now()+interval '30 days'),
  created_at timestamptz not null default now()
);
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  text text not null check(char_length(text) between 1 and 600),
  due_date date,
  due_time time,
  priority text not null default 'Média' check(priority in('Alta','Média','Baixa')),
  status text not null default 'open' check(status in('open','done')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists reminders_user_idx on public.reminders(user_id);
create index if not exists reminders_due_idx on public.reminders(user_id,due_date,due_time);
create index if not exists sessions_exp_idx on public.user_sessions(expires_at);

alter table public.app_settings enable row level security;
alter table public.app_users enable row level security;
alter table public.user_sessions enable row level security;
alter table public.reminders enable row level security;
revoke all on public.app_settings from anon,authenticated;
revoke all on public.app_users from anon,authenticated;
revoke all on public.user_sessions from anon,authenticated;
revoke all on public.reminders from anon,authenticated;

create or replace function public.validate_project_code(p_code text)
returns boolean language plpgsql security definer set search_path=public as $$
declare h text; begin select project_code_hash into h from public.app_settings where id=1; return h is not null and crypt(coalesce(p_code,''),h)=h; end $$;

create or replace function public.register_user(p_project_code text,p_name text,p_username text,p_pin text)
returns table(success boolean,message text,user_id uuid,session_token uuid)
language plpgsql security definer set search_path=public as $$
declare u uuid; t uuid; begin
 if not public.validate_project_code(p_project_code) then return query select false,'Código do projeto inválido.'::text,null::uuid,null::uuid; return; end if;
 if p_name is null or char_length(trim(p_name))<2 then return query select false,'Informe o nome.'::text,null::uuid,null::uuid; return; end if;
 if p_username is null or p_username !~ '^[a-zA-Z0-9._-]{3,30}$' then return query select false,'Usuário deve ter de 3 a 30 caracteres.'::text,null::uuid,null::uuid; return; end if;
 if p_pin is null or p_pin !~ '^[0-9]{4}$' then return query select false,'O PIN deve ter 4 dígitos.'::text,null::uuid,null::uuid; return; end if;
 begin insert into public.app_users(name,username,pin_hash) values(trim(p_name),lower(trim(p_username)),crypt(p_pin,gen_salt('bf'))) returning id into u;
 exception when unique_violation then return query select false,'Este usuário já existe.'::text,null::uuid,null::uuid; return; end;
 insert into public.user_sessions(user_id) values(u) returning token into t;
 return query select true,'Usuário criado.'::text,u,t;
end $$;

create or replace function public.login_user(p_username text,p_pin text)
returns table(success boolean,message text,user_id uuid,session_token uuid)
language plpgsql security definer set search_path=public as $$
declare u public.app_users%rowtype; t uuid; begin
 select * into u from public.app_users where username=lower(trim(p_username)) limit 1;
 if u.id is null or not u.active then return query select false,'Usuário ou PIN inválido.'::text,null::uuid,null::uuid; return; end if;
 if u.locked_until is not null and u.locked_until>now() then return query select false,'Acesso temporariamente bloqueado.'::text,null::uuid,null::uuid; return; end if;
 if crypt(coalesce(p_pin,''),u.pin_hash)<>u.pin_hash then
   update public.app_users set failed_attempts=case when failed_attempts+1>=5 then 0 else failed_attempts+1 end,locked_until=case when failed_attempts+1>=5 then now()+interval '30 seconds' else null end where id=u.id;
   return query select false,'Usuário ou PIN inválido.'::text,null::uuid,null::uuid; return;
 end if;
 update public.app_users set failed_attempts=0,locked_until=null where id=u.id;
 delete from public.user_sessions where expires_at<now();
 insert into public.user_sessions(user_id) values(u.id) returning token into t;
 return query select true,'Login realizado.'::text,u.id,t;
end $$;

create or replace function public.current_profile(p_token uuid)
returns table(id uuid,name text,username text)
language sql security definer set search_path=public as $$
 select u.id,u.name,u.username::text from public.user_sessions s join public.app_users u on u.id=s.user_id where s.token=p_token and s.expires_at>now() and u.active limit 1 $$;

create or replace function public.list_reminders(p_token uuid)
returns table(id uuid,text text,due_date date,due_time time,priority text,status text,created_at timestamptz,completed_at timestamptz)
language sql security definer set search_path=public as $$
 select r.id,r.text,r.due_date,r.due_time,r.priority,r.status,r.created_at,r.completed_at from public.reminders r join public.user_sessions s on s.user_id=r.user_id join public.app_users u on u.id=r.user_id where s.token=p_token and s.expires_at>now() and u.active order by r.status,r.due_date nulls last,r.due_time nulls last,r.created_at desc $$;

create or replace function public.save_reminder(p_token uuid,p_id uuid,p_text text,p_due_date date,p_due_time time,p_priority text)
returns uuid language plpgsql security definer set search_path=public as $$
declare u uuid; rid uuid; begin
 select s.user_id into u from public.user_sessions s join public.app_users a on a.id=s.user_id where s.token=p_token and s.expires_at>now() and a.active limit 1;
 if u is null then raise exception 'Sessão inválida.'; end if;
 if p_text is null or char_length(trim(p_text))<1 or char_length(trim(p_text))>600 then raise exception 'Texto inválido.'; end if;
 if p_priority not in('Alta','Média','Baixa') then raise exception 'Prioridade inválida.'; end if;
 if p_id is null then insert into public.reminders(user_id,text,due_date,due_time,priority) values(u,trim(p_text),p_due_date,p_due_time,p_priority) returning id into rid;
 else update public.reminders set text=trim(p_text),due_date=p_due_date,due_time=p_due_time,priority=p_priority where id=p_id and user_id=u returning id into rid; if rid is null then raise exception 'Lembrete não encontrado.'; end if; end if;
 return rid;
end $$;

create or replace function public.toggle_reminder(p_token uuid,p_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare u uuid; st text; begin
 select s.user_id into u from public.user_sessions s join public.app_users a on a.id=s.user_id where s.token=p_token and s.expires_at>now() and a.active limit 1; if u is null then raise exception 'Sessão inválida.'; end if;
 select status into st from public.reminders where id=p_id and user_id=u; if st is null then raise exception 'Lembrete não encontrado.'; end if;
 update public.reminders set status=case when st='done' then 'open' else 'done' end,completed_at=case when st='done' then null else now() end where id=p_id and user_id=u; return true;
end $$;

create or replace function public.delete_reminder(p_token uuid,p_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare u uuid; begin select s.user_id into u from public.user_sessions s join public.app_users a on a.id=s.user_id where s.token=p_token and s.expires_at>now() and a.active limit 1; if u is null then raise exception 'Sessão inválida.'; end if; delete from public.reminders where id=p_id and user_id=u; return found; end $$;

create or replace function public.logout_user(p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$ begin delete from public.user_sessions where token=p_token; return true; end $$;

revoke all on function public.validate_project_code(text) from public;
revoke all on function public.register_user(text,text,text,text) from public;
revoke all on function public.login_user(text,text) from public;
revoke all on function public.current_profile(uuid) from public;
revoke all on function public.list_reminders(uuid) from public;
revoke all on function public.save_reminder(uuid,uuid,text,date,time,text) from public;
revoke all on function public.toggle_reminder(uuid,uuid) from public;
revoke all on function public.delete_reminder(uuid,uuid) from public;
revoke all on function public.logout_user(uuid) from public;
grant execute on function public.validate_project_code(text) to anon,authenticated;
grant execute on function public.register_user(text,text,text,text) to anon,authenticated;
grant execute on function public.login_user(text,text) to anon,authenticated;
grant execute on function public.current_profile(uuid) to anon,authenticated;
grant execute on function public.list_reminders(uuid) to anon,authenticated;
grant execute on function public.save_reminder(uuid,uuid,text,date,time,text) to anon,authenticated;
grant execute on function public.toggle_reminder(uuid,uuid) to anon,authenticated;
grant execute on function public.delete_reminder(uuid,uuid) to anon,authenticated;
grant execute on function public.logout_user(uuid) to anon,authenticated;

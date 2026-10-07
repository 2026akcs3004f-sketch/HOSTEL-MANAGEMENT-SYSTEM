-- Additive student self-service flow. Existing student records default to approved.
alter table public.students
  add column if not exists verification_status text not null default 'approved';

alter table public.payments
  add column if not exists payment_reference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.students'::regclass
      and conname = 'students_verification_status_check'
  ) then
    alter table public.students
      add constraint students_verification_status_check
      check (verification_status in ('pending', 'approved', 'rejected'));
  end if;
end;
$$;

create or replace function public.register_student(
  p_reg text,
  p_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_admin_count integer;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first';
  end if;
  if coalesce(trim(p_reg), '') = '' or coalesce(trim(p_name), '') = ''
     or coalesce(trim(p_phone), '') = '' then
    raise exception 'Name, registration number, and phone are required';
  end if;

  select role into v_role from public.user_profiles where user_id = auth.uid();
  if v_role = 'admin' then
    raise exception 'Admin accounts cannot register as students';
  end if;

  select count(*) into v_admin_count
  from public.user_profiles where role = 'admin';
  if v_admin_count <> 1 then
    raise exception 'This registration flow needs exactly one hostel admin account';
  end if;
  select user_id into v_owner from public.user_profiles where role = 'admin';

  if exists (select 1 from public.students where auth_user_id = auth.uid()) then
    raise exception 'You have already submitted a student registration';
  end if;

  insert into public.students
    (user_id, auth_user_id, reg, name, phone, verification_status)
  values
    (v_owner, auth.uid(), trim(p_reg), trim(p_name), trim(p_phone), 'pending');

  update public.user_profiles
  set owner_user_id = v_owner, student_reg = null
  where user_id = auth.uid();
  if not found then
    insert into public.user_profiles (user_id, role, owner_user_id)
    values (auth.uid(), 'student', v_owner);
  end if;
exception
  when unique_violation then
    raise exception 'That registration number is already in use';
end;
$$;

create or replace function public.review_student_registration(
  p_student_reg text,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students%rowtype;
begin
  if not public.current_user_is_admin() then
    raise exception 'Only an admin can review student registrations';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;

  select * into v_student
  from public.students
  where user_id = auth.uid() and reg = p_student_reg
  for update;
  if not found then
    raise exception 'Student registration not found';
  end if;
  if v_student.verification_status <> 'pending' then
    raise exception 'Student registration has already been reviewed';
  end if;

  update public.students
  set verification_status = p_decision
  where user_id = auth.uid() and reg = p_student_reg;

  if p_decision = 'approved' then
    update public.user_profiles
    set owner_user_id = auth.uid(), student_reg = p_student_reg
    where user_id = v_student.auth_user_id;
  end if;
end;
$$;

-- Only approved students resolve to an owner/registration for the room RPCs.
create or replace function public.current_student_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.user_id
  from public.students s
  where s.auth_user_id = auth.uid()
    and s.verification_status = 'approved'
  limit 1;
$$;

create or replace function public.current_student_reg()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.reg
  from public.students s
  where s.auth_user_id = auth.uid()
    and s.verification_status = 'approved'
  limit 1;
$$;

create or replace function public.submit_student_payment(
  p_amount numeric,
  p_method text,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := public.current_student_owner_id();
  v_reg text := public.current_student_reg();
begin
  if v_owner is null or v_reg is null then
    raise exception 'Your student registration must be approved before submitting payment';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_method not in ('Cash', 'M-Pesa', 'Bank', 'Card') then
    raise exception 'Choose a valid payment method';
  end if;

  insert into public.payments
    (user_id, student_reg, amount, method, status, payment_reference)
  values
    (v_owner, v_reg, p_amount, p_method, 'Pending', nullif(trim(p_reference), ''));
end;
$$;

revoke all on function public.register_student(text, text, text) from public, anon;
revoke all on function public.review_student_registration(text, text) from public, anon;
revoke all on function public.submit_student_payment(numeric, text, text) from public, anon;
grant execute on function public.register_student(text, text, text) to authenticated;
grant execute on function public.review_student_registration(text, text) to authenticated;
grant execute on function public.submit_student_payment(numeric, text, text) to authenticated;

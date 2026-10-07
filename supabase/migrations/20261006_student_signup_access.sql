-- Complete the student self-signup schema used by the React signup page.
-- Safe to run after 20261004_student_self_service.sql.

alter table public.students
  add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists students_auth_user_id_unique
  on public.students (auth_user_id)
  where auth_user_id is not null;

-- Students are stored under the hostel admin's user_id, so give each student
-- read access to only their own linked registration row.
drop policy if exists "Students read their own registration" on public.students;
create policy "Students read their own registration" on public.students
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

-- Allow students to see their own allocation and payment records for the board.
drop policy if exists "Students read their own allocations" on public.allocations;
create policy "Students read their own allocations" on public.allocations
  for select to authenticated
  using (
    student_reg = public.current_student_reg()
    and user_id = public.current_student_owner_id()
  );

drop policy if exists "Students read their own payments" on public.payments;
create policy "Students read their own payments" on public.payments
  for select to authenticated
  using (
    student_reg = public.current_student_reg()
    and user_id = public.current_student_owner_id()
  );

grant select on public.students, public.allocations, public.payments to authenticated;

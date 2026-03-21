create table if not exists profiles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  avatar     text not null,
  avatar_bg  text not null,
  created_at timestamptz default now()
);
create table if not exists meals (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references profiles(id) on delete cascade,
  name         text not null,
  calories     int  not null default 0,
  protein      int  not null default 0,
  carbs        int  not null default 0,
  fat          int  not null default 0,
  source       text, confidence text, notes text, serving_size text, image_url text,
  meal_date    date not null default current_date,
  logged_at    timestamptz default now()
);
create index if not exists meals_profile_date on meals(profile_id, meal_date);

# Supabase Quickstart (Dashboard)

## 1) DB作成
Supabase SQL Editorで以下を実行:
- `../dashboard_supabase_setup.sql`（workspace root）

## 2) 初期データ
最低限、`profiles` に少佐(owner)とタチコマ(agent)を入れる。

```sql
insert into public.profiles (id, display_name, role, is_tachikoma)
values
  ('00000000-0000-0000-0000-0000000000aa', '少佐', 'owner', false),
  ('00000000-0000-0000-0000-0000000000bb', 'タチコマ', 'agent', true)
on conflict (id) do nothing;
```

## 3) Realtime有効化
Supabase Dashboard → Database → Replication
- `project_comments`
- `ticket_comments`
をON。

## 4) Edge Function
```bash
cd dashboard/supabase
supabase functions deploy on-comment-created
supabase secrets set OPENCLAW_NOTIFY_URL="https://<YOUR_NOTIFY_ENDPOINT>"
supabase secrets set OPENCLAW_NOTIFY_TOKEN="<OPTIONAL_TOKEN>"
```

## 5) フロント設定
ブラウザ console で一度だけ設定:
```js
localStorage.setItem('SB_URL', 'https://<project-ref>.supabase.co')
localStorage.setItem('SB_ANON_KEY', '<anon-key>')
localStorage.setItem('SB_PROJECT_ID', '<project-ref>')
```

## 6) HTML内のID置換
- `project-detail.html`
  - `PROJECT_ID`
  - `MAJOR_USER_ID`
- `ticket-detail.html`
  - `PROJECT_ID`
  - `TICKET_ID`
  - `MAJOR_USER_ID`

## 7) 完了制約テスト
- owner以外で `status='done'` 更新 → 失敗
- ownerで `status='done'` 更新 → 成功

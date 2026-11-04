# Provisionamento do SuperAdmin da plataforma (manual)

O privilégio global vem apenas de `app_metadata.platform_role = "superadmin"` (nunca de `user_metadata`).
O servidor consulta o Auth a cada requisição; revogar vale na próxima chamada. Não existe tela nem endpoint de promoção.

1. Crie a conta em `/login` (Cadastre-se).
2. Confirme o e-mail pelo link recebido.
3. No SQL Editor administrativo do Lovable Cloud, confirme a conta (deve retornar exatamente 1 linha com `email_confirmed_at` preenchido):
   ```sql
   SELECT id, email, email_confirmed_at, raw_app_meta_data
   FROM auth.users WHERE lower(email) = lower('EMAIL_DO_ADMIN');
   ```
4. Atribua o privilégio (preserva os demais metadados):
   ```sql
   UPDATE auth.users
   SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
     || jsonb_build_object('platform_role', 'superadmin')
   WHERE id = 'UUID_CONFIRMADO' AND email_confirmed_at IS NOT NULL;
   ```
   Deve afetar 1 linha.
5. Verifique:
   ```sql
   SELECT id, email, raw_app_meta_data->>'platform_role' AS platform_role
   FROM auth.users WHERE id = 'UUID_CONFIRMADO';
   ```
6. Saia e entre novamente em `/login`, depois acesse `/superadmin`.
7. Revogação (remove só a chave):
   ```sql
   UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'platform_role'
   WHERE id = 'UUID_CONFIRMADO';
   ```

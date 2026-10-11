# Provisionamento do primeiro operador (manual, controlado)

Não existe endpoint de cadastro nem de autoatribuição. Nunca coloque chaves privilegiadas em código, repositório ou logs.

1. No painel de usuários do backend (Lovable Cloud → Users), crie o usuário com e-mail e senha.
   Confirme que o login por e-mail/senha está habilitado nas configurações de autenticação.
2. Copie o `user_id` real exibido para esse usuário.
3. Obtenha o `venue_id` real do estabelecimento (consulta administrativa em `public.venues`).
4. Por um canal administrativo confiável (editor SQL do backend), crie o vínculo:
   `INSERT INTO public.venue_operators (venue_id, user_id, role) VALUES ('<venue_id>', '<user_id>', 'owner');`
5. Confirme: `SELECT venue_id, user_id, role FROM public.venue_operators WHERE user_id = '<user_id>';`
6. Entre em `/login` com o usuário e teste uma operação do Campeonato do próprio estabelecimento.

Revogação: `DELETE FROM public.venue_operators WHERE venue_id = '<venue_id>' AND user_id = '<user_id>';` — o acesso cai na próxima requisição.

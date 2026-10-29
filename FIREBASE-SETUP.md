# Vale do Corvo — Firebase Realtime Database

A autenticação usa Firebase Authentication (e-mail/senha) e os dados do jogo usam o **Realtime Database** em `https://vale-do-corvo-default-rtdb.firebaseio.com`. Esta integração ainda está em preparação: mantenha o acesso de jogadores bloqueado até testar as regras e remover do JavaScript público a geometria e quaisquer segredos da campanha.

## O que a branch contém

- Configuração do Firebase Web SDK apontada ao Realtime Database.
- Cadastro e login por e-mail/senha.
- Perfis em `users/{uid}` e personagens em `players/{uid}`.
- Sincronização inicial do estado do mestre em `sessions/main`.
- Persistência de exploração em `exploration/{uid}` e tesouros em `treasures/{id}`.
- Regras de Realtime Database em `database.rules.json`. O arquivo antigo `firestore.rules` não protege o Realtime Database.

## Antes de publicar ou testar com dados reais

1. No Firebase Console, abra **Realtime Database → Rules**.
2. Abra `database.rules.json` nesta branch e substitua todas as ocorrências de `REPLACE_WITH_MASTER_UID` pelo UID da conta do mestre. Não use e-mail nem senha nesse campo.
3. Revise as regras e publique-as em **Realtime Database → Rules**. Enquanto o UID não for substituído, as operações de mestre serão negadas; não troque por regras abertas.
4. Em **Authentication → Users**, confirme que a conta do mestre existe. Em **Realtime Database → Data**, crie/ajuste `users/{UID_DO_MESTRE}` com `role: "master"`, `displayName` e, se desejar, `createdAt`.
5. Teste com duas contas: mestre e jogador. Confirme que o jogador não consegue ler `sessions` nem `treasures`, e que só consegue ler/escrever seu próprio perfil/personagem e exploração.
6. Não libere jogadores ainda. A geometria da cripta e outras informações do mapa continuam no código público do site; regras de banco não escondem dados já publicados no HTML/JavaScript.
7. O histórico do Git pode conter versões antigas de dados secretos. Considere pistas/segredos já publicados comprometidos e não reutilize senhas ou chaves privadas que tenham sido expostas.

## Limitações conhecidas

- A sincronização inicial precisa ser testada no navegador com as regras reais.
- A visão filtrada por personagem, a publicação de tokens visíveis e a proteção da geometria do mapa não estão completas.
- Não há migração automática dos dados antigos do Firestore/HTML para o Realtime Database.
- O GitHub Pages hospeda apenas arquivos estáticos; não pode guardar segredos administrativos. Nunca coloque uma chave de conta de serviço no repositório.

## Estrutura esperada no Realtime Database

```text
users/{uid}
players/{uid}
sessions/main
exploration/{uid}
treasures/{treasureId}
```

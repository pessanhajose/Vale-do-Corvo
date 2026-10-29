# Vale do Corvo — Firebase Realtime Database

A autenticação usa Firebase Authentication (e-mail/senha) e os dados usam o **Realtime Database** em `https://vale-do-corvo-default-rtdb.firebaseio.com`.

**Status: integração ainda NÃO pronta para liberar jogadores.** O login do mestre e a sincronização inicial do estado do mestre estão implementados, mas a visão filtrada por personagem e a proteção da geometria do mapa ainda não estão concluídas. Não publique regras novas nem faça merge até resolver os bloqueios abaixo.

## O que a branch contém

- Configuração do Firebase Web SDK apontada ao Realtime Database.
- Cadastro e login por e-mail/senha.
- Perfis em `users/{uid}` e personagens em `players/{uid}`.
- Sincronização do estado do mestre em `sessions/main`.
- Persistência inicial de exploração em `exploration/{uid}` e tesouros em `treasures/{id}`.
- Regras de Realtime Database em `database.rules.json`. Regras do Cloud Firestore não protegem esse banco.

## Bloqueios antes de publicar ou testar com jogadores

1. **Não publique ainda o arquivo de regras**: a revisão do código encontrou partes da experiência do jogador que ainda não consomem os caminhos `visibleTokens/{uid}` e `discoveries/{uid}`.
2. O jogador ainda é mantido na tela de bloqueio em `firebase-auth.js`. Isso é intencional até que a visão filtrada esteja concluída.
3. A sincronização atual não calcula nem publica automaticamente, por personagem, os tokens visíveis; o mestre lê a lista de jogadores, mas o fluxo de visão individual ainda não está completo.
4. A névoa salva em `exploration/{uid}` precisa ser validada como exploração individual persistente e não deve permitir que o estado global de um personagem seja usado como fonte para outros.
5. A geometria do mapa e a lógica de renderização continuam em `index.html`, que é público no GitHub Pages. Regras do banco não escondem dados já entregues ao navegador. Se a geometria precisa ser secreta, ela não pode permanecer no JavaScript público; será necessário mover os dados secretos para um backend protegido ou redesenhar o modelo para não depender de segredo no cliente.
6. Ainda é necessário testar com duas contas reais e confirmar permissões de leitura/escrita. O simulador de regras sozinho não valida o fluxo completo do site.

## Preparação da conta do mestre

O UID do mestre está definido nas regras desta branch. O perfil `users/{UID_DO_MESTRE}` precisa existir com `role: "master"`. A promoção inicial deve ser feita com cuidado no banco depois que as regras corretas forem aprovadas; não crie regras abertas temporárias para fazer isso.

Não coloque senhas, chaves privadas ou credenciais administrativas no repositório. A configuração Web do Firebase é pública por natureza; a proteção depende das regras e da arquitetura.

## Estrutura usada

```text
users/{uid}
players/{uid}
sessions/main
exploration/{uid}
visibleTokens/{uid}
discoveries/{uid}
treasures/{treasureId}
gmNotes/{noteId}
```

## Critérios para considerar pronta

- O mestre consegue carregar/salvar sessão e administrar personagens.
- Cada jogador só pode alterar seu próprio personagem e vê apenas os tokens que o mestre autorizou para ele.
- A exploração é individual, persiste entre sessões e não revela áreas de outros personagens.
- Tesouros/notas secretos só são lidos pela conta do mestre; o jogador recebe apenas descobertas explicitamente liberadas.
- Regras são testadas com o simulador e com duas contas reais.
- Não há segredos da campanha que precisem ser privados embutidos em HTML/JavaScript público.

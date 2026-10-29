# Vale do Corvo — Firebase Realtime Database

## Status de segurança

**Os jogadores continuam bloqueados intencionalmente. Não faça merge desta branch nem publique regras novas como se a visão individual estivesse pronta.** O login do mestre e a sincronização inicial existem, mas ainda falta concluir e testar o fluxo completo de visão individual.

A configuração Web do Firebase (incluindo o `apiKey`) é pública por natureza. A segurança depende das regras do Realtime Database e de não entregar dados secretos ao navegador.

## O que já existe nesta branch

- Login e cadastro com Firebase Authentication (e-mail/senha).
- Perfis em `users/{uid}` e personagens em `players/{uid}`.
- Estado da sessão do mestre em `sessions/main`.
- Persistência inicial em `exploration/{uid}` e `treasures/{id}`.
- Arquivo de regras proposto em `database.rules.json` — **rascunho para revisão, não uma configuração aprovada para produção**.

## Por que ainda não podemos liberar jogadores

1. A interface do jogador ainda é bloqueada por `firebase-auth.js`, de propósito.
2. O cliente ainda desenha a geometria do mapa e a planta da cripta a partir de código em `index.html`. Qualquer visitante pode baixar esse JavaScript. Uma névoa desenhada no canvas ou botões escondidos com CSS não protegem a geometria.
3. `visibleTokens/{uid}` e `discoveries/{uid}` estão previstos nas regras, mas o fluxo da aplicação ainda não os usa integralmente.
4. A névoa de guerra precisa ser aplicada e persistida por personagem; não se deve reutilizar a névoa global do mestre como se fosse a exploração privada de cada jogador.
5. O cliente não pode ler `sessions/main`, tesouros secretos ou notas do mestre. Ele deve receber apenas os dados que pode ver.
6. As regras precisam ser testadas com duas contas reais e tentativas diretas de leitura e escrita, não apenas pela aparência da interface.

## Próxima arquitetura necessária

- **Mestre:** lê e altera a sessão completa, tokens, tesouros e notas.
- **Jogador:** lê o próprio perfil/personagem e documentos filtrados explicitamente publicados para seu UID.
- **Exploração:** um registro por UID, sem usar a exploração de outro jogador como fonte.
- **Descobertas:** dados publicados pelo mestre para um UID específico; o jogador não pode publicar descobertas para si próprio.
- **Mapa:** decidir quais partes da geometria são públicas. Se a planta completa da cripta for segredo, ela não pode ficar no JavaScript estático do GitHub Pages; será necessário um backend autenticado que só entregue a informação permitida. Regras do banco não escondem código que já foi entregue pelo site.
- **Regras:** negar por padrão, conceder somente os caminhos necessários e validar formato/valores das gravações.

## Passo a passo seguro no Firebase Console

### 1. Faça um backup antes de mudar qualquer coisa

1. Abra o [Firebase Console](https://console.firebase.google.com/).
2. Selecione o projeto **vale-do-corvo**.
3. Entre em **Realtime Database** e confirme que a URL é `https://vale-do-corvo-default-rtdb.firebaseio.com`.
4. Na aba **Dados**, use a opção de exportar JSON, se disponível na interface, e guarde o arquivo localmente.
5. Na aba **Regras**, copie as regras atualmente publicadas e guarde-as separadamente. Não as substitua ainda.

### 2. Confira a autenticação

1. No menu lateral, abra **Authentication** → **Sign-in method**.
2. Confirme que **E-mail/senha** está habilitado.
3. Em **Users**, confira se as contas esperadas existem.
4. Não compartilhe senhas nem publique dados de autenticação no GitHub.

### 3. Confira os UIDs

1. Em **Authentication** → **Users**, abra a conta do mestre e copie o UID.
2. Confirme que ele corresponde ao UID configurado no código e no rascunho de regras desta branch.
3. Faça o mesmo para a conta de teste de jogador.
4. Se os UIDs forem diferentes, **não publique as regras sem corrigir e revisar o arquivo primeiro**.

### 4. Não abra o banco temporariamente

Não use `.read: true` ou `.write: true` para fazer o site funcionar. Isso pode expor a sessão, os personagens e os segredos. As regras publicadas no Realtime Database são aplicadas no servidor e não são substituídas por esconder elementos da interface.

### 5. Teste as regras antes de publicar

Quando o arquivo de regras tiver sido revisado para corresponder ao fluxo final:

1. Abra **Realtime Database** → **Regras**.
2. Use o **simulador de regras**, quando disponível, para testar leituras e gravações autenticadas e não autenticadas.
3. Confirme que o jogador não consegue ler `sessions/main`, `treasures`, `gmNotes` nem o perfil de outro jogador.
4. Confirme que o jogador só consegue escrever nos próprios campos autorizados e não consegue alterar seu papel para `master`.
5. Só publique depois de todos os testes passarem e de a aplicação estar usando os caminhos protegidos corretamente.

**Importante:** neste momento, não publique o arquivo `database.rules.json` desta branch como solução final. O código de visão individual ainda não está completo, e a regra precisa ser validada contra os dados reais e as operações usadas pela aplicação.

## Teste local antes do GitHub Pages

1. Abra a branch `firebase-integracao` no VS Code.
2. Execute o site localmente com uma extensão como Live Server.
3. Use uma janela normal para o mestre e uma janela anônima ou outro navegador para o jogador.
4. Teste login, logout, salvamento, atualização da página e acesso negado aos caminhos privados.
5. Não remova o bloqueio do jogador até que a visão filtrada e as regras estejam prontas.

## Critérios para considerar pronta

- O mestre carrega e salva a sessão completa.
- Cada jogador recebe somente os tokens e descobertas autorizados para seu UID.
- A exploração é individual e persiste entre sessões.
- Tesouros secretos e notas do mestre não são lidos pelo jogador.
- Tentativas diretas de ler ou alterar dados de outros usuários são negadas pelas regras.
- A geometria que precisa ser secreta não é enviada ao cliente público.
- O fluxo foi testado com duas contas reais antes do merge.

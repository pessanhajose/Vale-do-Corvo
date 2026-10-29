# Vale-do-Corvo — integração Firebase em desenvolvimento

Esta branch contém a primeira integração de autenticação, sincronização do estado do mestre e regras de acesso do Firestore. **Ainda não é uma versão pronta para jogadores nem deve ser publicada como versão definitiva.**

## O que foi implementado nesta etapa

- Cadastro/login com Firebase Authentication (e-mail e senha).
- Seleção de personagem no cadastro.
- Documento `players/{uid}` para salvar personagem, mapa e posição.
- Sincronização em tempo real do estado do mapa para contas com papel `master`.
- Persistência inicial da névoa por conta autenticada.
- Tesouros carregados da coleção protegida `treasures`; não há lista de tesouros embutida no HTML público.
- Regras do Firestore que limitam sessões, tesouros e notas do mestre ao papel `master`.
- Respostas de enigmas e o cartão público do altar foram removidos do HTML desta branch.

## O que ainda não está concluído

1. A geometria completa da cripta e partes do mapa ainda são definidas no JavaScript público. Um usuário técnico pode inspecionar o código-fonte. O acesso de jogador permanece bloqueado até essa geometria ser fornecida de forma filtrada/segura.
2. A publicação de tokens visíveis por personagem (`visibleTokens/{uid}`) e descobertas (`discoveries/{uid}`) ainda precisa ser ligada à lógica de visão de cada jogador.
3. A visão atual usa um raio circular; linha de visão bloqueada por paredes ainda precisa ser implementada.
4. As notas antigas do mestre e os tesouros iniciais não foram migrados automaticamente para o Firestore. Eles continuam na branch original `main`; recrie-os apenas em coleções privadas do Firestore, nunca no HTML público.
5. O histórico Git e a branch `main` ainda podem conter versões antigas com os segredos. Não trate segredos de campanha como confidenciais até revisar o que já foi publicado e o histórico do repositório.
6. As regras precisam ser testadas com o Firebase Emulator Suite ou contas separadas antes de liberar jogadores.

## Passo manual no Firebase (faça depois de revisar a branch)

### A. Ativar autenticação
1. Abra o [Firebase Console](https://console.firebase.google.com/) e selecione o projeto `vale-do-corvo`.
2. Vá em **Authentication → Sign-in method** e habilite **E-mail/senha**.
3. Em **Authentication → Settings → Authorized domains**, confirme que o domínio do GitHub Pages usado pelo site está autorizado.

### B. Publicar as regras
1. Abra **Firestore Database → Rules**.
2. Copie o conteúdo completo de `firestore.rules` desta branch.
3. Cole no editor e clique em **Publish**.
4. Não substitua essas regras por regras abertas como `allow read, write: if true`.

### C. Criar a conta do mestre
1. Em **Authentication → Users**, crie um usuário com o seu e-mail e uma senha forte, ou crie a conta pelo formulário quando a branch estiver disponível para teste.
2. Copie o **UID** dessa conta.
3. Abra **Firestore Database → Data** e crie a coleção `users`, se ainda não existir.
4. Crie um documento cujo ID seja exatamente o UID e adicione:
   - `role`: string `master`
   - `displayName`: string com o nome de exibição
   - `createdAt`: timestamp (ou omita se criar o documento manualmente).
5. Não permita que jogadores editem o campo `role`. O cadastro do site só cria contas com papel `player`.

### D. Antes de liberar jogadores
- Teste login do mestre e login de jogador com contas distintas.
- Confirme que um jogador não consegue ler `sessions`, `treasures` ou `gmNotes`.
- Confirme que cada jogador só lê o próprio documento em `players`, `exploration`, `visibleTokens` e `discoveries`.
- Não mude o GitHub Pages para publicar esta branch para os jogadores até remover a geometria secreta do JavaScript público e concluir a filtragem de visão.

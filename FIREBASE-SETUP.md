# Vale do Corvo — Firebase: modo compartilhado simples

## O que foi preparado nesta branch

Esta versão usa uma configuração simples para uma campanha em que os jogadores são confiáveis e podem ver o mapa e os dados enviados ao navegador:

- O mestre continua sendo o único que pode gravar a sessão completa em `sessions/main`.
- Todas as contas autenticadas podem ler a sessão para receber o mapa atualizado.
- O jogador entra na página e o site tenta colocá-lo automaticamente no modo de jogador.
- Cada jogador lê e atualiza o próprio documento em `players/{uid}`.
- O mestre continua sendo o único que pode gravar tesouros.
- Tesouros passam a poder ser lidos por usuários autenticados. Isso é intencional nesta versão simples; não use dados que precisem continuar secretos dentro de `treasures`.
- `gmNotes` continua restrito à conta do mestre.
- A planta e a lógica do mapa ficam no código público do GitHub Pages. Como você disse que confia nos jogadores, esta versão prioriza simplicidade, não sigilo da geometria.

**Importante:** as alterações estão na branch `firebase-integracao`. Não foram publicadas no Firebase Console e não foram mescladas à branch principal. O login/sincronização precisam ser testados com suas contas reais antes de usar com a campanha.

## Passo a passo no Firebase Console

### 1. Faça backup

1. Abra https://console.firebase.google.com/.
2. Selecione o projeto `vale-do-corvo`.
3. Abra **Realtime Database → Dados** e exporte/guarde uma cópia JSON dos dados atuais.
4. Abra **Realtime Database → Regras** e copie as regras atuais para um arquivo local. Assim você pode restaurá-las se necessário.

### 2. Confira a conta do mestre

1. Abra **Authentication → Users**.
2. Encontre a conta do mestre e copie o UID.
3. O arquivo `database.rules.json` desta branch identifica o mestre pelo UID `cPr3vPhG5XPS6ifk5NixuAjNui82`.
4. Se o UID no Console for diferente, não publique as regras antes de corrigir o arquivo.

### 3. Confirme o perfil do mestre no banco

Em **Realtime Database → Dados**, confirme que existe:

```json
users/cPr3vPhG5XPS6ifk5NixuAjNui82
{
  "role": "master",
  "displayName": "Mestre"
}
```

Não substitua os outros campos do perfil sem necessidade. Se o registro não existir, primeiro faça backup e depois crie esse nó com o UID correto e o papel `master`.

### 4. Publique as regras propostas

1. Abra **Realtime Database → Regras**.
2. Abra o arquivo [database.rules.json desta branch](https://github.com/pessanhajose/Vale-do-Corvo/blob/firebase-integracao/database.rules.json).
3. Copie o JSON inteiro para o editor de regras do Realtime Database.
4. Confirme que o UID do mestre corresponde ao UID visto em Authentication.
5. Clique em **Publicar**.

Essas regras permitem leitura da sessão e dos tesouros para qualquer usuário autenticado, mas só a conta mestre pode gravar a sessão e os tesouros. Os jogadores podem ler/escrever o próprio documento de personagem, sujeito às validações das regras.

Se o editor indicar erro, **não tente contornar usando `.read: true` ou `.write: true`**. Restaure as regras copiadas no backup e me envie a mensagem de erro.

### 5. Teste antes de liberar o link

1. Abra o site da branch `firebase-integracao` ou execute localmente com Live Server.
2. Entre como mestre em uma janela normal.
3. Entre como jogador em uma janela anônima ou em outro navegador.
4. Como mestre, mova um personagem ou altere a névoa e confira se a tela do jogador atualiza.
5. Como jogador, mova seu personagem e confira se o mestre recebe a posição.
6. Atualize as duas páginas e confirme que o estado persiste.
7. Teste sair e entrar novamente.

Se algo falhar, não faça merge para a branch principal ainda. Anote a mensagem exibida na página e no Console do navegador (F12).

## Limitações assumidas nesta versão simples

- O jogador pode inspecionar o código público e os dados que o navegador recebe; você disse que isso é aceitável para seu grupo.
- A névoa da cripta é compartilhada, não uma exploração individual por personagem.
- Os dados de tesouros são enviados a todos os usuários autenticados, mesmo quando a interface não os mostra.
- O modo de jogador esconde ferramentas da interface, mas não é uma barreira de segurança contra alguém que tente manipular o navegador.
- Não há garantia de que o fluxo esteja correto até que você faça os testes acima com duas contas reais.

Se futuramente quiser que cada jogador veja somente descobertas individuais, precisaremos trocar a sincronização compartilhada por dados separados por UID.

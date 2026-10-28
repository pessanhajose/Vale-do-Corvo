# Vale-do-Corvo — integração Firebase (em etapas)

Esta branch é uma preparação de autenticação e regras de acesso. Ela ainda **não** é a versão final de multiplayer e não deve ser publicada como versão pronta para jogadores.

## Arquivos
- `firebase-config.js`: configuração pública do app Firebase.
- `firebase-auth.js`: cadastro/login por e-mail e senha e verificação do papel.
- `firestore.rules`: regras iniciais para perfis, personagens, exploração e tesouros.

## Preparação no Firebase
1. Em Authentication → Sign-in method, habilite E-mail/senha.
2. Em Authentication → Settings → Authorized domains, inclua o domínio do GitHub Pages que hospeda o site.
3. Publique `firestore.rules` em Firestore Database → Rules.
4. Crie uma conta de mestre pelo formulário do site.
5. Em Firestore Database → Data, localize `users/{UID_DA_CONTA}` e altere o campo `role` de `player` para `master`. Faça isso manualmente no Console Firebase; não existe botão de autoelevação no site.

## Aviso de segurança obrigatório
O HTML antigo contém notas de mestre e dados de tesouros diretamente no JavaScript público. Ocultar elementos com CSS ou exigir login no navegador **não** protege esses dados, porque o código-fonte do GitHub Pages é público. Antes de liberar contas de jogadores, é necessário migrar esses dados secretos para a coleção `treasures` (acesso apenas ao mestre) e retirar as cópias do HTML/JavaScript público. Também falta ligar os movimentos dos tokens e o mapa de exploração às coleções em tempo real; esta branch não afirma que essa parte esteja concluída.

## Regras e testes
As regras deste repositório são uma base inicial. Revise-as no Firebase Emulator Suite antes de usar com jogadores. A segurança final deve ser testada com contas separadas de mestre e jogador.

# Caca-Talentos Prof. Jony

Aplicativo web do Projeto Caca-Talentos, feito para uma competicao de apresentacoes em sala:

- aluno, professor ou convidados entram sem login, apenas com nick e avatar;
- professor cria uma sala com codigo;
- apenas professores podem criar sala;
- salas novas recebem codigo aleatorio automaticamente;
- o professor que criou a sala vira organizador;
- somente o organizador pode recomeçar a sala e remover alunos, professores ou convidados;
- o organizador tambem e o unico que ve o botao `FINALIZAR SHOW`;
- ao finalizar o show, o app pede confirmacao antes de encerrar;
- alunos entram na sala com o codigo ou QR Code enviado pelo professor e ficam em fila;
- professores tambem podem entrar por QR Code usando o papel `Professor` no dispositivo;
- convidados aparecem em um bloco proprio abaixo dos alunos;
- convidados entram com codigo ou scanner de QR Code para acompanhar;
- professor da nota para o aluno da vez;
- cada professor so pode dar uma nota por aluno em cada rodada;
- a avaliacao usa 4 criterios: afinacao e tecnica, interpretacao, presenca de palco, criatividade e originalidade;
- cada criterio vale de 0 a 10, totalizando ate 40 pontos por professor;
- o app so avanca para o proximo aluno quando todos os professores votam e todos confirmam o botao `PROXIMO`;
- fotos de perfil sao redimensionadas antes de salvar para evitar travamentos e layout quebrado;
- o mesmo dispositivo reutiliza o mesmo perfil para evitar clones ao atualizar a pagina;
- a area de chat permite mensagens de alunos, professores e convidados durante a apresentacao;
- no fim aparece o placar final.
- professor pode recomecar mantendo todos na sala ou criar uma nova sala.
- na sala, o quadro central mostra a foto do aluno que esta apresentando;
- o bloco inferior mostra professores e registros do show.
- convidados votam no aluno atual com `Ruim`, `Bom` ou `Maravilhoso`, gerando aprovacao do publico no placar.

## Como abrir no VS Code

1. Abra a pasta `caca-talentos` no Visual Studio Code.
2. Abra o arquivo `index.html`.
3. Use a extensao Live Server ou abra o arquivo direto no navegador.

## Estrutura de pastas

- `index.html`: tela principal do app.
- `css/styles.css`: estilos visuais e responsividade.
- `js/script.js`: regras da sala, votacao, chat, placar e sincronizacao.
- `assets/images/`: logos, coroas, medalhas e imagens do projeto.
- `assets/audio/`: sons principais do app, como vitoria, derrota e votos.
- `assets/sfx/efeitos-sonoros/`: efeitos aleatorios de entrada e palco.
- `netlify/functions/`: API das salas no Netlify.

## Teste rapido

Abra o `index.html` em duas abas do mesmo navegador:

1. Na primeira aba, entre como professor e crie uma sala.
2. Na segunda aba, entre como aluno usando o mesmo codigo.
3. Em outra aba, entre como espectador para acompanhar.
4. O professor avalia, o app avanca e no final mostra o placar.

## Netlify

No Netlify, as salas usam Netlify Functions + Netlify Blobs para ficarem
compartilhadas entre computador, celular e outros dispositivos.

Arquivos importantes:

- `netlify.toml`
- `netlify/functions/rooms.mjs`
- `package.json`

Depois de atualizar o site no Netlify, professor cria a sala, alunos entram com
o mesmo codigo e convidados podem votar pelo celular. A tela sincroniza
automaticamente a cada poucos segundos.

Abrindo o `index.html` direto no computador, o app ainda usa `localStorage`
como modo de teste local.
"# Ca-aTalento" 

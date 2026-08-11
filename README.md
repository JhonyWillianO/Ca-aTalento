# Caca-Talentos Prof. Jony

Aplicativo web inspirado no visual do Gartic, feito para uma competicao de apresentacoes em sala:

- aluno, professor ou convidados entram sem login, apenas com nick e avatar;
- professor cria uma sala com codigo;
- apenas professores podem criar sala;
- alunos entram na sala com o codigo enviado pelo professor e ficam em fila;
- convidados entram com codigo ou scanner de QR Code para acompanhar;
- professor da nota para o aluno da vez;
- cada professor so pode dar uma nota por aluno em cada rodada;
- a avaliacao usa 4 criterios: afinacao e tecnica, interpretacao, presenca de palco, criatividade e originalidade;
- cada criterio vale de 0 a 10, totalizando ate 40 pontos por professor;
- o app avanca para o proximo aluno;
- no fim aparece o placar final.
- professor pode recomecar mantendo todos na sala ou criar uma nova sala.
- na sala, o quadro central mostra a foto do aluno que esta apresentando;
- o bloco inferior mostra professores e registros do show.
- botao `SALA TESTE` cria a sala `TESTE1` com alunos, professores, convidados e notas de exemplo.
- convidados votam no aluno atual com `Ruim`, `Bom` ou `Maravilhoso`, gerando aprovacao do publico no placar.

## Como abrir no VS Code

1. Abra a pasta `caca-talentos` no Visual Studio Code.
2. Abra o arquivo `index.html`.
3. Use a extensao Live Server ou abra o arquivo direto no navegador.

## Teste rapido

Abra o `index.html` em duas abas do mesmo navegador:

1. Na primeira aba, entre como professor e crie uma sala.
2. Na segunda aba, entre como aluno usando o mesmo codigo.
3. Em outra aba, entre como espectador para acompanhar.
4. O professor avalia, o app avanca e no final mostra o placar.

Para testar mais rapido, clique em `SALA TESTE`. O app cria a sala `TESTE1`
com dados prontos para validar o palco, professores, registros, notas e placar.

Esta versao salva os dados no navegador. Para alunos e professores em computadores diferentes, o proximo passo e ligar um backend em tempo real, como Firebase, Supabase ou Socket.io.
"# Ca-aTalento" 

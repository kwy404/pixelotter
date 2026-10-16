<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../assets/banner-dark.svg">
    <img src="../assets/banner.svg" width="880" alt="Banner do pixelotter: Otto, a lontra pintora, ao lado do nome pixelotter">
  </picture>
</p>

<h1 align="center">pixelotter</h1>

<p align="center">Um editor de fotos com camadas que roda no navegador, funciona offline e deixa amigos editarem junto, direto entre os navegadores.</p>

<p align="center">
  <a href="https://kwy404.github.io/pixelotter/app/"><b>Abrir o editor</b></a> &middot;
  <a href="https://kwy404.github.io/pixelotter/">Site</a> &middot;
  <a href="../README.md">English</a>
</p>

## O que ele faz

- **Área de trabalho:** barra de menus, barra de opções, barra de ferramentas, painéis encaixáveis (camadas, canais, propriedades, ajustes, histórico, cor, amostras, caminhos, ações, info) e abas de documentos. O modo Rápido deixa as edições de um toque à mão no celular.
- **Camadas:** grupos, modos de mesclagem, opacidade, máscaras, máscara de recorte, camadas de ajuste e de preenchimento, estilos de camada.
- **Seleções:** retângulo, elipse, laço, laço poligonal, varinha mágica e seleção rápida, com suavizar, expandir, contrair, refinar e canais como seleção.
- **Ferramentas:** pincel, lápis, borracha, carimbo, correção, subexposição, superexposição, esponja, borrar, degradê, balde, texto, formas, caneta, corte e transformação livre.
- **Filtros:** níveis, curvas e os outros ajustes, desfoque, nitidez, ruído, distorção e estilização, liquify, preenchimento sensível ao conteúdo e um modelo de recorte que roda no seu aparelho.
- **Histórico:** desfazer ilimitado, painel de histórico, salvamento automático no navegador e recuperação.
- **Arquivos:** PSD e PSB com camadas (abrir e salvar), TIFF (com CMYK), PNG e APNG, JPEG, WebP e AVIF quando o navegador consegue gerar, GIF, BMP, ICO, TGA, PDF e o arquivo de projeto `.pxo`.
- **Impressão:** prova de cor CMYK aproximada, aviso de gama e exportação TIFF CMYK.
- **Juntos:** convide até cinco amigos com seis palavras, um código QR ou um link. Todos editam o mesmo documento com cursores ao vivo, e a sala tem conversa, voz com supressão de ruído, câmeras e compartilhamento de tela.
- **Clique direito em tudo:** menu de contexto na tela, nas camadas, nas mensagens e nas pessoas, também com toque longo e com a tecla Menu.

## Convidando amigos

Clique em **Editar junto**. A sala mostra seis palavras, um código QR e um link de convite com botão Copiar, todos com as mesmas palavras. O link guarda as palavras depois do sinal `#` (`app/#join=palavra-palavra-...`), que os navegadores nunca enviam a um servidor, e o app apaga isso da barra de endereço assim que lê.

## Limites honestos

- O CMYK é uma aproximação de um modelo genérico de impressão. Não há motor de cor ICC.
- Objetos inteligentes, formas vetoriais e texto editável de PSDs feitos em outros apps abrem como pixels.
- A exportação AVIF e WebP depende do navegador.
- O modelo de recorte e o runtime são baixados uma vez, cerca de 16 MB, e depois funcionam offline.
- A conexão direta pode falhar em redes muito restritas. Você pode adicionar seu próprio servidor TURN nas Configurações.

## Licença

[MIT](../LICENSE), 2026, Alexandre Kohler.

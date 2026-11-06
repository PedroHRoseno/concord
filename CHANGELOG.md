# Changelog

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem [semver](https://semver.org/lang/pt-BR/). A `1.0.0` saiu no `package.json` sem tag git. As tags públicas começam em `v1.1.0`.

## [1.8.2] - 2026-11-06

### Melhorado

- O fundo borrado da grade passa a atualizar a cada 5 minutos. O primeiro quadro continua saindo assim que a tela começa.

## [1.8.1] - 2026-11-05

### Adicionado

- Prévia WebP da transmissão de tela, enviada na hora para quem entra na sala.
- Escala da interface no desktop, com 90% a 150%, atalhos Ctrl + =, Ctrl + - e Ctrl + 0, e escala automática em monitores grandes.
- Seção Aparência nos ajustes.

### Melhorado

- Uma queda curta da live mantém o card e a tela cheia por 10 segundos, com o último quadro e a reconexão automática.
- O seletor de sala abre por cima da janela, com quem está em cada sala e a opção de criar uma sala.
- O estado da conexão fica no dock, com o ping.
- Toda transmissão de tela aparece no palco como card para assistir, e o botão na lista da sala ocupa a largura do card.
- O lobby separa o perfil das salas, e cada sala mostra o nome de quem está dentro.
- A grade recalcula cards 16:9 ao redimensionar a janela.
- A barra lateral, o dock e a barra de layout ficam maiores. O palco vazio vira um painel da sala.

### Corrigido

- Janela minimizada no Windows volta à lista de captura e é restaurada antes de compartilhar.
- A tela cheia não fecha quando a transmissão oscila por um instante.

## [1.8.0] - 2026-11-03

### Adicionado

- Anel verde de fala no avatar, medido depois do gate no microfone local e na voz recebida.
- Volume de entrada e de saída, teste do microfone e barra de sensibilidade com zona cortada e zona transmitida.
- Lista de salas ao vivo no lobby e troca de sala pelo nome no topo, sem banco.
- Sala oculta, que não aparece na lista.

### Melhorado

- Cards da sala abrem o menu no clique. O header mostra o perfil e o botão do APK, sem a contagem repetida de pessoas.
- A entrada com auto-join mostra a logo até a sala conectar. A sidebar usa skeletons e o vídeo aparece no primeiro quadro.

## [1.7.0] - 2026-11-03

### Adicionado

- Supressão de ruído com RNNoise no microfone, com fallback de high-pass e noise gate, e os modos Básico e Estúdio.
- Chat com mensagens agrupadas, lightbox de imagem e prévia de links via `GET /unfurl`.
- Menu de volume da voz e da live na lista da sala.
- Ajustes em tela cheia, com perfil, voz, vídeo, sons, atalhos e sobre.
- Barra de layout que mostra só as ações do modo Grade ou do modo Foco.

## [1.6.0] - 2026-11-03

### Adicionado

- Chat de voz P2P, com track `voice` separada, Opus mono, detecção de fala, volume individual de 0 a 200%, mute e ensurdecer.
- Chat de texto com histórico de 100 mensagens, links, pré-visualização e imagem WebP.
- App Android em Capacitor, com câmera frontal/traseira, Wake Lock e aviso de versão.
- `GET /turn` no servidor, com credencial efêmera da Cloudflare e STUN quando a chave não está configurada.
- Job `build-android`, que anexa o APK assinado à mesma Release do instalador Windows.
- Botão para baixar o APK a partir do desktop.

### Melhorado

- Clientes antigos deixam de receber streams de voz. O palco no celular vira lista, gaveta e tela cheia por CSS.

## [1.5.0] - 2026-10-31

### Adicionado

- Tela cheia com webcams em PiP e barra que se esconde sozinha.
- Notas da release no fluxo de atualização.

### Melhorado

- Instalador NSIS one-click, por usuário, para a atualização instalar sem UAC. O download continua sob confirmação.
- Seletor de fontes e captura no processo principal.

## [1.4.0] - 2026-10-31

### Adicionado

- Escolha do dispositivo de saída de áudio.
- Presença no Discord, com Client ID configurável.
- Reconexão da sessão WebRTC.

### Melhorado

- Player da transmissão, cartões do palco e captura de tela.

## [1.3.1] - 2026-10-30

### Corrigido

- A atualização só baixa depois da confirmação. `autoDownload` permanece desligado.

## [1.3.0] - 2026-10-30

### Adicionado

- Modo foco no palco.
- Webcams publicadas de forma automática na sala.
- Perfil com avatar WebP 96×96, cor e status.

## [1.2.0] - 2026-10-30

### Adicionado

- Sons de interface e diálogo de atualização.
- Ajustes de atalho e de dispositivo no painel de configurações.

### Melhorado

- Barra de controle, palco, lista de membros e barra de título.

## [1.1.1] - 2026-10-30

### Corrigido

- Controles da live no player, no palco e nos cartões.

## [1.1.0] - 2026-10-30

### Adicionado

- Palco livre, com cards arrastáveis, redimensionáveis e presets de posição.
- Áudio de sistema por WASAPI loopback, isolado por janela ou com o processo do Concord excluído na tela inteira.

## [1.0.0] - 2026-10-30

### Adicionado

- Aplicativo Electron com janela própria, bandeja, atalho global e instalador Windows.
- Compartilhamento de tela e webcam em mesh WebRTC, com lobby, seletor de fonte e estatísticas.
- Servidor de sinalização WebSocket separado, com sala em memória.
- Workflows de CI e de release no GitHub Actions.
- Electron 45.1.0 fixado para o empacotamento.

[1.6.0]: https://github.com/PedroHRoseno/concord/releases/tag/v1.6.0
[1.5.0]: https://github.com/PedroHRoseno/concord/releases/tag/v1.5.0
[1.4.0]: https://github.com/PedroHRoseno/concord/releases/tag/v1.4.0
[1.3.1]: https://github.com/PedroHRoseno/concord/releases/tag/v1.3.1
[1.3.0]: https://github.com/PedroHRoseno/concord/releases/tag/v1.3.0
[1.2.0]: https://github.com/PedroHRoseno/concord/releases/tag/v1.2.0
[1.1.1]: https://github.com/PedroHRoseno/concord/releases/tag/v1.1.1
[1.1.0]: https://github.com/PedroHRoseno/concord/releases/tag/v1.1.0
[1.0.0]: https://github.com/PedroHRoseno/concord/commit/db69212

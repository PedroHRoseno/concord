# Changelog

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e as versões seguem [semver](https://semver.org/lang/pt-BR/). A `1.0.0` saiu no `package.json` sem tag git. As tags públicas começam em `v1.1.0`.

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

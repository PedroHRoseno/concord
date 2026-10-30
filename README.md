# Screen Sharing

Aplicativo desktop de compartilhamento de tela (Electron + React) com sinalização WebSocket separada e mídia WebRTC P2P em mesh. Só tela e áudio do sistema.

## Requisitos

- Node.js 22 ou superior
- Windows, Linux ou macOS

No Windows e no Linux, o áudio do sistema usa o loopback do Chromium. No macOS 14.2 ou superior, o sistema pode entregar a track de áudio já encerrada até a permissão de gravação de áudio do sistema existir para o processo que iniciou o app.

## Instalar e rodar

Na raiz do projeto:

```powershell
cd c:\Users\PICHAU\Desktop\screen-sharing
npm install
```

Terminal 1, servidor de sinalização:

```powershell
npm run dev:signaling
```

Terminal 2, aplicativo:

```powershell
npm run dev:app
```

O sinalizador sobe em `ws://localhost:8080`. No app, entre com um nome e um ID de sala. Para testar dois peers na mesma máquina, use `Ctrl+Shift+N` para abrir outra janela, entre na mesma sala com outro nome, compartilhe a tela em uma e clique em **Assistir transmissão** na outra.

## Hospedar só o sinalizador

A pasta `signaling-server` não depende do Electron.

```powershell
cd signaling-server
npm install
npm start
```

Porta e host: variáveis `PORT` (padrão `8080`) e `HOST` (padrão `0.0.0.0`). No app, troque a URL do sinalizador para o endereço público, por exemplo `wss://seu-dominio`.

TURN é opcional. Preencha URL, usuário e senha no painel avançado do lobby; os STUN do Google continuam na lista.

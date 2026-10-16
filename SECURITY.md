# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

The hosted editor at https://kwy404.github.io/pixelotter/app/ always runs the latest version.

## How a room is protected

- The six words derive a topic and an AES-GCM key. The connection handshake is sealed with that key before it passes through public MQTT relays, so the relays see only encrypted data.
- After the handshake, documents, chat, voice and video go straight between browsers over WebRTC, encrypted with DTLS. A TURN relay, when you add one, only forwards encrypted packets.
- Each connection shows six safety words made from both DTLS certificate fingerprints. Matching words mean nobody sits in the middle.
- Anyone who has the words can join the room until it ends or you make new words. Share them only with the people you invite.
- No server of ours ever sees your files or messages, and nothing is stored online.

## Reporting a vulnerability

Please open a private security advisory on GitHub (Security tab, "Report a vulnerability") instead of a public issue. Include the steps to reproduce and the browser you used. You will get an answer within a week.

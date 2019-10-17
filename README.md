Sistema de chat de arquitectura híbrida para Sistemas Distribuidos.

## Archivos
* express.js: Server en express + WebSockets.
* http.js: Server en http + WebSockets.
* client.js: Cliente de chat. Compatible con ambas versiones del server.

## Puertos
* TCP 8080: Para HTTP y WebSockets.
* UDP 8082: Puente entre clientes UDP y WebSockets.
* TCP 8083: Puerto para NTP.

## Paths
* /chat: Cliente de chat por HTML.
* /list: Lista de clientes activos (excluye clientes conectados a traves de HTML).

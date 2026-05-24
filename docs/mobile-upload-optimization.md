# Mobile File Upload Optimization Plan: Binary WebSockets

This document details our findings regarding remote file uploads (images and documents) from mobile browsers to the `pi-remote-server`, analyzes the bottlenecks discovered during our testing, and outlines a future plan to achieve 100% network efficiency and speed.

---

## 1. Background & Journey So Far

To empower the Pi agent to read screenshots, diagrams, and local text documents, we implemented a client-to-server file transfer system. This evolved through two distinct architectural stages:

### Stage 1: The Raw HTTP POST Approach
* **Implementation**: Files were sent as a raw binary `fetch` POST stream directly to the `/session/upload` HTTP endpoint.
* **The Mobile Handshake Failure**: While this worked flawlessly on desktop, **mobile browsers (especially Firefox Mobile) blocked the POST requests**, throwing a generic `TypeError: NetworkError`.
* **The Root Cause**: Mobile browsers enforce extremely strict policies for non-standard ports (like `8765`) running over self-signed SSL/TLS certificates (including those with Common Name mismatches such as standard generated `localhost` certificates accessed over a Tailscale domain). Even if a user accepts the cert exception to load the page, the mobile browser's network layer silently aborts non-simple `POST` requests and `OPTIONS` preflight requests, blocking the transfer.

### Stage 2: The WebSocket Base64 Approach
* **Implementation**: We bypassed HTTP entirely by routing file uploads over the **already-established, trusted WebSocket connection** using a Base64-encoded string inside a JSON frame.
* **The Result**: **100% success rate on mobile!** Because the WebSocket connection was already active and secure, it was completely immune to CORS, preflight `OPTIONS` blocks, mixed-content checks, and self-signed certificate handshakes on mobile.
* **The Bottleneck**: While robust, this method introduced a noticeable delay on mobile uploads.

---

## 2. Bottlenecks of Base64 over JSON

Although Stage 2 solved the transport security block, it introduced performance costs that become noticeable with typical camera-captured images (often 3MB - 8MB in size):

1. **33% Size Overhead**: 
   Base64 encoding expands binary data into ASCII characters. This introduces a **33% data bloat** over the wire. An `8MB` mobile image inflates to `10.6MB` of transmitted text, lengthening upload times on asymmetrical mobile networks.
2. **CPU & Memory Spikes (Client & Server)**:
   * **Client**: The mobile browser must load the entire file, encode it to Base64, and serialize a large JSON string (`JSON.stringify()`), which can stutter the mobile main thread.
   * **Server**: The Node.js server receives the entire text-based WebSocket frame into memory, and calls `JSON.parse()`. Parsing a single `10.6MB` string requires high memory allocation and blocks the event loop for up to several hundred milliseconds.

---

## 3. Proposed Solution: Raw Binary WebSocket Protocol

To achieve **0% data overhead** and **zero JSON parsing latency** while maintaining the **100% preflight/CORS-free benefits of the WebSocket**, we propose migrating to a **custom binary packet protocol** over the existing WebSocket connection.

### How Binary WebSockets Work
Modern WebSockets natively support sending raw binary data (`ArrayBuffer` or `Blob`). By setting the connection's binary type:
```typescript
ws.binaryType = 'arraybuffer';
```
We can send files directly as packed byte arrays, allowing the browser and server to stream them with maximum native efficiency.

### Packet Protocol Design
To send a file, the client will pack both the **metadata** (like `sessionId` and `filename`) and the **raw file bytes** into a single binary packet before transmitting.

We propose a simple, lightweight binary framing format:

```
┌─────────────────┬──────────────────┬─────────────────┬──────────────────────────┐
│  SessionID Len  │    Session ID    │  Filename Len   │        Filename          │
│    (1 byte)     │   (UTF-8 string) │    (1 byte)     │     (UTF-8 string)       │
├─────────────────┼──────────────────┼─────────────────┼──────────────────────────┤
│    0x24 (36)    │ "019e5a32-b9..." │    0x0C (12)    │ "screenshot.png"         │
└─────────────────┴──────────────────┴─────────────────┴──────────────────────────┘
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                 Raw File Payload                                │
│                                  (Rest of Buffer)                               │
│                                                                                 │
│ 0x89 0x50 0x4E 0x47 0x0D ...                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Binary Frame Layout:
1. **Byte 0**: `sessionIdLength` (1 byte, unsigned integer - usually 36 for standard UUIDs).
2. **Bytes 1 to N**: `sessionId` (UTF-8 encoded string of length `sessionIdLength`).
3. **Byte N+1**: `filenameLength` (1 byte, unsigned integer).
4. **Bytes N+2 to M**: `filename` (UTF-8 encoded string of length `filenameLength`).
5. **Bytes M+1 to End**: The raw, untouched binary payload of the file.

---

## 4. Implementation Blueprint (No Code Changes Yet)

### Client-Side Packing (`web/src/lib/pi-remote.ts`)
Instead of reading the file as a Base64 data URL, the client reads the file as an `ArrayBuffer` and constructs the binary frame:

1. Convert `sessionId` and `filename` to UTF-8 byte arrays using `TextEncoder`.
2. Allocate a single `Uint8Array` of size: `1 + sessionIdBytes.length + 1 + filenameBytes.length + fileBuffer.byteLength`.
3. Write the lengths, copy the encoded string bytes, and finally copy the raw file buffer.
4. Send the packed buffer directly: `ws.send(packedBuffer)`.

### Server-Side Unpacking & Streaming (`server/src/index.ts`)
When the WebSocket server receives a binary message (`Buffer` or `ArrayBuffer`):

1. Read the first byte to get `sessionIdLength`.
2. Slice the buffer to extract and decode `sessionId`.
3. Read the next byte to get `filenameLength`.
4. Slice and decode `filename`.
5. The remaining portion of the buffer is the raw file data.
6. Resolve the target upload folder using our configurable `uploads` rules.
7. Write the file buffer directly to disk using `fs.writeFile` or stream it, then reply back to the specific client with a JSON message confirming success.

---

## 5. Summary of Benefits

| Metric / Feature | Base64 JSON over WS (Current) | Binary Packet over WS (Proposed) |
| :--- | :---: | :---: |
| **Mobile Handshake Success** | 100% | **100%** |
| **CORS / Preflight Required** | No | **No** |
| **Over-the-wire Size Bloat** | +33% (Base64) | **0% (Raw Bytes)** |
| **Client Serialization Overhead** | High (Base64 + JSON) | **Ultra-Low (Direct Copy)** |
| **Server CPU Parsing Overhead** | High (JSON.parse) | **Zero (Direct Binary Slice)** |
| **Server memory allocation** | 2-3x file size | **1x file size** |

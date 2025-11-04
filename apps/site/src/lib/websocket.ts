/**
 * Native WebSocket Server Implementation
 * No external dependencies - uses only Node.js built-ins
 */

import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WebSocketFrame {
  opcode: number;
  payload: Buffer;
  fin: boolean;
}

export enum OpCode {
  CONTINUATION = 0x0,
  TEXT = 0x1,
  BINARY = 0x2,
  CLOSE = 0x8,
  PING = 0x9,
  PONG = 0xA,
}

export class WebSocket {
  private socket: Duplex;
  private buffer: Buffer = Buffer.alloc(0);
  private closed = false;

  public onmessage?: (data: Buffer | string, isBinary: boolean) => void;
  public onclose?: () => void;
  public onerror?: (error: Error) => void;

  constructor(socket: Duplex, request: IncomingMessage) {
    this.socket = socket;

    // Perform WebSocket handshake
    const key = request.headers['sec-websocket-key'];
    if (!key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }

    const accept = createHash('sha1')
      .update(key + GUID)
      .digest('base64');

    const response = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n');

    socket.write(response);

    // Listen for data
    socket.on('data', (data) => this.handleData(data));
    socket.on('end', () => this.handleClose());
    socket.on('error', (err) => this.handleError(err));
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= 2) {
      const frame = this.parseFrame();
      if (!frame) break;

      this.handleFrame(frame);
    }
  }

  private parseFrame(): WebSocketFrame | null {
    if (this.buffer.length < 2) return null;

    const firstByte = this.buffer[0];
    const secondByte = this.buffer[1];

    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;

    let offset = 2;

    // Extended payload length
    if (payloadLength === 126) {
      if (this.buffer.length < 4) return null;
      payloadLength = this.buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (this.buffer.length < 10) return null;
      payloadLength = Number(this.buffer.readBigUInt64BE(2));
      offset = 10;
    }

    // Masking key (if present)
    let maskingKey: Buffer | null = null;
    if (masked) {
      if (this.buffer.length < offset + 4) return null;
      maskingKey = this.buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    // Check if we have the full payload
    if (this.buffer.length < offset + payloadLength) return null;

    // Extract payload
    let payload = this.buffer.subarray(offset, offset + payloadLength);

    // Unmask if needed
    if (maskingKey) {
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= maskingKey[i % 4];
      }
    }

    // Remove processed data from buffer
    this.buffer = this.buffer.subarray(offset + payloadLength);

    return { opcode, payload, fin };
  }

  private handleFrame(frame: WebSocketFrame): void {
    switch (frame.opcode) {
      case OpCode.TEXT:
        this.onmessage?.(frame.payload.toString('utf-8'), false);
        break;
      case OpCode.BINARY:
        this.onmessage?.(frame.payload, true);
        break;
      case OpCode.CLOSE:
        this.close();
        break;
      case OpCode.PING:
        this.sendFrame(OpCode.PONG, frame.payload);
        break;
      case OpCode.PONG:
        // Ignore pong frames
        break;
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  private handleError(error: Error): void {
    this.onerror?.(error);
    this.close();
  }

  public send(data: string | Buffer): void {
    if (this.closed) return;

    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    const opcode = typeof data === 'string' ? OpCode.TEXT : OpCode.BINARY;

    this.sendFrame(opcode, buffer);
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    const payloadLength = payload.length;
    let frameHeader: Buffer;

    if (payloadLength < 126) {
      frameHeader = Buffer.alloc(2);
      frameHeader[0] = 0x80 | opcode; // FIN + opcode
      frameHeader[1] = payloadLength;
    } else if (payloadLength < 65536) {
      frameHeader = Buffer.alloc(4);
      frameHeader[0] = 0x80 | opcode;
      frameHeader[1] = 126;
      frameHeader.writeUInt16BE(payloadLength, 2);
    } else {
      frameHeader = Buffer.alloc(10);
      frameHeader[0] = 0x80 | opcode;
      frameHeader[1] = 127;
      frameHeader.writeBigUInt64BE(BigInt(payloadLength), 2);
    }

    this.socket.write(Buffer.concat([frameHeader, payload]));
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;

    const closeFrame = Buffer.alloc(2);
    closeFrame[0] = 0x80 | OpCode.CLOSE;
    closeFrame[1] = 0;

    this.socket.write(closeFrame);
    this.socket.end();
  }

  public get readyState(): number {
    return this.closed ? 3 : 1; // CLOSED : OPEN
  }
}

/**
 * Check if request is a WebSocket upgrade request
 */
export function isWebSocketUpgrade(req: IncomingMessage): boolean {
  return (
    req.headers.upgrade?.toLowerCase() === 'websocket' &&
    req.headers.connection?.toLowerCase().includes('upgrade') === true &&
    !!req.headers['sec-websocket-key']
  );
}

/**
 * Accept WebSocket connection
 */
export function acceptWebSocket(
  socket: Duplex,
  request: IncomingMessage
): WebSocket {
  return new WebSocket(socket, request);
}

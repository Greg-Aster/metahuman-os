import asyncio
import websockets

async def test_ws():
    uri = "ws://localhost:3099/ws"
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected to ttyd WebSocket")
            await websocket.send(b'\x00echo "hello from test"\n')
            print("Sent test message")
            while True:
                try:
                    message = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                    print(f"Received: {message}")
                    if b"hello from test" in message:
                        print("Test successful")
                        break
                except asyncio.TimeoutError:
                    print("Timeout waiting for response")
                    break
    except Exception as e:
        print(f"Failed to connect: {e}")

if __name__ == "__main__":
    asyncio.run(test_ws())

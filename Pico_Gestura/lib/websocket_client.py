import ubinascii
import uhashlib
import ujson
import usocket
import time

try:
    import urandom
except ImportError:
    urandom = None

try:
    import ssl
except ImportError:
    try:
        import ussl as ssl
    except ImportError:
        ssl = None

from lib.env import parse_ws_url

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class SimpleWebSocketClient:
    def __init__(self, url, headers=None, timeout=5, ca_der_path=None):
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout
        self.ca_der_path = ca_der_path
        self.sock = None
        self.parsed = parse_ws_url(url)
        self.healthy = False
        self.last_rx_ms = 0
        self.last_tx_ms = 0
        self.last_pong_ms = 0
        self.last_error = ""

    def connect(self):
        if self.parsed["secure"] and ssl is None:
            raise RuntimeError("ssl is required for wss:// support")

        # Stage 1: DNS + TCP
        try:
            addr = usocket.getaddrinfo(self.parsed["host"], self.parsed["port"])[0][-1]
            sock = usocket.socket()
            sock.settimeout(self.timeout)
            sock.connect(addr)
            self._raw_sock = sock
            print("[ws] TCP connected")
        except Exception as e:
            raise RuntimeError("Stage 1 (TCP connect) failed: {}".format(repr(e)))

        # Stage 2: TLS wrap
        if self.parsed["secure"]:
            try:
                sock = ssl.wrap_socket(sock, server_hostname=self.parsed["host"])
                print("[ws] TLS wrapped")
            except TypeError:
                sock = ssl.wrap_socket(sock)
            except Exception as e:
                raise RuntimeError("Stage 2 (TLS wrap) failed: {}".format(repr(e)))

        # Stage 3: Key generation
        try:
            key = random_b64(16)
            print("[ws] key:", key)
        except Exception as e:
            raise RuntimeError("Stage 3 (key gen) failed: {}".format(repr(e)))

        # Stage 4: Build + send HTTP upgrade
        try:
            host = self.parsed["host"]
            if self.parsed["port"] not in (80, 443):
                host = "{}:{}".format(self.parsed["host"], self.parsed["port"])
            request = [
                "GET {} HTTP/1.1".format(self.parsed["path"]),
                "Host: {}".format(host),
                "Upgrade: websocket",
                "Connection: Upgrade",
                "Sec-WebSocket-Version: 13",
                "Sec-WebSocket-Key: {}".format(key),
            ]
            for header, value in self.headers.items():
                request.append("{}: {}".format(header, value))
            request.append("")
            request.append("")
            raw = "\r\n".join(request).encode("utf-8")
            print("[ws] sending upgrade request, {} bytes".format(len(raw)))
            sock.write(raw)
        except Exception as e:
            raise RuntimeError("Stage 4 (HTTP upgrade send) failed: {}".format(repr(e)))

        # Stage 5: Read + validate response
        try:
            response = read_http_response(sock)
            print("[ws] response first line:", response.split("\r\n", 1)[0])
        except Exception as e:
            raise RuntimeError("Stage 5 (read HTTP response) failed: {}".format(repr(e)))

        if " 101 " not in response.split("\r\n", 1)[0]:
            sock.close()
            raise RuntimeError("websocket upgrade failed: {}".format(response.split("\r\n", 1)[0]))

        self.sock = sock
        self.healthy = True
        self.last_rx_ms = time.ticks_ms()
        self.last_tx_ms = self.last_rx_ms
        self.last_pong_ms = 0
        print("[ws] connected successfully")

    def close(self):
        if self.sock:
            try:
                self.send_frame(0x8, b"")
            except Exception:
                pass
            try:
                self.sock.close()
            except Exception:
                pass
        self.sock = None
        self.healthy = False

    def is_healthy(self):
        return self.sock is not None and self.healthy

    def ping(self, payload=b""):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        self.send_frame(0x9, payload)

    def mark_unhealthy(self, error=""):
        self.healthy = False
        self.last_error = str(error or "")

    def send_json(self, payload):
        self.send_text(ujson.dumps(payload))

    def send_text(self, text):
        self.send_frame(0x1, text.encode("utf-8"))

    def send_frame(self, opcode, payload):
        if self.sock is None:
            raise RuntimeError("websocket is not connected")

        header = bytearray()
        header.append(0x80 | opcode)

        payload_len = len(payload)
        if payload_len < 126:
            header.append(0x80 | payload_len)
        elif payload_len < 65536:
            header.append(0x80 | 126)
            header.extend(payload_len.to_bytes(2, "big"))
        else:
            header.append(0x80 | 127)
            header.extend(payload_len.to_bytes(8, "big"))

        mask = random_bytes(4)
        header.extend(mask)
        masked = bytearray(payload_len)
        for i in range(payload_len):
            masked[i] = payload[i] ^ mask[i % 4]

        try:
            self.sock.write(header)
            if payload_len:
                self.sock.write(masked)
            self.last_tx_ms = time.ticks_ms()
        except Exception as exc:
            self.mark_unhealthy(repr(exc))
            raise

    def receive_json(self, timeout=0.05):
        message = self.receive_text(timeout=timeout)
        if message is None:
            return None
        try:
            return ujson.loads(message)
        except ValueError as exc:
            self.last_error = "invalid json websocket text: {}".format(short_text(message))
            raise exc

    def receive_text(self, timeout=0.05):
        if self.sock is None:
            return None

        try:
            self.sock.settimeout(timeout)
        except Exception:
            pass
        try:
            opcode, payload = self.read_message()
        except OSError:
            return None

        if opcode == 0x1:
            self.last_rx_ms = time.ticks_ms()
            return payload.decode("utf-8", "ignore")
        if opcode == 0x8:
            self.close()
            return None
        if opcode == 0x9:
            self.last_rx_ms = time.ticks_ms()
            self.send_frame(0xA, payload)
            return None
        if opcode == 0xA:
            self.last_rx_ms = time.ticks_ms()
            self.last_pong_ms = self.last_rx_ms
            return None
        return None

    def read_frame(self):
        header = read_exact(self.sock, 2)
        first = header[0]
        second = header[1]
        fin = (first & 0x80) != 0
        opcode = first & 0x0F
        masked = (second & 0x80) != 0
        payload_len = second & 0x7F

        if payload_len == 126:
            payload_len = int.from_bytes(read_exact(self.sock, 2), "big")
        elif payload_len == 127:
            payload_len = int.from_bytes(read_exact(self.sock, 8), "big")

        mask = read_exact(self.sock, 4) if masked else None
        payload = read_exact(self.sock, payload_len) if payload_len else b""

        if masked and mask:
            unmasked = bytearray(payload_len)
            for i in range(payload_len):
                unmasked[i] = payload[i] ^ mask[i % 4]
            payload = bytes(unmasked)

        return fin, opcode, payload

    def read_message(self):
        fin, opcode, payload = self.read_frame()
        if opcode not in (0x0, 0x1, 0x2):
            return opcode, payload
        if fin:
            return opcode, payload

        message_opcode = opcode
        chunks = [payload]
        while True:
            fin, opcode, payload = self.read_frame()
            if opcode == 0x9:
                self.last_rx_ms = time.ticks_ms()
                self.send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                self.last_rx_ms = time.ticks_ms()
                self.last_pong_ms = self.last_rx_ms
                continue
            if opcode == 0x8:
                return opcode, payload
            if opcode != 0x0:
                raise OSError("unexpected websocket continuation opcode {}".format(opcode))
            chunks.append(payload)
            if fin:
                return message_opcode, b"".join(chunks)


def read_http_response(sock):
    buf = bytearray(1)
    data = b""
    while b"\r\n\r\n" not in data:
        try:
            n = sock.readinto(buf, 1)
        except UnicodeError:
            # ussl raises this on some TLS record boundaries on RP2350
            continue
        except OSError:
            break
        if not n:
            break
        data += bytes(buf[:n])
    return data.decode("latin-1")


def read_exact(sock, length):
    data = b""
    buf = bytearray(length)
    while len(data) < length:
        try:
            n = sock.readinto(buf, length - len(data))
        except UnicodeError:
            n = sock.readinto(buf, 1)
        if not n:
            raise OSError("connection closed")
        data += bytes(buf[:n])
    return data


def short_text(value, limit=96):
    text = str(value or "").replace("\r", "\\r").replace("\n", "\\n")
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def random_bytes(length):
    if urandom is not None:
        try:
            return bytes(urandom.getrandbits(8) for _ in range(length))
        except Exception:
            pass

    seed = time.ticks_ms()
    output = bytearray(length)
    for index in range(length):
        seed = (1103515245 * seed + 12345) & 0x7FFFFFFF
        output[index] = seed & 0xFF
    return bytes(output)


def random_b64(length):
    return ubinascii.b2a_base64(random_bytes(length)).decode("utf-8").strip()


def websocket_accept(key):
    sha1 = uhashlib.sha1((key + GUID).encode("utf-8"))
    return ubinascii.b2a_base64(sha1.digest()).strip().decode()


def load_ca(ca_der_path):
    if not ca_der_path:
        return None
    try:
        with open(ca_der_path, "rb") as f:
            return f.read()
    except OSError:
        print("CA DER not found:", ca_der_path)
        return None

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
    import ussl
except ImportError:
    ussl = None

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

    def connect(self):
        if self.parsed["secure"] and ussl is None:
            raise RuntimeError("ussl is required for wss:// support")

        addr = usocket.getaddrinfo(self.parsed["host"], self.parsed["port"])[0][-1]
        sock = usocket.socket()
        sock.settimeout(self.timeout)
        sock.connect(addr)

        if self.parsed["secure"]:
            kwargs = {"server_hostname": self.parsed["host"]}
            ca_data = load_ca(self.ca_der_path)
            if ca_data:
                kwargs["cadata"] = ca_data
                kwargs["cert_reqs"] = 2
            try:
                sock = ussl.wrap_socket(sock, **kwargs)
            except TypeError:
                if ca_data:
                    raise RuntimeError("CA DER validation is not supported by this firmware")
                sock = ussl.wrap_socket(sock, server_hostname=self.parsed["host"])

        key = random_b64(16)
        request = [
            "GET {} HTTP/1.1".format(self.parsed["path"]),
            "Host: {}:{}".format(self.parsed["host"], self.parsed["port"]),
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: {}".format(key),
        ]
        for header, value in self.headers.items():
            request.append("{}: {}".format(header, value))
        request.append("")
        request.append("")

        sock.write("\r\n".join(request).encode("utf-8"))
        response = read_http_response(sock)
        if " 101 " not in response.split("\r\n", 1)[0]:
            sock.close()
            raise RuntimeError("websocket upgrade failed: {}".format(response.split("\r\n", 1)[0]))

        self.sock = sock

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

        self.sock.write(header)
        if payload_len:
            self.sock.write(masked)

    def receive_json(self, timeout=0.05):
        message = self.receive_text(timeout=timeout)
        if message is None:
            return None
        return ujson.loads(message)

    def receive_text(self, timeout=0.05):
        if self.sock is None:
            return None

        self.sock.settimeout(timeout)
        try:
            opcode, payload = self.read_frame()
        except OSError:
            return None

        if opcode == 0x1:
            return payload.decode("utf-8")
        if opcode == 0x8:
            self.close()
            return None
        if opcode == 0x9:
            self.send_frame(0xA, payload)
            return None
        return None

    def read_frame(self):
        header = read_exact(self.sock, 2)
        first = header[0]
        second = header[1]
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

        return opcode, payload


def read_http_response(sock):
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = sock.read(128)
        if not chunk:
            break
        data += chunk
    return data.decode("utf-8")


def read_exact(sock, length):
    data = b""
    while len(data) < length:
        chunk = sock.read(length - len(data))
        if not chunk:
            raise OSError("connection closed")
        data += chunk
    return data


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
    return ubinascii.b2a_base64(random_bytes(length)).strip().decode("utf-8")


def websocket_accept(key):
    sha1 = uhashlib.sha1((key + GUID).encode("utf-8"))
    return ubinascii.b2a_base64(sha1.digest()).strip().decode("utf-8")


def load_ca(ca_der_path):
    if not ca_der_path:
        return None
    try:
        with open(ca_der_path, "rb") as f:
            return f.read()
    except OSError:
        print("CA DER not found:", ca_der_path)
        return None

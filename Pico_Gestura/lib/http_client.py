import ujson
import usocket

try:
    import urequests
except ImportError:
    urequests = None


try:
    import ssl
except ImportError:
    try:
        import ussl as ssl
    except ImportError:
        ssl = None

from lib.env import parse_ws_url


def get_json(url, headers=None, ca_der_path=None, timeout=5):
    request_headers = {"Accept": "application/json", "Connection": "close"}
    for key, value in (headers or {}).items():
        request_headers[key] = value
    status, body = request("GET", url, headers=request_headers, ca_der_path=ca_der_path, timeout=timeout)
    if status < 200 or status >= 300:
        raise RuntimeError("GET {} failed with {}".format(redact_url(url), status))
    return ujson.loads(body)


def post_json(url, payload, headers=None, ca_der_path=None, timeout=5):
    request_headers = {"Content-Type": "application/json", "Accept": "application/json", "Connection": "close"}
    for key, value in (headers or {}).items():
        request_headers[key] = value
    status, body = request(
        "POST",
        url,
        body=ujson.dumps(payload),
        headers=request_headers,
        ca_der_path=ca_der_path,
        timeout=timeout,
    )
    if status < 200 or status >= 300:
        raise RuntimeError("POST {} failed with {} {}".format(redact_url(url), status, compact_body(body)))
    return ujson.loads(body) if body else {"ok": True}


def request(method, url, body=None, headers=None, ca_der_path=None, timeout=5):
    if urequests is not None:
        return request_with_urequests(method, url, body=body, headers=headers, timeout=timeout)
    return request_with_socket(method, url, body=body, headers=headers, ca_der_path=ca_der_path, timeout=timeout)

def request_with_urequests(method, url, body=None, headers=None, timeout=5):
    import gc
    response = None
    try:
        kwargs = {
            "headers": headers or {},
            "data": body,
            "timeout": timeout,
        }
        if method == "GET":
            kwargs.pop("data", None)
            response = urequests.get(url, **kwargs)
        elif method == "POST":
            response = urequests.post(url, **kwargs)
        else:
            raise ValueError("Unsupported HTTP method: {}".format(method))
        return response.status_code, response.text
    finally:
        try:
            if response:
                response.close()
        except Exception:
            pass
        response = None
        gc.collect()


def request_with_socket(method, url, body=None, headers=None, ca_der_path=None, timeout=5):
    parsed = parse_http_url(url)
    sock = open_socket(parsed, ca_der_path=ca_der_path, timeout=timeout)
    try:
        host = parsed["host"]
        if parsed["port"] not in (80, 443):
            host = "{}:{}".format(parsed["host"], parsed["port"])

        encoded_body = body.encode("utf-8") if isinstance(body, str) else body

        request_lines = [
            "{} {} HTTP/1.1".format(method, parsed["path"]),
            "Host: {}".format(host),
            "Connection: close",
        ]

        for key, value in (headers or {}).items():
            request_lines.append("{}: {}".format(key, value))
        if encoded_body:
            request_lines.append("Content-Length: {}".format(len(encoded_body)))

        request_lines.append("")
        request_lines.append("")

        sock.write("\r\n".join(request_lines).encode("utf-8"))
        if encoded_body:
            sock.write(encoded_body)

        status, body = read_response(sock)
        return status, body

    finally:
        sock.close()


def open_socket(parsed, ca_der_path=None, timeout=5):
    if parsed["secure"] and ssl is None:
        raise RuntimeError("SSL/TLS not available in this firmware")

    addr = usocket.getaddrinfo(parsed["host"], parsed["port"])[0][-1]
    raw_sock = usocket.socket()
    raw_sock.settimeout(timeout)

    try:
        raw_sock.connect(addr)

        if not parsed["secure"]:
            return raw_sock

        try:
            wrapped = ssl.wrap_socket(raw_sock, server_hostname=parsed["host"])
        except TypeError:
            wrapped = ssl.wrap_socket(raw_sock)

        # Re-apply timeout on the wrapped socket — TLS handshake may have reset it
        try:
            wrapped.settimeout(timeout)
        except Exception:
            pass

        return wrapped

    except Exception:
        raw_sock.close()
        raise


def parse_http_url(url):
    secure = url.startswith("https://")
    if not secure and not url.startswith("http://"):
        raise ValueError("Expected http:// or https:// URL")

    parsed = parse_ws_url(
        url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    )

    parsed["scheme"] = "https" if secure else "http"
    parsed["secure"] = secure

    return parsed


def load_ca(ca_der_path):
    if not ca_der_path:
        return None
    try:
        with open(ca_der_path, "rb") as f:
            return f.read()
    except OSError:
        print("CA DER not found:", ca_der_path)
        return None


def read_response(sock):
    raw = b""

    # Read headers
    while b"\r\n\r\n" not in raw:
        chunk = sock.read(256)
        if not chunk:
            break
        raw += chunk

    header, _, body = raw.partition(b"\r\n\r\n")

    status_line = header.split(b"\r\n", 1)[0].decode("utf-8")

    try:
        status = int(status_line.split(" ")[1])
    except Exception:
        raise RuntimeError("Invalid HTTP response: {}".format(status_line))

    # Read rest of body
    while True:
        chunk = sock.read(512)
        if not chunk:
            break
        body += chunk

    return status, body.decode("utf-8")


def compact_body(body, limit=160):
    text = str(body or "").replace("\r", " ").replace("\n", " ")
    if len(text) <= limit:
        return text
    return text[:limit] + "..."


def redact_url(url):
    text = str(url or "")
    for token_key in ("api_key=", "token="):
        index = text.find(token_key)
        if index >= 0:
            start = index + len(token_key)
            end = text.find("&", start)
            if end < 0:
                return text[:start] + "<redacted>"
            return text[:start] + "<redacted>" + text[end:]
    return text

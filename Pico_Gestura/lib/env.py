def load_env(filename=".env"):
    """
    Reads a .env file and loads variables into a dictionary.
    MicroPython's os module may not support os.environ directly, 
    so we return a dictionary of the variables instead.
    """
    config = {}
    try:
        with open(filename, "r") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    value = strip_inline_comment(value.strip())
                    # Strip surrounding single/double quotes if present
                    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                    config[key.strip()] = value
    except OSError:
        print(f"Warning: {filename} file not found.")
    return config


def strip_inline_comment(value):
    quote = ""
    escaped = False
    for index, char in enumerate(value):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if quote:
            if char == quote:
                quote = ""
            continue
        if char in ("'", '"'):
            quote = char
            continue
        if char == "#" and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value


def parse_ws_url(url):
    if not url:
        return {
            "scheme": "ws",
            "host": "",
            "port": 80,
            "path": "/glove",
            "secure": False,
        }

    secure = url.startswith("wss://")
    scheme = "wss" if secure else "ws"
    remainder = url.split("://", 1)[1] if "://" in url else url
    if "/" in remainder:
        host_part, path = remainder.split("/", 1)
        path = "/" + path
    else:
        host_part = remainder
        path = "/glove"

    if ":" in host_part:
        host, port_str = host_part.rsplit(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            port = 443 if secure else 80
    else:
        host = host_part
        port = 443 if secure else 80

    return {
        "scheme": scheme,
        "host": host,
        "port": port,
        "path": path or "/glove",
        "secure": secure,
    }

def ws_to_http_url(url):
    if url.startswith("wss://"):
        return "https://" + url[len("wss://"):]
    if url.startswith("ws://"):
        return "http://" + url[len("ws://"):]
    return url

def http_to_ws_url(url):
    if url.startswith("https://"):
        return "wss://" + url[len("https://"):]
    if url.startswith("http://"):
        return "ws://" + url[len("http://"):]
    return url

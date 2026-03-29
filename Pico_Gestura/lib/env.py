import os

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
                    value = value.strip()
                    # Strip surrounding single/double quotes if present
                    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]
                    config[key.strip()] = value
    except OSError:
        print(f"Warning: {filename} file not found.")
    return config

def _parse_mqtt_server(server):
    # Accept "host" or "host:port"
    if not server:
        return "", 1883
    if ":" in server:
        host, port_str = server.rsplit(":", 1)
        try:
            return host, int(port_str)
        except ValueError:
            return server, 1883
    return server, 1883

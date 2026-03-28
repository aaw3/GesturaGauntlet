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
                    config[key.strip()] = value.strip()
    except OSError:
        print(f"Warning: {filename} file not found.")
    return config

# Example usage:
env_vars = load_env()
# Access your variables like this:
api_key = env_vars.get("API_KEY", "default_value_if_not_found")
print(f"API Key: {api_key}") 

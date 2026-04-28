import uhashlib
import ujson
import time


class EndpointCache:
    def __init__(self, path="endpoint_cache.json"):
        self.path = path
        self.data = {
            "version": 1,
            "hash": "",
            "updated_at": 0,
            "last_good_node_id": "",
            "nodes": [],
            "ca_der_path": "",
        }
        self.load()

    def load(self):
        try:
            with open(self.path, "r") as f:
                loaded = ujson.loads(f.read())
                if isinstance(loaded, dict):
                    self.data.update(loaded)
        except OSError:
            pass
        except Exception as exc:
            print("Endpoint cache ignored:", exc)

    def update_if_changed(self, metadata, ca_der_path=""):
        next_data = {
            "version": int(metadata.get("version", 1)),
            "hash": metadata.get("hash") or stable_hash(metadata.get("nodes", [])),
            "updated_at": int(time.time()) if hasattr(time, "time") else 0,
            "last_good_node_id": self.data.get("last_good_node_id", ""),
            "nodes": metadata.get("nodes", []),
            "ca_der_path": ca_der_path or self.data.get("ca_der_path", ""),
        }
        if next_data["hash"] == self.data.get("hash") and next_data["ca_der_path"] == self.data.get("ca_der_path"):
            return False

        self.data = next_data
        self.save()
        return True

    def set_last_good(self, node_id):
        if not node_id or node_id == self.data.get("last_good_node_id"):
            return False
        self.data["last_good_node_id"] = node_id
        self.save()
        return True

    def interfaces(self):
        interfaces = []
        last_good = self.data.get("last_good_node_id", "")
        nodes = self.data.get("nodes", [])
        for node in nodes:
            node_bias = -100 if node.get("nodeId") == last_good else 0
            for iface in node.get("interfaces", []):
                item = dict(iface)
                item["nodeId"] = node.get("nodeId", "")
                item["_priority"] = int(item.get("priority", 100)) + node_bias
                interfaces.append(item)
        return sorted(interfaces, key=lambda item: (transport_rank(item), item.get("_priority", 100)))

    def save(self):
        with open(self.path, "w") as f:
            f.write(ujson.dumps(self.data))


def transport_rank(item):
    url = item.get("url", "")
    kind = item.get("kind", "")
    if url.startswith("wss://"):
        return 0
    if kind == "lan" and url.startswith("ws://"):
        return 1
    return 2


def stable_hash(value):
    payload = ujson.dumps(value)
    digest = uhashlib.sha256(payload.encode("utf-8")).digest()
    return "".join("{:02x}".format(byte) for byte in digest)

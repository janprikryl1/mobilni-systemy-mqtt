import json
import os
import threading
import time
import warnings
import paho.mqtt.client as mqtt

warnings.filterwarnings("ignore", category=DeprecationWarning)

# Local broker
LOCAL_HOST = os.getenv("LOCAL_HOST", "localhost")
LOCAL_PORT = int(os.getenv("LOCAL_PORT", 1883))
LOCAL_USER = os.getenv("LOCAL_USER", "server")
LOCAL_PASS = os.getenv("LOCAL_PASS", "Broker")

# Remote broker
REMOTE_HOST = os.getenv("REMOTE_HOST", "pcfeib425t.vsb.cz")
REMOTE_PORT = int(os.getenv("REMOTE_PORT", 1883))
REMOTE_USER = os.getenv("REMOTE_USER", "server")
REMOTE_PASS = os.getenv("REMOTE_PASS", "Broker")

OFFLINE_TIMEOUT = 20.0
MAX_RETRIES = 5
REFRESH_INTERVAL = 30.0
QUEUE_FILE = "offline_queue.json"

lock = threading.RLock()
remote_connected = False
remote_disconnect_time = None
remote_retry_count = 0
all_offline_notified = False
local_client_username = None

# Cache and queue
presence_cache = {}          # username -> "online" / "offline"
offline_queue = []           # [{"topic": ..., "payload": ..., "qos": ..., "retain": ..., "recipient": ...}]


# Persistent queue
def save_queue_to_disk():
    try:
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(offline_queue, f, indent=2)
    except Exception as e:
        print(f"[CACHE] Error while saving queue to disk: {e}")


def load_queue_from_disk():
    global offline_queue
    if os.path.exists(QUEUE_FILE):
        try:
            with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                offline_queue = json.load(f)
            print(f"[CACHE] Loaded {len(offline_queue)} not sent messages from disk.")
        except Exception as e:
            print(f"[CACHE] Error while loading queue from disk: {e}")
            offline_queue = []


# Helpers
def extract_recipient(topic):
    # Format: /mschat/user/<recipient>/<sender>
    parts = topic.strip("/").split("/")
    if len(parts) >= 3 and parts[0] == "mschat" and parts[1] == "user":
        return parts[2]
    return None


def extract_sender(topic):
    parts = topic.strip("/").split("/")
    if len(parts) >= 3 and parts[0] == "mschat":
        if parts[1] == "all" and len(parts) >= 3:
            return parts[2]
        if parts[1] == "user" and len(parts) >= 4:
            return parts[3]
        if parts[1] == "status" and len(parts) >= 3:
            return parts[2]
    return None

# Sends messages from queue
def flush_queue():
    global offline_queue
    if not remote_connected or not offline_queue:
        return

    remaining = []
    sent_count = 0

    for item in offline_queue:
        recipient = item.get("recipient")
        payload = item["payload"].encode("utf-8") if isinstance(item["payload"], str) else item["payload"]

        # Public message -> send immediately
        if not recipient:
            remote_client.publish(item["topic"], payload, qos=item.get("qos", 1), retain=item.get("retain", False))
            sent_count += 1
        # Private -> only if reciever online
        elif presence_cache.get(recipient) == "online":
            remote_client.publish(item["topic"], payload, qos=item.get("qos", 1), retain=item.get("retain", False))
            sent_count += 1
        else:
            # Receiver still offline
            remaining.append(item)

    if sent_count > 0:
        print(f"[QUEUE] Sent {sent_count} messages to server, remaining {len(remaining)}.")

    offline_queue = remaining
    save_queue_to_disk()


# Callbacks: Local broker
def on_local_connect(client, userdata, flags, rc):
    if rc != 0:
        print(f"[ERROR] Error while connecting to local broker! Code: {rc}")
        return

    print(f"[LOCAL] Connected to ({LOCAL_HOST}:{LOCAL_PORT})")
    client.subscribe("/mschat/#", qos=1)

    # Offline mode - return last saved state
    with lock:
        if not remote_connected and presence_cache:
            for user, st in presence_cache.items():
                if user != local_client_username:
                    client.publish(f"/mschat/status/{user}", st.encode("utf-8"), qos=1, retain=True)


def on_local_message(client, userdata, msg):
    global local_client_username
    topic = msg.topic
    sender = extract_sender(topic)
    recipient = extract_recipient(topic)
    payload_str = msg.payload.decode("utf-8", errors="ignore")

    if local_client_username and sender and sender != local_client_username and sender != "anon":
        return

    with lock:
        # Detect user local client by status or sender
        if topic.startswith("/mschat/status/") and sender:
            local_client_username = sender
            presence_cache[sender] = "offline" if "offline" in payload_str.lower() else "online"
        elif sender and not local_client_username and sender != "anon":
            local_client_username = sender

        # Server not available -> save to offline queue
        if not remote_connected:
            print(f"[OFFLINE QUEUE] Server not available, saving: {topic}")
            offline_queue.append({
                "topic": topic,
                "payload": payload_str,
                "qos": msg.qos,
                "retain": msg.retain,
                "recipient": recipient
            })
            save_queue_to_disk()
            return

        if recipient and presence_cache.get(recipient) == "offline":
            offline_queue.append({
                "topic": topic,
                "payload": payload_str,
                "qos": msg.qos,
                "retain": msg.retain,
                "recipient": recipient
            })
            save_queue_to_disk()
            return
        remote_client.publish(topic, msg.payload, qos=msg.qos, retain=msg.retain)


# Callbacks: Remote server
def on_remote_connect(client, userdata, flags, rc):
    global remote_connected, remote_disconnect_time, remote_retry_count, all_offline_notified
    with lock:
        remote_connected = True
        remote_disconnect_time = None
        remote_retry_count = 0
        all_offline_notified = False
        print(f"[SERVER] Connected ({REMOTE_HOST}:{REMOTE_PORT})")
        client.subscribe("/mschat/#", qos=1)
        flush_queue()


def on_remote_disconnect(client, userdata, rc):
    global remote_connected, remote_disconnect_time, remote_retry_count
    with lock:
        remote_connected = False
        if remote_disconnect_time is None:
            remote_disconnect_time = time.time()
        remote_retry_count += 1
        print(f"[SERVER] Connection lost (#{remote_retry_count})")


def on_remote_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload
    sender = extract_sender(topic)
    payload_str = payload.decode("utf-8", errors="ignore")

    with lock:
        if local_client_username and sender == local_client_username:
            return

        if topic.startswith("/mschat/status/") and sender:
            new_status = "offline" if "offline" in payload_str.lower() else "online"
            presence_cache[sender] = new_status

            if new_status == "online":
                flush_queue()

        local_client.publish(topic, payload, qos=msg.qos, retain=msg.retain)


# Control loop: Periodic refetch + Watchdog of offline state
def background_worker():
    global all_offline_notified, remote_retry_count
    last_refresh_time = time.time()

    while True:
        time.sleep(1.0)
        now = time.time()

        with lock:
            # 1. Periodic refetch list of clients on server
            if remote_connected and (now - last_refresh_time >= REFRESH_INTERVAL):
                last_refresh_time = now
                remote_client.unsubscribe("/mschat/status/#")
                remote_client.subscribe("/mschat/status/#", qos=1)

            # 2. Watchdog: if server not answering
            if not remote_connected and not all_offline_notified:
                elapsed = (now - remote_disconnect_time) if remote_disconnect_time else 0
                retries = int(elapsed / 4.0)

                if elapsed >= OFFLINE_TIMEOUT or retries >= MAX_RETRIES:
                    print(f"[TIMEOUT] Server not available ({elapsed:.0f}s). Mark all users as OFFLINE.")
                    for user in list(presence_cache.keys()):
                        if user != local_client_username:
                            local_client.publish(f"/mschat/status/{user}", b"offline", qos=1, retain=True)
                    all_offline_notified = True


# Init MQTT clients
try:
    local_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id="agent_local", clean_session=True)
    remote_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1, client_id="agent_remote", clean_session=False)
except (AttributeError, TypeError):
    local_client = mqtt.Client(client_id="agent_local", clean_session=True)
    remote_client = mqtt.Client(client_id="agent_remote", clean_session=False)


if LOCAL_USER:
    local_client.username_pw_set(LOCAL_USER, LOCAL_PASS)
if REMOTE_USER:
    remote_client.username_pw_set(REMOTE_USER, REMOTE_PASS)


def main():
    global remote_connected, remote_disconnect_time, remote_retry_count

    load_queue_from_disk()

    local_client.on_connect = on_local_connect
    local_client.on_message = on_local_message

    remote_client.on_connect = on_remote_connect
    remote_client.on_disconnect = on_remote_disconnect
    remote_client.on_message = on_remote_message

    worker = threading.Thread(target=background_worker, daemon=True)
    worker.start()

    local_client.connect(LOCAL_HOST, LOCAL_PORT, keepalive=60)
    local_client.loop_start()

    try:
        remote_client.connect(REMOTE_HOST, REMOTE_PORT, keepalive=60)
    except Exception as e:
        print(f"[WARN] Initial connection failed: {e}")
        remote_connected = False
        remote_disconnect_time = time.time()
        remote_retry_count = 1

    remote_client.loop_start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        local_client.loop_stop()
        remote_client.loop_stop()


if __name__ == "__main__":
    main()

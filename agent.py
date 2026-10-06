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

_forwarded_to_local = set()


def publish_to_local(topic, payload, qos=0, retain=False):
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    key = f"{topic}:{hash(payload)}"
    _forwarded_to_local.add(key)
    local_client.publish(topic, payload, qos=qos, retain=retain)


# --- Perzistence fronty ---
def save_queue_to_disk():
    try:
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(offline_queue, f, indent=2)
    except Exception as e:
        print(f"[CACHE] Error saving queue: {e}")


def load_queue_from_disk():
    global offline_queue
    if os.path.exists(QUEUE_FILE):
        try:
            with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                offline_queue = json.load(f)
            print(f"[CACHE] Loaded {len(offline_queue)} queued messages from disk.")
        except Exception as e:
            print(f"[CACHE] Error loading queue: {e}")
            offline_queue = []


# --- Pomocné funkce pro parsování témat ---
def extract_recipient(topic):
    # /mschat/user/<recipient>/<sender>
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


# --- Odbavení fronty zpráv ---
def flush_queue():
    global offline_queue
    if not remote_connected or not offline_queue:
        return

    remaining = []
    sent_count = 0

    for item in offline_queue:
        recipient = item.get("recipient")
        payload = item["payload"].encode("utf-8") if isinstance(item["payload"], str) else item["payload"]

        if not recipient:
            # Veřejná zpráva -> odeslat ihned
            remote_client.publish(item["topic"], payload, qos=item.get("qos", 1), retain=item.get("retain", False))
            sent_count += 1
        elif presence_cache.get(recipient) == "online":
            # Privátní zpráva, příjemce je online -> odeslat
            print(f"[QUEUE] Recipient '{recipient}' is online, sending queued message.")
            remote_client.publish(item["topic"], payload, qos=item.get("qos", 1), retain=item.get("retain", False))
            sent_count += 1
        else:
            # Příjemce stále offline -> nechat ve frontě
            remaining.append(item)

    if sent_count > 0:
        print(f"[QUEUE] Sent {sent_count} messages, {len(remaining)} still waiting.")

    offline_queue = remaining
    save_queue_to_disk()


# --- Callbacky: Lokální broker ---
def on_local_connect(client, userdata, flags, rc):
    if rc != 0:
        print(f"[ERROR] Cannot connect to local broker! Code: {rc}")
        return

    print(f"[LOCAL] Connected ({LOCAL_HOST}:{LOCAL_PORT})")
    client.subscribe("/mschat/#", qos=1)

    # V offline režimu poslat klientovi poslední známé stavy (Bod 2)
    with lock:
        if not remote_connected and presence_cache:
            print("[LOCAL] Server offline, sending cached user statuses to client...")
            for user, st in presence_cache.items():
                if user != local_client_username:
                    publish_to_local(f"/mschat/status/{user}", st, qos=1, retain=True)


def on_local_message(client, userdata, msg):
    """Zpracovává zprávy přijaté z lokálního brokeru.
    Rozlišuje:
      - Ozvěny vlastních publishů agenta (ignoruje)
      - Zprávy od React klienta (přeposílá na server)
    """
    global local_client_username
    topic = msg.topic
    payload_str = msg.payload.decode("utf-8", errors="ignore")

    with lock:
        # 1. Zkontrolovat, zda je to naše vlastní ozvěna
        key = f"{topic}:{hash(msg.payload)}"
        if key in _forwarded_to_local:
            _forwarded_to_local.discard(key)
            return

        # 2. Toto je zpráva od React klienta – zpracovat ji
        sender = extract_sender(topic)
        recipient = extract_recipient(topic)

        # Detekce loginu lokálního klienta
        if sender and sender != "anon":
            if topic.startswith("/mschat/status/") and sender:
                local_client_username = sender
                presence_cache[sender] = "offline" if "offline" in payload_str.lower() else "online"
            elif not local_client_username:
                local_client_username = sender

        # Server nedostupný -> uložit do offline fronty (Bod 1)
        if not remote_connected:
            print(f"[OFFLINE QUEUE] Server offline, saving: {topic}")
            offline_queue.append({
                "topic": topic,
                "payload": payload_str,
                "qos": msg.qos,
                "retain": msg.retain,
                "recipient": recipient
            })
            save_queue_to_disk()
            return

        # Příjemce privátní zprávy je offline -> pozdržet (Bod 2)
        if recipient and presence_cache.get(recipient) == "offline":
            print(f"[OFFLINE RECIPIENT] '{recipient}' is offline, message queued.")
            offline_queue.append({
                "topic": topic,
                "payload": payload_str,
                "qos": msg.qos,
                "retain": msg.retain,
                "recipient": recipient
            })
            save_queue_to_disk()
            return

        # Vše OK -> přeposlat na školní server
        print(f"[-> SERVER] {topic}")
        remote_client.publish(topic, msg.payload, qos=msg.qos, retain=msg.retain)


# --- Callbacky: Vzdálený školní server ---
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
        print(f"[SERVER] Connection lost (attempt #{remote_retry_count})")


def on_remote_message(client, userdata, msg):
    """Zpracovává zprávy přijaté ze školního serveru.
    Přeposílá je na lokální broker pro React klienta.
    Zprávy, které původně odeslal lokální klient, nepřeposílá zpět (zamezení smyčky).
    """
    topic = msg.topic
    payload = msg.payload
    sender = extract_sender(topic)
    payload_str = payload.decode("utf-8", errors="ignore")

    with lock:
        # Zprávu, kterou poslal náš lokální klient, nepřeposíláme zpět
        if local_client_username and sender == local_client_username:
            return

        # Aktualizace stavů uživatelů
        if topic.startswith("/mschat/status/") and sender:
            new_status = "offline" if "offline" in payload_str.lower() else "online"
            presence_cache[sender] = new_status

            # Pokud se uživatel přihlásil, odeslat čekající zprávy (Bod 2)
            if new_status == "online":
                flush_queue()

        # Přeposlat zprávu lokálnímu klientovi (označenou, aby ji agent ignoroval)
        publish_to_local(topic, payload, qos=msg.qos, retain=msg.retain)


# --- Řídící smyčka: Periodická obnova (Bod 2) + Watchdog (Bod 3) ---
def background_worker():
    global all_offline_notified
    last_refresh_time = time.time()

    while True:
        time.sleep(1.0)
        now = time.time()

        with lock:
            # Periodická obnova seznamu uživatelů ze serveru (Bod 2)
            if remote_connected and (now - last_refresh_time >= REFRESH_INTERVAL):
                last_refresh_time = now
                print("[REFRESH] Requesting fresh user statuses from server...")
                remote_client.unsubscribe("/mschat/status/#")
                remote_client.subscribe("/mschat/status/#", qos=1)

            # Watchdog: server nedostupný příliš dlouho -> všichni offline (Bod 3)
            if not remote_connected and not all_offline_notified:
                elapsed = (now - remote_disconnect_time) if remote_disconnect_time else 0
                if elapsed >= OFFLINE_TIMEOUT:
                    print(f"[TIMEOUT] Server unreachable ({elapsed:.0f}s). Marking all users OFFLINE.")
                    for user in list(presence_cache.keys()):
                        if user != local_client_username:
                            publish_to_local(f"/mschat/status/{user}", b"offline", qos=1, retain=True)
                    all_offline_notified = True


# --- Inicializace MQTT klientů ---
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
    print("=== MQTT Agent starting ===")

    load_queue_from_disk()

    local_client.on_connect = on_local_connect
    local_client.on_message = on_local_message

    remote_client.on_connect = on_remote_connect
    remote_client.on_disconnect = on_remote_disconnect
    remote_client.on_message = on_remote_message

    # Spuštění background workeru
    worker = threading.Thread(target=background_worker, daemon=True)
    worker.start()

    # Připojení k lokálnímu brokeru
    local_client.connect(LOCAL_HOST, LOCAL_PORT, keepalive=60)
    local_client.loop_start()

    # Připojení ke školnímu serveru
    try:
        remote_client.connect(REMOTE_HOST, REMOTE_PORT, keepalive=60)
    except Exception as e:
        print(f"[WARN] Initial connection to server failed: {e}")
        remote_connected = False
        remote_disconnect_time = time.time()
        remote_retry_count = 1

    remote_client.loop_start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping agent...")
        local_client.loop_stop()
        remote_client.loop_stop()


if __name__ == "__main__":
    main()

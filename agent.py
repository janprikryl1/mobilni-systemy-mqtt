import json
import os
import threading
import time
import warnings
import paho.mqtt.client as mqtt

warnings.filterwarnings("ignore", category=DeprecationWarning)

# Konfigurace lokálního brokeru
LOCAL_HOST = os.getenv("LOCAL_HOST", "localhost")
LOCAL_PORT = int(os.getenv("LOCAL_PORT", 1883))
LOCAL_USER = os.getenv("LOCAL_USER", "server")
LOCAL_PASS = os.getenv("LOCAL_PASS", "Broker")

# Konfigurace vzdáleného školního brokeru
REMOTE_HOST = os.getenv("REMOTE_HOST", "pcfeib425t.vsb.cz")
REMOTE_PORT = int(os.getenv("REMOTE_PORT", 1883))
REMOTE_USER = os.getenv("REMOTE_USER", "server")
REMOTE_PASS = os.getenv("REMOTE_PASS", "Broker")

# Časové limity a periody
OFFLINE_TIMEOUT = 20.0       # Bod 3: čas v sekundách pro označení všech za offline
MAX_RETRIES = 5              # Bod 3: maximální počet pokusů
REFRESH_INTERVAL = 30.0      # Bod 2: perioda obnovy seznamu uživatelů ze serveru
QUEUE_FILE = "offline_queue.json"

# Stav agenta
lock = threading.RLock()
remote_connected = False
remote_disconnect_time = None
remote_retry_count = 0
all_offline_notified = False
local_client_username = None  # Detekuje se automaticky z lokálních zpráv

# Cache a fronta
presence_cache = {}          # username -> "online" / "offline"
offline_queue = []           # list slovníků: [{"topic": ..., "payload": ..., "qos": ..., "retain": ..., "recipient": ...}]


# --- Perzistence fronty ---
def save_queue_to_disk():
    try:
        with open(QUEUE_FILE, "w", encoding="utf-8") as f:
            json.dump(offline_queue, f, indent=2)
    except Exception as e:
        print(f"[CACHE] Chyba při ukládání fronty na disk: {e}")


def load_queue_from_disk():
    global offline_queue
    if os.path.exists(QUEUE_FILE):
        try:
            with open(QUEUE_FILE, "r", encoding="utf-8") as f:
                offline_queue = json.load(f)
            print(f"[CACHE] Načteno {len(offline_queue)} neodeslaných zpráv z disku.")
        except Exception as e:
            print(f"[CACHE] Chyba při načítání fronty z disku: {e}")
            offline_queue = []


# --- Pomocné funkce pro témata ---
def extract_recipient(topic):
    # Formát: /mschat/user/<recipient>/<sender>
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
    """
    Pokusí se odeslat zprávy z fronty:
    - Veřejné zprávy odešle ihned, jakmile je server připojen.
    - Privátní zprávy odešle jen pro uživatele, kteří jsou prokazatelně 'online'.
    (Bod 1 a Bod 2 zadání)
    """
    global offline_queue
    if not remote_connected or not offline_queue:
        return

    remaining = []
    sent_count = 0

    for item in offline_queue:
        recipient = item.get("recipient")
        payload = item["payload"].encode("utf-8") if isinstance(item["payload"], str) else item["payload"]

        # Veřejná zpráva -> odeslat ihned
        if not recipient:
            remote_client.publish(item["topic"], payload, qos=item.get("qos", 1), retain=item.get("retain", False))
            sent_count += 1
        # Privátní zpráva -> odeslat pouze pokud je příjemce ONLINE
        elif presence_cache.get(recipient) == "online":
            print(f"[FRONTA] Příjemce '{recipient}' je online. Odesílám čekající zprávu...")
            remote_client.publish(item["topic"], payload, qos=item.get("qos", 1), retain=item.get("retain", False))
            sent_count += 1
        else:
            # Příjemce je stále offline -> zpráva zůstává čekat ve frontě
            remaining.append(item)

    if sent_count > 0:
        print(f"[FRONTA] Odesláno {sent_count} zpráv na server, zbývá {len(remaining)} čekajících.")

    offline_queue = remaining
    save_queue_to_disk()


# --- Callbacky: Lokální broker (klient) ---
def on_local_connect(client, userdata, flags, rc):
    if rc != 0:
        print(f"[LOKÁL] CHYBA PŘIPOJENÍ k lokálnímu brokeru! Návratový kód: {rc} (5 = neautorizováno - špatné jméno/heslo)")
        return

    print(f"[LOKÁL] Úspěšně připojeno k lokálnímu brokeru ({LOCAL_HOST}:{LOCAL_PORT})")
    client.subscribe("/mschat/#", qos=1)

    # V offline režimu vrátit lokálnímu klientovi poslední uložený stav (Bod 2)
    with lock:
        if not remote_connected and presence_cache:
            print("[LOKÁL] Server je offline, posílám klientovi poslední uložený seznam stavů...")
            for user, st in presence_cache.items():
                if user != local_client_username:
                    client.publish(f"/mschat/status/{user}", st.encode("utf-8"), qos=1, retain=True)


def on_local_message(client, userdata, msg):
    global local_client_username
    topic = msg.topic
    sender = extract_sender(topic)
    recipient = extract_recipient(topic)
    payload_str = msg.payload.decode("utf-8", errors="ignore")

    # Pokud zpráva nepochází od lokálního klienta (např. jsme ji sami přeposlali ze serveru), ignorujeme ji
    if local_client_username and sender and sender != local_client_username and sender != "anon":
        return

    with lock:
        # Detekce uživatele lokálního klienta podle jeho statusu nebo odesílatele
        if topic.startswith("/mschat/status/") and sender:
            local_client_username = sender
            presence_cache[sender] = "offline" if "offline" in payload_str.lower() else "online"
        elif sender and not local_client_username and sender != "anon":
            local_client_username = sender

        # Pokud server není dostupný -> uložit do offline fronty (Bod 1)
        if not remote_connected:
            print(f"[OFFLINE FRONTA] Server nedostupný, ukládám: {topic}")
            offline_queue.append({
                "topic": topic,
                "payload": payload_str,
                "qos": msg.qos,
                "retain": msg.retain,
                "recipient": recipient
            })
            save_queue_to_disk()
            return

        # Pokud je příjemce privátní zprávy offline -> pozdržet ve frontě (Bod 2)
        if recipient and presence_cache.get(recipient) == "offline":
            print(f"[OFFLINE PŘÍJEMCE] Uživatel '{recipient}' je offline, zpráva čeká ve frontě.")
            offline_queue.append({
                "topic": topic,
                "payload": payload_str,
                "qos": msg.qos,
                "retain": msg.retain,
                "recipient": recipient
            })
            save_queue_to_disk()
            return

        # Vše v pořádku -> odeslat přímo na server
        print(f"[PŘEPOSLÁNO NA SERVER] {topic}")
        remote_client.publish(topic, msg.payload, qos=msg.qos, retain=msg.retain)


# --- Callbacky: Vzdálený školní server ---
def on_remote_connect(client, userdata, flags, rc):
    global remote_connected, remote_disconnect_time, remote_retry_count, all_offline_notified
    with lock:
        remote_connected = True
        remote_disconnect_time = None
        remote_retry_count = 0
        all_offline_notified = False
        print(f"[SERVER] Úspěšně připojeno ke vzdálenému serveru ({REMOTE_HOST}:{REMOTE_PORT})")

        # Odběr všech témat ze serveru
        client.subscribe("/mschat/#", qos=1)

        # Odeslat čekající veřejné zprávy a zkontrolovat frontu (Bod 1)
        flush_queue()


def on_remote_disconnect(client, userdata, rc):
    global remote_connected, remote_disconnect_time, remote_retry_count
    with lock:
        remote_connected = False
        if remote_disconnect_time is None:
            remote_disconnect_time = time.time()
        remote_retry_count += 1
        print(f"[SERVER] Ztráta spojení se serverem (pokus #{remote_retry_count})")


def on_remote_message(client, userdata, msg):
    topic = msg.topic
    payload = msg.payload
    sender = extract_sender(topic)
    payload_str = payload.decode("utf-8", errors="ignore")

    with lock:
        # Zprávu, kterou jsme sami poslali z lokálu, nepřeposíláme zpět na lokál
        if local_client_username and sender == local_client_username:
            return

        # Zpracování změn stavů ostatních uživatelů (/mschat/status/<user>)
        if topic.startswith("/mschat/status/") and sender:
            new_status = "offline" if "offline" in payload_str.lower() else "online"
            presence_cache[sender] = new_status

            # Pokud se uživatel právě připojil (online), odešleme zprávy čekající ve frontě (Bod 2)
            if new_status == "online":
                flush_queue()

        # Přeposlat zprávu lokálnímu klientovi
        local_client.publish(topic, payload, qos=msg.qos, retain=msg.retain)


# --- Řídící smyčka: Periodická obnova (Bod 2) + Watchdog offline stavu (Bod 3) ---
def background_worker():
    global all_offline_notified, remote_retry_count
    last_refresh_time = time.time()

    while True:
        time.sleep(1.0)
        now = time.time()

        with lock:
            # 1. Periodické obnovování seznamu klientů na serveru (Bod 2)
            if remote_connected and (now - last_refresh_time >= REFRESH_INTERVAL):
                last_refresh_time = now
                print("[PERIODICKÁ OBNOVA] Vyžádání aktuálního seznamu uživatelů ze serveru...")
                remote_client.unsubscribe("/mschat/status/#")
                remote_client.subscribe("/mschat/status/#", qos=1)

            # 2. Watchdog: pokud server dlouho neodpovídá, nahlásit všichni offline (Bod 3)
            if not remote_connected and not all_offline_notified:
                elapsed = (now - remote_disconnect_time) if remote_disconnect_time else 0
                retries = int(elapsed / 4.0)  # odhad pokusů o reconnect

                if elapsed >= OFFLINE_TIMEOUT or retries >= MAX_RETRIES:
                    print(f"[TIMEOUT] Server nedostupný ({elapsed:.0f}s). Nastavuji všechny uživatele jako OFFLINE.")
                    for user in list(presence_cache.keys()):
                        if user != local_client_username:
                            local_client.publish(f"/mschat/status/{user}", b"offline", qos=1, retain=True)
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
    print("=== Startuji MQTT Agenta pro offline režim ===")

    load_queue_from_disk()

    local_client.on_connect = on_local_connect
    local_client.on_message = on_local_message

    remote_client.on_connect = on_remote_connect
    remote_client.on_disconnect = on_remote_disconnect
    remote_client.on_message = on_remote_message

    # Spuštění vlákna pro watchdog a periodickou obnovu
    worker = threading.Thread(target=background_worker, daemon=True)
    worker.start()

    # Připojení k lokálnímu brokeru
    local_client.connect(LOCAL_HOST, LOCAL_PORT, keepalive=60)
    local_client.loop_start()

    # Připojení ke vzdálenému serveru (ošetřeno i pro případ, kdy je server offline hned od startu)
    try:
        remote_client.connect(REMOTE_HOST, REMOTE_PORT, keepalive=60)
    except Exception as e:
        print(f"[VAROVÁNÍ] Počáteční připojení k serveru selhalo: {e}")
        remote_connected = False
        remote_disconnect_time = time.time()
        remote_retry_count = 1

    remote_client.loop_start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nUkončuji agenta...")
        local_client.loop_stop()
        remote_client.loop_stop()


if __name__ == "__main__":
    main()

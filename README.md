# IoT-Enabled Smart Ration Dispenser (PDS Model)

An autonomous, fraud-proof Smart Ration Dispenser powered by **ESP32-WROOM-32**, dual-factor biometric authentication (**MFRC522 RFID + R307S Optical Fingerprint**), precise load-cell closed-loop dispensing (**HX711**), and gravity-fed mini hopper auto-refill. The system features bilingual voice guidance (Tamil & English) via **DFPlayer Mini**, a full-stack **Node.js/SQLite Edge Backend**, and a real-time **Web Dashboard & Virtual Hardware Simulator**.

---

## System Architecture

```text
Main Hoppers (Rice, Wheat, Dal, Sugar)
         │
    Gravity Pipes (Auto-Refill)
         │
    Mini Hoppers (4x Buffer Tanks)
         │
  Servo Gates (4x MG995 Flaps)
         │
   Common Funnel
         │
[IR-1 Container Detection]
         │
Collection Container on Load Cell Platform (HX711)
```

---

## Project Structure

```text
ration/
├── backend/                  # Node.js + Express + WebSocket Server
│   ├── server.js             # HTTP REST endpoints & real-time telemetry broadcaster
│   ├── db.js                 # SQLite database initialization & seed data
│   ├── package.json          # Node dependencies (express, ws, cors)
│   └── ration.db             # Local zero-config persistent database
│
├── frontend/                 # Modern Dark-Themed Web Dashboard
│   ├── index.html            # Single-page dashboard & schematic viewer
│   ├── style.css             # Glassmorphic responsive design system
│   ├── app.js                # WebSocket client & real-time UI synchronization
│   └── simulator.js          # Built-in Virtual Hardware Bench (Test without hardware!)
│
├── firmware/                 # ESP32 C++ / Arduino Firmware
│   ├── smart_ration_dispenser.ino # Master state machine sketch
│   ├── config.h              # Conflict-free pinout mapping & Wi-Fi configuration
│   ├── audio_manager.h       # DFPlayer Mini bilingual driver (Tamil/English)
│   ├── display_manager.h     # LCD 20x4 I2C display driver
│   ├── weighing_manager.h    # HX711 continuous weight & auto-tare driver
│   ├── servo_controller.h    # 4x MG995 servo gate flap controller
│   ├── biometric_manager.h   # R307S fingerprint sensor 2FA driver
│   └── api_client.h          # REST HTTP client with offline flash caching
│
├── audio/                    # Voice Prompts & TTS Generator
│   ├── tracks_manifest.json  # Audio track specifications (English & Tamil)
│   └── generate_audio.py     # Script to generate MP3 files for MicroSD card
│
└── docs/                     # Engineering Guides
    ├── CIRCUIT_DIAGRAM_AND_WIRING.md # Pinout table & power distribution scheme
    ├── LOAD_CELL_CALIBRATION_GUIDE.md # HX711 calibration instructions & sketch
    └── DFPLAYER_SETUP_GUIDE.md        # MicroSD formatting & audio hierarchy
```

---

## Getting Started

### 1. Run the Backend & Web Dashboard
```bash
cd backend
npm install
node server.js
```
Open **`http://localhost:3001`** in your web browser.

### 2. Test Without Hardware (Virtual Simulator)
1. Click the **🎮 Hardware Simulator** tab in the web dashboard.
2. Select an enrolled card (e.g. `Muthu Krishnan (E23A4B5C)`).
3. Click **Tap RFID Card** → **Match Fingerprint** → Select **Rice 500g**.
4. Click **Place Container on Scale (IR-1)**.
5. Click **Start Dispensing**:
   - Watch the animated servo gate flap rotate open (65°).
   - Watch grain flow down the common funnel.
   - Watch the HX711 load cell weight gauge accumulate grams in real-time.
   - Watch the gate snap closed at 500.0g cutoff.
   - See the transaction logged, stock deducted, and card locked from duplicate collection.

### 3. Flash the ESP32 Physical Hardware
1. Open `firmware/smart_ration_dispenser.ino` in the Arduino IDE.
2. Install the required Arduino libraries via Library Manager:
   - `MFRC522` by GithubCommunity
   - `Adafruit Fingerprint Sensor Library`
   - `HX711` by Bogdan Necula
   - `ESP32Servo` by Kevin Harrington
   - `LiquidCrystal_I2C` by Frank de Brabander
   - `DFRobotDFPlayerMini` by DFRobot
   - `ArduinoJson` (v6 or v7) by Benoit Blanchon
3. Update your Wi-Fi SSID and backend server IP in `firmware/config.h`:
   ```cpp
   #define WIFI_SSID         "Your_WiFi_SSID"
   #define WIFI_PASSWORD     "Your_WiFi_Password"
   #define BACKEND_SERVER    "http://<YOUR_COMPUTER_IP>:3001"
   ```
4. Wire the components according to `docs/CIRCUIT_DIAGRAM_AND_WIRING.md`.
5. Select **ESP32 Dev Module** and upload!

# Smart Ration Dispenser: Circuit Diagram & Wiring Guide

This guide provides the complete electrical wiring specification, pinout assignments, and power distribution scheme for the **IoT Smart Ration Dispenser** based on the **ESP32-WROOM-32**.

---

## 1. Master Pinout Table

| Peripheral | Module Pin | ESP32 GPIO | Voltage Level | Notes / Function |
| :--- | :--- | :--- | :--- | :--- |
| **RFID (MFRC522)** | 3.3V | 3V3 | 3.3V | ⚠️ **DO NOT CONNECT TO 5V** (Damages MFRC522) |
| | GND | GND | GND | Common ground |
| | RST | GPIO 4 | 3.3V | Reset pin |
| | SDA (SS) | GPIO 5 | 3.3V | VSPI Chip Select |
| | SCK | GPIO 18 | 3.3V | VSPI Serial Clock |
| | MISO | GPIO 19 | 3.3V | VSPI Master In Slave Out |
| | MOSI | GPIO 23 | 3.3V | VSPI Master Out Slave In |
| **Optical Fingerprint (R307S)** | VCC (Red) | 5V / 3.3V | 3.3V - 5V | Sensor power |
| | GND (Black) | GND | GND | Ground |
| | TX (Green) | GPIO 16 | 3.3V | ESP32 Hardware UART2 RX |
| | RX (White) | GPIO 17 | 3.3V | ESP32 Hardware UART2 TX |
| **Audio Module (DFPlayer Mini)** | VCC | 5V | 5V | Clean 5V power |
| | GND | GND | GND | Ground |
| | RX | GPIO 27 (TX1) | 3.3V via 1kΩ | **Add 1kΩ inline resistor** to reduce noise |
| | TX | GPIO 26 (RX1) | 3.3V | Directly to ESP32 RX1 |
| | SPK_1 / SPK_2 | Speaker | - | Connect to 8Ω 3W Speaker |
| **Load Cell (HX711 Amplifier)** | VCC | 5V or 3.3V | 3.3V - 5V | Power for HX711 |
| | GND | GND | GND | Ground |
| | DT (DOUT) | GPIO 32 | 3.3V | ADC1 pin (Safe with Wi-Fi) |
| | SCK (CLK) | GPIO 33 | 3.3V | ADC1 pin (Clock signal) |
| **IR Sensor 1 (Container Check)** | VCC | 5V or 3.3V | 3.3V - 5V | Sensor power |
| | GND | GND | GND | Ground |
| | OUT | GPIO 34 | 3.3V | Input Only (ADC1). LOW = Container present |
| **IR Sensor 2 (Hopper Level)** | VCC | 5V or 3.3V | 3.3V - 5V | Sensor power |
| | GND | GND | GND | Ground |
| | OUT | GPIO 35 | 3.3V | Input Only (ADC1). LOW = Hopper level OK |
| **Servo 1: Rice Gate (MG995)** | Signal (Orange) | GPIO 13 | 3.3V PWM | PWM Gate Flap Control |
| | VCC (Red) | **5V Servo Rail** | **5V (High Current)** | **DO NOT power from ESP32 5V/VIN!** |
| | GND (Brown) | GND | GND | Common ground |
| **Servo 2: Wheat Gate (MG995)**| Signal (Orange) | GPIO 14 | 3.3V PWM | PWM Gate Flap Control |
| | VCC (Red) | **5V Servo Rail** | **5V (High Current)** | Connect to DC-DC Buck converter |
| | GND (Brown) | GND | GND | Common ground |
| **Servo 3: Dal Gate (MG995)** | Signal (Orange) | GPIO 25 | 3.3V PWM | PWM Gate Flap Control |
| | VCC (Red) | **5V Servo Rail** | **5V (High Current)** | Connect to DC-DC Buck converter |
| | GND (Brown) | GND | GND | Common ground |
| **Servo 4: Sugar Gate (MG995)**| Signal (Orange) | GPIO 12 | 3.3V PWM | PWM Gate Flap Control |
| | VCC (Red) | **5V Servo Rail** | **5V (High Current)** | Connect to DC-DC Buck converter |
| | GND (Brown) | GND | GND | Common ground |
| **I2C LCD 20x4 Display** | VCC | 5V | 5V | LCD backlight power |
| | GND | GND | GND | Ground |
| | SDA | GPIO 21 | 3.3V / 5V | I2C Data |
| | SCL | GPIO 22 | 3.3V / 5V | I2C Clock |

---

## 2. Power Supply Architecture (Preventing Brownouts)

> [!CAUTION]
> **Servo Current Surge Warning**:
> A single MG995 or MG996R servo motor can draw up to **1.5 Amps to 2.5 Amps peak stall current** when actuating a mechanical flap under grain pressure. If powered from the ESP32's onboard 5V pin or a USB port, the voltage will drop, immediately causing the ESP32 to brownout reset (`rst:0x10 (RTCWDT_RTC_RESET)`).

### Recommended Power Delivery:
1. **12V 5A Main Power Adapter (SMPS)** feeds the machine.
2. Step-down **LM2596 (or XL4015) DC-DC Buck Converter 1** set to **5.0V @ 3A-5A**:
   - Dedicated strictly to the **4 Servo Motors** (Red VCC wires).
   - Place a **1000 µF 16V electrolytic capacitor** across the 5V servo power rail to absorb back-EMF spikes.
3. Step-down **DC-DC Converter 2 / USB 5V** set to **5.0V @ 2A**:
   - Powers the ESP32 `VIN` pin, DFPlayer Mini, and LCD backlight.
4. **Common Ground (GND)**:
   - Connect the GND of the ESP32, Buck Converters, Servos, HX711, and Sensors together to form a solid reference plane.

---

## 3. Load Cell & HX711 Color Coding

| Load Cell Wire Color | HX711 Terminal | Signal Description |
| :--- | :--- | :--- |
| **Red** | E+ (Excitation +) | Positive excitation voltage |
| **Black** | E- (Excitation -) | Ground / Negative excitation |
| **Green** | A+ (Signal +) | Output signal positive |
| **White** | A- (Signal -) | Output signal negative |
| **Shield (Bare wire)**| GND | Cable electromagnetic shielding |

---

## 4. DFPlayer Mini Audio Clean Wiring

1. Connect a **1kΩ (or 1.2kΩ) resistor** in series between ESP32 **GPIO 27** and DFPlayer **RX pin**. This drops the 3.3V/5V logic edge and prevents clicking/humming noise during playback.
2. Keep speaker wires twisted and away from the servo power lines to avoid inductive noise.

---

## 5. Supabase Cloud IoT Integration & Pin-to-Database Mapping

The ESP32 communicates securely with **Supabase PostgreSQL** via the PostgREST HTTPS API.

### Hardware Event to Supabase REST Endpoint Mapping:

```text
┌───────────────────────┐                               ┌───────────────────────────┐
│  Hardware Peripheral  │ ──► [Edge Safety Validation] ──► │  Supabase Cloud Database  │
└───────────────────────┘                               └───────────────────────────┘
   MFRC522 (GPIO 5,18,19,23) ──► Read Card UID         ──► GET /rest/v1/users?card_uid=eq.{UID}
   R307S (GPIO 16, 17)       ──► Verify Fingerprint    ──► GET /rest/v1/users?fingerprint_id=eq.{ID}
   HX711 (GPIO 13, 2)        ──► Target Cutoff Reached ──┐
   MG995 Servos (PCA9685)    ──► Gate Closed Safely    ──┴─► POST /rest/v1/transactions
   Enroll Btn (GPIO 27)      ──► Link UID + Finger ID  ──► POST /rest/v1/users
```

### 1. Verification Query (`GET /users`):
```http
GET https://<YOUR-PROJECT-ID>.supabase.co/rest/v1/users?card_uid=eq.{SCANNED_UID}&select=*
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
```
- **Response**: Returns citizen profile (`name`, `fingerprint_id`, `eligible`).
- **Safety Rule**: If `eligible == false` (quota already claimed this month), the dispensing gates remain **LOCKED**.

### 2. Transaction Audit Log (`POST /transactions`):
```http
POST https://<YOUR-PROJECT-ID>.supabase.co/rest/v1/transactions
Content-Type: application/json
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>

{
  "user_id": "E23A4B5C",
  "item_dispensed": "Rice",
  "status": "SUCCESS"
}
```

### 3. New Citizen Enrollment (`POST /users`):
```http
POST https://<YOUR-PROJECT-ID>.supabase.co/rest/v1/users
Content-Type: application/json
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>

{
  "card_uid": "99AA88BB",
  "fingerprint_id": 5,
  "name": "Rajesh Kumar",
  "eligible": true
}
```


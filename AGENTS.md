# AGENTS.md — IoT Smart Ration Dispenser System

## Project Overview

This repository contains the firmware, backend integration, and supporting code for an **IoT Smart Ration Dispenser System** built around an **ESP32-WROOM-32**.

The system provides:

- RFID-based user authentication
- Fingerprint-based user authentication
- Hardware-triggered user enrollment
- Physical commodity selection
- Container-presence verification
- Hopper stock verification
- Servo-controlled dispensing
- Supabase PostgreSQL integration
- Automated transaction logging

The ESP32 is the primary edge controller. Supabase provides the cloud database and REST API layer.

---

## Core Architecture

```text
                 ┌─────────────────────┐
                 │      SUPABASE       │
                 │ PostgreSQL + REST   │
                 └──────────┬──────────┘
                            │ HTTPS
                            │
                    Local Wi-Fi Network
                            │
                 ┌──────────▼──────────┐
                 │   ESP32-WROOM-32    │
                 │                     │
                 │ State Machine       │
                 │ Authentication      │
                 │ Selection           │
                 │ Safety Checks       │
                 │ Dispensing          │
                 │ Cloud Logging       │
                 └───┬────┬────┬──────┘
                     │    │    │
              ┌──────┘    │    └─────────────┐
              │            │                  │
            RC522         R307S            LCD/Input
            RFID       Fingerprint
              │            │
              └──────┬─────┘
                     │
                 Authentication
                     │
              ┌──────▼──────┐
              │  3 Servos   │
              │ Rice/Dal/   │
              │ Wheat Gates │
              └─────────────┘
```

---

## Hardware Pin Mapping

| Component | Function | GPIO |
|---|---|---:|
| LCD | SDA | 21 |
| LCD | SCL | 22 |
| RC522 | SS | 5 |
| RC522 | RST | 4 |
| RC522 | SCK | 18 |
| RC522 | MISO | 19 |
| RC522 | MOSI | 23 |
| R307S | RX2 | 16 |
| R307S | TX2 | 17 |
| Servo 1 | Rice Gate | 13 |
| Servo 2 | Dal Gate | 12 |
| Servo 3 | Wheat Gate | 14 |
| IR Sensor 1 | Container Detection | 25 |
| IR Sensor 2 | Hopper Stock Check | 26 |
| Button 1 | Enrollment | 27 |
| Button 2 | Commodity Selection | 32 |
| Button 3 | Confirm / Dispense | 33 |

LCD I2C address: `0x27`

---

## Functional Rules

### Authentication

A user can authenticate using:

1. RFID UID
2. Fingerprint ID

RFID lookup:

```text
GET /rest/v1/users?card_uid=eq.{UID}
```

Fingerprint lookup:

```text
GET /rest/v1/users?fingerprint_id=eq.{ID}
```

Authentication succeeds only when a matching user exists and:

```text
eligible == true
```

Never bypass the eligibility check in normal dispensing logic.

---

### Enrollment

Pushbutton 1 on GPIO 27 enters enrollment mode.

Expected flow:

```text
Enrollment Button
      ↓
Read RFID UID
      ↓
Fingerprint Scan #1
      ↓
Fingerprint Scan #2
      ↓
Create Fingerprint Template
      ↓
Store Template in R307S
      ↓
Assign Fingerprint ID
      ↓
POST User Record to Supabase
```

Do not store raw fingerprint templates in Supabase unless the architecture is deliberately redesigned for that purpose. The R307S should remain responsible for local fingerprint template storage.

---

### Commodity Selection

Pushbutton 2 on GPIO 32 cycles through:

```text
Rice → Dal → Wheat → Rice → ...
```

Pushbutton 3 on GPIO 33 confirms the selected commodity.

---

### Safety Checks

Dispensing must not occur unless:

```text
Container Present
AND
Hopper Stock Available
AND
User Authorized
AND
Commodity Selected
```

Container detection uses GPIO 25.

Hopper stock detection uses GPIO 26.

---

### Dispensing

Servo mapping:

```text
Rice  → GPIO 13
Dal   → GPIO 12
Wheat → GPIO 14
```

Normal dispensing behavior:

```text
Selected Servo → 90°
Wait → 3 seconds
Selected Servo → 0°
```

Only the selected commodity servo should be activated.

---

### Transaction Logging

Completed dispensing operations should be logged to:

```text
POST /rest/v1/transactions
```

Minimum transaction data:

```json
{
  "user_id": "...",
  "item_dispensed": "Rice",
  "status": "SUCCESS"
}
```

Possible statuses include:

```text
SUCCESS
FAILED
NO_CONTAINER
OUT_OF_STOCK
UNAUTHORIZED
```

Use consistent status values throughout the project.

---

## Supabase Schema

### `users`

```text
id              UUID
card_uid        TEXT UNIQUE
fingerprint_id  INT UNIQUE
name            TEXT
eligible        BOOLEAN DEFAULT true
created_at      TIMESTAMP
```

### `transactions`

```text
id              UUID
user_id         TEXT
item_dispensed  TEXT
status          TEXT
timestamp       TIMESTAMP
```

---

## Firmware State Machine

Prefer an explicit state-machine architecture.

Recommended states:

```cpp
enum SystemState {
    STATE_IDLE,
    STATE_ENROLLMENT,
    STATE_AUTHENTICATION,
    STATE_SELECT_COMMODITY,
    STATE_SAFETY_CHECK,
    STATE_DISPENSING,
    STATE_LOG_TRANSACTION,
    STATE_ERROR
};
```

Expected high-level transition:

```text
IDLE
 │
 ├── Enrollment Button → ENROLLMENT → IDLE
 │
 └── RFID/Fingerprint
          ↓
    AUTHENTICATION
          │
       Authorized
          ↓
    SELECT_COMMODITY
          ↓
     SAFETY_CHECK
          ↓
      DISPENSING
          ↓
   LOG_TRANSACTION
          ↓
         IDLE
```

Keep hardware-specific operations separated from cloud/API logic wherever practical.

---

## Communication Interfaces

### I2C

LCD:

```text
SDA → GPIO 21
SCL → GPIO 22
Address → 0x27
```

### SPI

RC522:

```text
SCK  → GPIO 18
MISO → GPIO 19
MOSI → GPIO 23
SS   → GPIO 5
RST  → GPIO 4
```

### UART

R307S:

```text
RX2 → GPIO 16
TX2 → GPIO 17
```

Use ESP32 hardware `Serial2`.

### PWM

MG995S servos:

```text
Rice  → GPIO 13
Dal   → GPIO 12
Wheat → GPIO 14
```

### Digital GPIO

IR sensors:

```text
Container → GPIO 25
Hopper    → GPIO 26
```

Buttons:

```text
Enrollment → GPIO 27
Select     → GPIO 32
Confirm    → GPIO 33
```

Buttons use internal pull-ups unless the hardware design is changed.

---

## Coding Guidelines

### 1. Keep the main loop simple

Avoid putting the complete application workflow into a large monolithic `loop()` function.

Prefer:

```text
loop()
  ↓
readInputs()
  ↓
processState()
  ↓
updateOutputs()
```

### 2. Separate responsibilities

Recommended logical modules:

```text
RFID Manager
Fingerprint Manager
Display Manager
Button/Input Manager
Servo Manager
Sensor Manager
Wi-Fi Manager
Supabase/API Manager
Authentication Manager
Transaction Manager
State Machine
```

### 3. Avoid blocking delays where possible

The 3-second dispensing interval can initially use `millis()` rather than a long `delay()` so that the controller remains responsive.

### 4. Debounce buttons

Buttons should not generate multiple logical events from a single physical press.

### 5. Validate cloud responses

Never assume an HTTP request succeeded.

Check:

```text
Wi-Fi connected
HTTP status code
Response body
Expected user/transaction record
```

### 6. Fail safely

If authentication, safety verification, or critical hardware validation fails:

```text
Do not open the servo.
```

---

## Security Guidelines

Never commit:

- Wi-Fi passwords
- Supabase secret keys
- Private API keys
- Personal credentials

Use configuration/environment mechanisms instead.

For Supabase:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
```

HTTPS must be used for cloud communication.

Supabase Row Level Security should be configured appropriately before production deployment.

Do not expose privileged service-role keys in ESP32 firmware.

---

## Hardware Safety

### Servo Power

MG995S servos can draw substantial current.

Do not power three MG995S servos directly from the ESP32's 3.3 V rail.

Use:

```text
External Servo Power Supply
          │
          ├── Servo 1
          ├── Servo 2
          └── Servo 3

Common GND
    │
    └── ESP32 GND
```

ESP32 GPIO pins should provide control signals only.

### Sensor Logic

IR sensor modules can have different active HIGH/LOW behavior. Define the sensor polarity explicitly in firmware rather than assuming it.

---

## Error Handling

The firmware should handle:

```text
RFID read failure
Fingerprint mismatch
Unknown user
Ineligible user
Container absent
Hopper empty
Wi-Fi failure
Supabase failure
Duplicate RFID
Duplicate fingerprint ID
Servo failure
```

The system should return to a safe state after recoverable errors.

The default safe condition is:

```text
All commodity gates CLOSED
```

---

## API Conventions

Supabase REST endpoint pattern:

```text
https://<project-ref>.supabase.co/rest/v1/<table>
```

Typical headers:

```http
apikey: <SUPABASE_ANON_KEY>
Authorization: Bearer <SUPABASE_ANON_KEY>
Content-Type: application/json
```

For insertion where the created record is required:

```http
Prefer: return=representation
```

Do not construct SQL strings inside the ESP32 application for routine operations. Use the Supabase REST interface.

---

## Testing Priorities

Test in the following order:

### Hardware

1. LCD
2. RFID
3. Fingerprint sensor
4. Individual servo
5. IR container sensor
6. IR hopper sensor
7. Buttons

### Network

1. Wi-Fi connection
2. Supabase connectivity
3. User GET request
4. User POST request
5. Transaction POST request

### Application

1. Unauthorized RFID
2. Unauthorized fingerprint
3. Eligible user
4. Ineligible user
5. Enrollment
6. Commodity cycling
7. Container absent
8. Hopper empty
9. Successful dispensing
10. Transaction logging
11. Network failure during authentication
12. Network failure during logging

---

## Development Principle

The system is a **safety-first edge-controlled IoT application**.

The cloud should determine user/account information and provide audit storage, while the ESP32 should retain direct control over:

```text
Sensors
Authentication peripherals
User interface
Safety checks
Servo actuation
State transitions
```

No cloud/API response should directly cause a dispensing action without local safety validation.

---

## Expected Repository Organization

A suitable project organization is:

```text
smart-ration-dispenser/
│
├── firmware/
│   ├── src/
│   │   ├── main.cpp
│   │   ├── rfid_manager.*
│   │   ├── fingerprint_manager.*
│   │   ├── display_manager.*
│   │   ├── servo_manager.*
│   │   ├── sensor_manager.*
│   │   ├── button_manager.*
│   │   ├── wifi_manager.*
│   │   ├── supabase_manager.*
│   │   └── state_machine.*
│   │
│   └── include/
│
├── database/
│   └── schema.sql
│
├── docs/
│
├── README.md
└── AGENTS.md
```

This structure is a guideline; preserve an existing repository structure if one is already established.

---

## Agent Instructions

When modifying this project:

1. Preserve the documented GPIO mapping unless a hardware redesign is explicitly requested.
2. Preserve the three-commodity model: **Rice, Dal, Wheat**.
3. Do not remove either RFID or fingerprint authentication without explicit instruction.
4. Never bypass the `eligible` check.
5. Never activate a dispensing servo without local safety checks.
6. Keep container detection and hopper stock verification separate.
7. Keep Supabase credentials out of source control.
8. Validate HTTP responses and handle network failures.
9. Keep servo outputs in a safe closed state during startup and errors.
10. Avoid unnecessary architectural changes when implementing small fixes.
11. Update documentation when changing hardware pins, database schema, API behavior, or state-machine behavior.
12. Prefer modular, testable code over large monolithic functions.
13. Do not claim a transaction succeeded unless the dispensing sequence and intended logging behavior have actually completed.
14. Treat the ESP32 as the authoritative controller for physical safety and actuation.
15. Maintain compatibility with the ESP32-WROOM-32 target.

---

## Definition of Done

A feature is considered complete when:

- The implementation compiles for ESP32-WROOM-32.
- Relevant hardware interfaces are initialized correctly.
- Failure conditions are handled safely.
- No unauthorized dispensing path exists.
- Supabase requests use HTTPS and appropriate headers.
- Sensitive credentials are not committed.
- Transaction behavior is consistent with the database schema.
- Documentation is updated when behavior or interfaces change.

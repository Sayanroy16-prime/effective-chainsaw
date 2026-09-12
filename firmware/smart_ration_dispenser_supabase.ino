/**
 * Smart Ration Dispenser - Arduino IDE Code (Supabase / Edge REST API)
 * Hardware:
 *   - ESP32 Development Board (ESP32-WROOM-32)
 *   - RFID Reader MFRC522 (SDA: 5, RST: 4)
 *   - Fingerprint Sensor R307S (RX: 16, TX: 17)
 *   - 3x MG995 Servos (Rice: 13, Dal: 12, Wheat: 14)
 *   - 2x IR Sensors (Container: 25, Stock: 26)
 *   - 2x Pushbuttons (Select: 32, Confirm: 33)
 *   - 16x2 I2C LCD (0x27)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_Fingerprint.h>
#include <ESP32Servo.h>

// =========================================================
// Network & Supabase / Local Backend Credentials
// =========================================================
// Note: To use the included local backend, set:
//   SUPABASE_URL = "http://YOUR_COMPUTER_IP:3001/rest/v1"
// Or to use Cloud Supabase:
//   SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co/rest/v1"
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASS     = "YOUR_WIFI_PASSWORD";
const char* SUPABASE_URL  = "http://192.168.1.100:3001/rest/v1"; // Or Supabase Cloud URL
const char* SUPABASE_KEY   = "YOUR_SUPABASE_ANON_KEY";           // Any string if using local backend

// =========================================================
// Pin Assignments
// =========================================================
#define SS_PIN          5   // RFID SDA / Chip Select
#define RST_PIN         4   // RFID Reset
#define FINGER_RX       16  // ESP32 RX2 connects to R307S TX (Green wire)
#define FINGER_TX       17  // ESP32 TX2 connects to R307S RX (White wire)
#define IR_CONTAINER    25  // Active-LOW container presence sensor
#define IR_STOCK        26  // Active-LOW grain stock level sensor
#define BTN_SELECT      32  // Pushbutton to cycle commodity (with internal pullup)
#define BTN_CONFIRM     33  // Pushbutton to confirm selection (with internal pullup)

const int SERVO_PINS[3] = {13, 12, 14}; // Servos for Rice, Dal, Wheat
const char* commodities[3] = {"Rice", "Dal", "Wheat"};

// =========================================================
// Peripheral Instances
// =========================================================
LiquidCrystal_I2C lcd(0x27, 16, 2);
MFRC522 rfid(SS_PIN, RST_PIN);
HardwareSerial fingerSerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerSerial);
Servo servos[3];

int selectedCommodity = 0;

// Function Prototypes
void resetDisplay();
int getFingerprintID();
bool verifyUserInSupabase(String id, bool isFingerprint);
void selectAndDispenseCommodity(String userID);
void logTransaction(String userID, const char* item);

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println(F("\n[INIT] Starting Smart Ration Dispenser..."));

  // 1. Pin Modes
  pinMode(BTN_SELECT, INPUT_PULLUP);
  pinMode(BTN_CONFIRM, INPUT_PULLUP);
  pinMode(IR_CONTAINER, INPUT);
  pinMode(IR_STOCK, INPUT);

  // 2. Initialize Servos (ESP32 PWM allocation)
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);

  for (int i = 0; i < 3; i++) {
    servos[i].setPeriodHertz(50);
    servos[i].attach(SERVO_PINS[i], 500, 2400);
    servos[i].write(0); // Ensure gate flap is firmly closed
  }

  // 3. Initialize LCD Display
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.print("System Booting..");
  Serial.println(F("[LCD] Initialized."));

  // 4. Connect to Wi-Fi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lcd.setCursor(0, 1);
  Serial.print(F("[WIFI] Connecting"));
  
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 12000) {
    delay(400);
    lcd.print(".");
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WIFI] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("\n[WIFI] Warning: WiFi timeout. Check credentials."));
  }

  // 5. Initialize RFID (SPI Bus)
  SPI.begin();
  rfid.PCD_Init();
  Serial.println(F("[RFID] MFRC522 Online."));

  // 6. Initialize Fingerprint Sensor (R307S via UART2)
  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX, FINGER_TX);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println(F("[R307S] Optical Fingerprint Sensor found!"));
  } else {
    Serial.println(F("[R307S] Warning: Sensor not found. Check GPIO 16/17 wiring."));
  }

  resetDisplay();
  Serial.println(F("[SYSTEM] Ready to scan RFID or Fingerprint."));
}

void loop() {
  String authID = "";
  bool isFingerprint = false;

  // 1. Scan RFID Card
  if (rfid.PICC_IsNewCardPresent() && rfid.PICC_ReadCardSerial()) {
    for (byte i = 0; i < rfid.uid.size; i++) {
      authID += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
      authID += String(rfid.uid.uidByte[i], HEX);
    }
    authID.toUpperCase();
    Serial.printf("[RFID] Card UID Scanned: %s\n", authID.c_str());
    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
  }

  // 2. Scan Fingerprint if no RFID detected
  if (authID == "") {
    int fingerID = getFingerprintID();
    if (fingerID > 0) {
      authID = String(fingerID);
      isFingerprint = true;
      Serial.printf("[R307S] Fingerprint Matched: ID #%d\n", fingerID);
    }
  }

  // 3. User Authentication & Selection Process
  if (authID != "") {
    lcd.clear();
    lcd.print("Verifying...");
    Serial.println(F("[AUTH] Verifying with database..."));

    if (verifyUserInSupabase(authID, isFingerprint)) {
      lcd.clear();
      lcd.print("Auth Success!");
      Serial.println(F("[AUTH] Eligible! Opening grain selection menu."));
      delay(1000);

      selectAndDispenseCommodity(authID);
    } else {
      lcd.clear();
      lcd.print("Access Denied!");
      lcd.setCursor(0, 1);
      lcd.print("Already Collected");
      Serial.println(F("[AUTH REJECTED] Access denied or quota already collected."));
      delay(2500);
    }
    resetDisplay();
  }

  delay(150);
}

void selectAndDispenseCommodity(String userID) {
  selectedCommodity = 0;
  bool selectionActive = true;

  while (selectionActive) {
    lcd.clear();
    lcd.print("Select Item:");
    lcd.setCursor(0, 1);
    lcd.print("> " + String(commodities[selectedCommodity]));

    // Wait for button actions (Select or Confirm)
    unsigned long startTime = millis();
    while (digitalRead(BTN_SELECT) == HIGH && digitalRead(BTN_CONFIRM) == HIGH) {
      // 15 second inactivity timeout guard
      if (millis() - startTime > 15000) {
        Serial.println(F("[MENU] Inactivity timeout. Returning to idle."));
        return;
      }
      delay(50);
    }

    if (digitalRead(BTN_SELECT) == LOW) {
      selectedCommodity = (selectedCommodity + 1) % 3;
      Serial.printf("[MENU] Cycled to: %s\n", commodities[selectedCommodity]);
      delay(300); // Debounce delay
    } 
    else if (digitalRead(BTN_CONFIRM) == LOW) {
      selectionActive = false;
      Serial.printf("[MENU] Confirmed choice: %s\n", commodities[selectedCommodity]);
      delay(300); // Debounce delay
    }
  }

  // Check Container IR Sensor (LOW = object present under funnel)
  if (digitalRead(IR_CONTAINER) == HIGH) {
    lcd.clear();
    lcd.print("Place Container!");
    lcd.setCursor(0, 1);
    lcd.print("Waiting IR-1...");
    Serial.println(F("[IR] Waiting for container placement beneath funnel..."));
    
    unsigned long waitContainerStart = millis();
    while (digitalRead(IR_CONTAINER) == HIGH) {
      // 30 second container placement timeout
      if (millis() - waitContainerStart > 30000) {
        Serial.println(F("[IR TIMEOUT] Container was not placed. Aborting."));
        lcd.clear();
        lcd.print("Timeout Aborted");
        delay(2000);
        return;
      }
      delay(100);
    }
  }

  // Check Hopper Grain Stock Level (IR-2)
  if (digitalRead(IR_STOCK) == HIGH) {
    Serial.println(F("[WARNING] IR-2 indicates hopper grain level is low!"));
  }

  // Execute Dispensing
  lcd.clear();
  lcd.print("Dispensing:");
  lcd.setCursor(0, 1);
  lcd.print(commodities[selectedCommodity]);
  Serial.printf("[DISPENSE] Opening Servo Flap #%d (%s) for 3 seconds...\n", selectedCommodity + 1, commodities[selectedCommodity]);

  servos[selectedCommodity].write(90); // Open flap 90 degrees
  delay(3000);                         // Dispense window
  servos[selectedCommodity].write(0);  // Close flap firmly back to 0 degrees

  lcd.clear();
  lcd.print("Dispense Done!");
  lcd.setCursor(0, 1);
  lcd.print("Take Container");
  Serial.println(F("[DISPENSE] Gate closed. Dispense complete!"));
  
  logTransaction(userID, commodities[selectedCommodity]);
  delay(2500);
}

int getFingerprintID() {
  if (finger.getImage() != FINGERPRINT_OK) return -1;
  if (finger.image2Tz() != FINGERPRINT_OK) return -1;
  if (finger.fingerFastSearch() != FINGERPRINT_OK) return -1;
  return finger.fingerID;
}

bool verifyUserInSupabase(String id, bool isFingerprint) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[HTTP ERROR] WiFi not connected."));
    return false;
  }

  HTTPClient http;
  String queryParam = isFingerprint ? "fingerprint_id=eq." + id : "card_uid=eq." + id;
  String url = String(SUPABASE_URL) + "/users?" + queryParam + "&select=*";

  Serial.printf("[HTTP GET] Requesting: %s\n", url.c_str());
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));

  int httpCode = http.GET();
  bool eligible = false;

  Serial.printf("[HTTP GET] Response code: %d\n", httpCode);
  if (httpCode == 200) {
    String payload = http.getString();
    Serial.printf("[HTTP PAYLOAD] %s\n", payload.c_str());
    DynamicJsonDocument doc(1024);
    deserializeJson(doc, payload);
    if (doc.size() > 0 && doc[0]["eligible"].as<bool>() == true) {
      eligible = true;
    }
  }
  http.end();
  return eligible;
}

void logTransaction(String userID, const char* item) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/transactions";

  Serial.printf("[HTTP POST] Logging transaction to %s\n", url.c_str());
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(200);
  doc["user_id"] = userID;
  doc["item_dispensed"] = item;
  doc["status"] = "SUCCESS";

  String body;
  serializeJson(doc, body);
  int httpCode = http.POST(body);
  Serial.printf("[HTTP POST] Response code: %d\n", httpCode);
  http.end();
}

void resetDisplay() {
  lcd.clear();
  lcd.print("Ready to Scan");
  lcd.setCursor(0, 1);
  lcd.print("RFID / Finger");
}

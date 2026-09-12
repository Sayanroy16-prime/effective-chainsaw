#ifndef CONFIG_H
#define CONFIG_H

// =========================================================
// Network & Edge Backend Configuration
// =========================================================
#define WIFI_SSID         "Your_WiFi_SSID"
#define WIFI_PASS         "Your_WiFi_Password"
// Current Mac Local IP (found via `ipconfig getifaddr en0`)
#define BACKEND_SERVER    "http://10.9.3.247:3001" // IP of Node.js backend server
#define DISPENSER_ID      "ESP32_DISP_01"

// =========================================================
// Supabase Cloud REST API Configuration
// Project: https://wiqvabhkaaaxezirslpn.supabase.co
// Table: smart_ration_input
// =========================================================
#define SUPABASE_URL      "https://wiqvabhkaaaxezirslpn.supabase.co/rest/v1"
#define SUPABASE_TABLE    "smart_ration_input"
#define SUPABASE_KEY      "YOUR_SUPABASE_ANON_KEY" // Insert anon public key from Project Settings > API

// =========================================================
// Conflict-Free ESP32-WROOM-32 Pinout Allocation
// =========================================================

// 1. RFID Reader (MFRC522) - Hardware VSPI
#define RFID_SS_PIN       5   // Chip Select (SDA)
#define RFID_RST_PIN      4   // Reset
#define RFID_SCK_PIN      18  // VSPI SCK
#define RFID_MISO_PIN     19  // VSPI MISO
#define RFID_MOSI_PIN     23  // VSPI MOSI

// 2. Optical Fingerprint Sensor (R307S) - UART2
#define FP_RX_PIN         16  // ESP32 RX2 connects to R307S TX (Green wire)
#define FP_TX_PIN         17  // ESP32 TX2 connects to R307S RX (White wire)
#define FP_BAUD_RATE      57600

// 3. Audio Module (DFPlayer Mini) - UART1
#define DF_RX_PIN         26  // ESP32 RX1 connects to DFPlayer TX
#define DF_TX_PIN         27  // ESP32 TX1 connects to DFPlayer RX (via 1k resistor)
#define DF_VOLUME         28  // 0 to 30

// 4. Weight Sensing (HX711 + 5kg Load Cell) - ADC1 Pins (Safe with Wi-Fi)
#define HX711_DOUT_PIN    32  // Data Pin
#define HX711_SCK_PIN     33  // Clock Pin
#define CALIBRATION_FACTOR 419.2f // Replace with calibrated value from calibration sketch

// 5. Container & Hopper Sensors (IR Obstacle Sensors)
#define IR1_CONTAINER_PIN 34  // Input only (ADC1) - Active LOW when container placed
#define IR2_HOPPER_PIN    35  // Input only (ADC1) - Active LOW when grain level sufficient

// 6. Dispensing Gate Servo Motors (MG995 / MG996R)
#define SERVO_RICE_PIN    13  // Servo 1: Rice Gate Flap
#define SERVO_WHEAT_PIN   14  // Servo 2: Wheat Gate Flap
#define SERVO_DAL_PIN     25  // Servo 3: Toor Dal Gate Flap
#define SERVO_SUGAR_PIN   12  // Servo 4: Sugar Gate Flap (or 15)

// Servo Gate Angles
#define SERVO_ANGLE_CLOSED 0
#define SERVO_ANGLE_OPEN   65

// 7. I2C Liquid Crystal Display (20x4 LCD)
#define LCD_SDA_PIN       21
#define LCD_SCL_PIN       22
#define LCD_I2C_ADDR      0x27 // Or 0x3F depending on PCF8574 backpack

// =========================================================
// Dispensing Tolerances & System Parameters
// =========================================================
#define DISPENSE_TOLERANCE_GRAMS 2.0f  // Target cutoff threshold
#define OVERSHOOT_COMPENSATION_G 5.0f  // Close valve early to account for grain in flight
#define CONTAINER_TIMEOUT_MS     30000 // 30s timeout to place container

// Track Numbers in DFPlayer Mini
enum AudioTrack {
  TRACK_WELCOME_SCAN_CARD = 1,
  TRACK_AUTH_SUCCESS = 2,
  TRACK_SCAN_FINGERPRINT = 3,
  TRACK_SELECT_GRAIN = 4,
  TRACK_PLACE_CONTAINER = 5,
  TRACK_DISPENSING = 6,
  TRACK_DISPENSE_COMPLETE = 7,
  TRACK_ALREADY_COLLECTED = 8,
  TRACK_THANK_YOU = 9,
  TRACK_INVALID_CARD = 10,
  TRACK_FP_MISMATCH = 11,
  TRACK_CONTAINER_REMOVED_ERROR = 12
};

enum SystemLanguage {
  LANG_ENGLISH = 1, // Folder 01 on SD Card
  LANG_TAMIL = 2    // Folder 02 on SD Card
};

#endif // CONFIG_H

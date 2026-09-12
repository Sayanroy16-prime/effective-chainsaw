# DFPlayer Mini MicroSD Card Setup Guide

The **DFPlayer Mini** MP3 module requires strict folder and file naming on its MicroSD card for deterministic playback by folder index and track number.

---

## 1. MicroSD Card Preparation

1. **Capacity**: Use an 8 GB, 16 GB, or 32 GB MicroSD card (Class 10 recommended).
2. **File System**: Format the MicroSD card as **FAT32** with a 32 KB allocation size.
   - *On Windows*: Right-click drive → Format → FAT32.
   - *On Mac*: Disk Utility → Erase → MS-DOS (FAT).
3. **Clean Root**: Ensure there are no hidden operating system files (e.g. `.Trashes`, `.Spotlight-V100`).

---

## 2. Directory Hierarchy

Create two folders in the root of the MicroSD card named **`01`** and **`02`**:

```text
MicroSD Root /
├── 01/             <-- English Voice Prompts
│   ├── 001.mp3     <-- "Welcome. Please scan your ration card."
│   ├── 002.mp3     <-- "Authentication successful. Card verified."
│   ├── 003.mp3     <-- "Please place finger on biometric scanner."
│   ├── 004.mp3     <-- "Please select grain."
│   ├── 005.mp3     <-- "Please place collection container."
│   ├── 006.mp3     <-- "Dispensing in progress. Please wait."
│   ├── 007.mp3     <-- "Dispensing completed. Please take container."
│   ├── 008.mp3     <-- "Already collected this month's ration."
│   ├── 009.mp3     <-- "Thank you for using Smart Ration PDS."
│   ├── 010.mp3     <-- "Card not recognized."
│   ├── 011.mp3     <-- "Biometric verification failed."
│   └── 012.mp3     <-- "Warning: Container removed mid-dispense."
│
└── 02/             <-- Tamil Voice Prompts (தமிழ்)
    ├── 001.mp3     <-- "வணக்கம். உங்கள் குடும்ப அட்டையை ஸ்கேன் செய்யவும்."
    ├── 002.mp3     <-- "அட்டை சரிபார்க்கப்பட்டது..."
    ├── ...
    └── 012.mp3     <-- "எச்சரிக்கை! பாத்திரம் அகற்றப்பட்டது..."
```

---

## 3. How the Firmware Plays Tracks

In `firmware/audio_manager.h`:
```cpp
// Folder 1: English (/01/001.mp3)
// Folder 2: Tamil   (/02/001.mp3)
int folder = (currentLang == LANG_TAMIL) ? 2 : 1;
player.playFolder(folder, trackNumber);
```

---

## 4. Troubleshooting
- **Humming / Buzzing noise in speaker**: Solder a 1kΩ resistor between ESP32 TX and DFPlayer RX.
- **Flashing red LED on DFPlayer Mini**: The SD card is unmounted, unformatted, or corrupted. Reformat to FAT32.
- **Audio cuts off when servo starts**: Move servo power to a separate 5V rail; the servo motor is causing a voltage dip.

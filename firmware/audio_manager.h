#ifndef AUDIO_MANAGER_H
#define AUDIO_MANAGER_H

#include <Arduino.h>
#include <DFRobotDFPlayerMini.h>
#include "config.h"

class AudioManager {
private:
  HardwareSerial dfSerial;
  DFRobotDFPlayerMini player;
  bool isInitialized;
  SystemLanguage currentLang;

public:
  AudioManager() : dfSerial(1), isInitialized(false), currentLang(LANG_ENGLISH) {}

  bool begin() {
    // Initialize HardwareSerial1 on pins 26 (RX) and 27 (TX)
    dfSerial.begin(9600, SERIAL_8N1, DF_RX_PIN, DF_TX_PIN);
    delay(200);

    if (!player.begin(dfSerial, false)) { // true = ACK, false = fast
      Serial.println(F("[DFPLAYER] Error: DFPlayer Mini not communicating. Check 1k resistor & SD card."));
      isInitialized = false;
      return false;
    }

    player.volume(DF_VOLUME);
    player.outputDevice(DFPLAYER_DEVICE_SD);
    isInitialized = true;
    Serial.println(F("[DFPLAYER] Online. SD card mounted successfully."));
    return true;
  }

  void setLanguage(SystemLanguage lang) {
    currentLang = lang;
  }

  SystemLanguage getLanguage() const {
    return currentLang;
  }

  void playPrompt(AudioTrack track) {
    if (!isInitialized) return;
    
    // Folder 1: English (/01/001.mp3 ... /01/012.mp3)
    // Folder 2: Tamil   (/02/001.mp3 ... /02/012.mp3)
    int folder = (currentLang == LANG_TAMIL) ? 2 : 1;
    player.playFolder(folder, (int)track);
    Serial.printf("[AUDIO] Playing Track %d from Folder %02d (%s)\n", (int)track, folder, (folder == 2 ? "Tamil" : "English"));
  }

  void stop() {
    if (isInitialized) player.stop();
  }
};

#endif // AUDIO_MANAGER_H

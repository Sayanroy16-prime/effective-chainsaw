/**
 * Virtual Hardware Simulator for Smart Ration Dispenser
 * Simulates ESP32 peripherals: MFRC522, R307S, HX711, 4x MG995 Servos, 2x IR Sensors, DFPlayer Mini
 */

(function () {
  const API_ENDPOINT = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? window.location.origin
    : 'http://localhost:3001';

  // Sim State
  let simState = {
    selectedCardUid: 'E23A4B5C',
    authenticatedBeneficiary: null,
    fingerprintMatched: false,
    selectedLanguage: 'EN',
    selectedGrain: 'rice',
    targetWeightG: 500,
    selectedServo: 1,
    containerPlaced: false,
    isDispensing: false,
    dispenseInterval: null
  };

  // DOM Elements
  const simSelectCard = document.getElementById('sim-select-card');
  const simBtnTapRfid = document.getElementById('sim-btn-tap-rfid');
  const simStepFp = document.getElementById('sim-step-fp');
  const simBtnMatchFp = document.getElementById('sim-btn-match-fp');
  const simBtnFailFp = document.getElementById('sim-btn-fail-fp');
  const simStepGrain = document.getElementById('sim-step-grain');
  const simGrainButtons = document.querySelectorAll('.grain-btn');
  const simLangButtons = document.querySelectorAll('.btn-lang');
  const simStepDispense = document.getElementById('sim-step-dispense');
  const simBtnToggleContainer = document.getElementById('sim-btn-toggle-container');
  const simBtnStartDispense = document.getElementById('sim-btn-start-dispense');
  const simConsole = document.getElementById('sim-console');
  const simClearLogs = document.getElementById('sim-clear-logs');

  document.addEventListener('DOMContentLoaded', () => {
    initSimulator();
  });

  function initSimulator() {
    // 1. RFID Tap
    simBtnTapRfid?.addEventListener('click', async () => {
      const cardUid = simSelectCard.value;
      logConsole(`[MFRC522] RFID Card Detected. UID: ${cardUid}`, 'sensor');

      try {
        const res = await fetch(`${API_ENDPOINT}/api/dispenser/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ card_uid: cardUid })
        });

        const data = await res.json();

        if (!data.success) {
          if (data.error_code === 'ALREADY_COLLECTED') {
            logConsole(`[DUPLICATE BLOCKED] ${data.beneficiary?.name} has already collected this month's ration!`, 'error');
            logConsole(`[DFPLAYER] Audio Track #8: "You have already collected this month's ration."`, 'prompt');
          } else {
            logConsole(`[MFRC522] Card not registered in database: ${cardUid}`, 'error');
            logConsole(`[DFPLAYER] Audio Track #11: "Card not recognized."`, 'prompt');
          }
          return;
        }

        // Beneficiary verified
        simState.authenticatedBeneficiary = data.beneficiary;
        simState.selectedCardUid = cardUid;
        logConsole(`[MFRC522] Card Verified: ${data.beneficiary.name} (Ration No: ${data.beneficiary.ration_card_no})`, 'success');
        logConsole(`[DFPLAYER] Audio Track #2: "Authentication successful. Please place finger on biometric sensor."`, 'prompt');
        logConsole(`[LCD 20x4] Line 1: ${data.beneficiary.name.slice(0, 16)} | Line 2: SCAN FINGERPRINT`, 'system');

        simStepFp?.classList.add('active');
      } catch (err) {
        logConsole(`[HTTP ERROR] Verification failed: ${err.message}`, 'error');
      }
    });

    // 2. Fingerprint Match
    simBtnMatchFp?.addEventListener('click', async () => {
      if (!simState.authenticatedBeneficiary) {
        alert('Please tap an RFID card first!');
        return;
      }

      const fpId = simState.authenticatedBeneficiary.fingerprint_id || 1;
      logConsole(`[R307S] Finger placed on optical prism. Capturing 256x288 image...`, 'sensor');
      logConsole(`[R307S] Image converted. Searching template match in flash library...`, 'sensor');

      try {
        const res = await fetch(`${API_ENDPOINT}/api/dispenser/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            card_uid: simState.selectedCardUid,
            fingerprint_id: fpId
          })
        });

        const data = await res.json();
        if (data.success) {
          simState.fingerprintMatched = true;
          logConsole(`[R307S] Match Found! Template ID: #${fpId}. Confidence score: 98.4%`, 'success');
          logConsole(`[DFPLAYER] Audio Track #3: "Biometric confirmed. Please select language and grain."`, 'prompt');
          simStepGrain?.classList.add('active');
        }
      } catch (err) {
        logConsole(`[R307S ERROR] Match error: ${err.message}`, 'error');
      }
    });

    simBtnFailFp?.addEventListener('click', async () => {
      logConsole(`[R307S] Finger placed on optical prism. Template mismatch!`, 'error');
      logConsole(`[DFPLAYER] Audio Track #12: "Fingerprint mismatch. Verification failed."`, 'prompt');
      await fetch(`${API_ENDPOINT}/api/dispenser/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_uid: simState.selectedCardUid,
          fingerprint_id: 999
        })
      });
    });

    // 3. Language Selection
    simLangButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        simLangButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        simState.selectedLanguage = btn.dataset.lang;
        const langName = simState.selectedLanguage === 'TA' ? 'தமிழ் (Tamil)' : 'English';
        logConsole(`[LANGUAGE] Selected: ${langName}`, 'system');
        if (simState.selectedLanguage === 'TA') {
          logConsole(`[DFPLAYER] Audio Track #4 (TA): "தானியத்தை தேர்வு செய்யவும்."`, 'prompt');
        } else {
          logConsole(`[DFPLAYER] Audio Track #4 (EN): "Please select the grain."`, 'prompt');
        }
      });
    });

    // 4. Grain Selection
    simGrainButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        simGrainButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');

        simState.selectedGrain = btn.dataset.grain;
        simState.targetWeightG = parseInt(btn.dataset.target, 10);
        simState.selectedServo = parseInt(btn.dataset.servo, 10);

        logConsole(`[GRAIN SELECT] ${simState.selectedGrain.toUpperCase()} | Quota Target: ${simState.targetWeightG}g | Valve Servo #${simState.selectedServo}`, 'system');
        logConsole(`[DFPLAYER] Audio Track #5: "Please place the collection container under the funnel."`, 'prompt');
        simStepDispense?.classList.add('active');
        checkReadyToDispense();
      });
    });

    // 5. IR-1 Container Toggle
    simBtnToggleContainer?.addEventListener('click', () => {
      simState.containerPlaced = !simState.containerPlaced;

      if (simState.containerPlaced) {
        simBtnToggleContainer.textContent = '❌ Remove Container from Scale';
        simBtnToggleContainer.classList.remove('btn-secondary');
        simBtnToggleContainer.classList.add('btn-outline');
        logConsole(`[IR SENSOR 1] Beam Interrupted (GPIO 34 = LOW). Container DETECTED on scale platform!`, 'sensor');
        logConsole(`[HX711] Tare initiated with container tare offset: 120.4g -> Auto-zeroed to 0.00g`, 'sensor');
      } else {
        simBtnToggleContainer.textContent = '🫙 Place Container on Scale (IR-1)';
        simBtnToggleContainer.classList.remove('btn-outline');
        simBtnToggleContainer.classList.add('btn-secondary');
        logConsole(`[IR SENSOR 1] Beam Unbroken (GPIO 34 = HIGH). NO CONTAINER detected!`, 'sensor');
      }

      // Send telemetry update
      fetch(`${API_ENDPOINT}/api/dispenser/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          containerDetected: simState.containerPlaced,
          status: simState.containerPlaced ? 'CONTAINER_READY' : 'IDLE'
        })
      });

      checkReadyToDispense();
    });

    // 6. Start Dispensing
    simBtnStartDispense?.addEventListener('click', () => {
      startSimulatedDispense();
    });

    // Clear logs
    simClearLogs?.addEventListener('click', () => {
      simConsole.innerHTML = '';
    });
  }

  function checkReadyToDispense() {
    if (simState.selectedGrain && simState.containerPlaced && !simState.isDispensing) {
      simBtnStartDispense.removeAttribute('disabled');
    } else {
      simBtnStartDispense.setAttribute('disabled', 'true');
    }
  }

  // Simulated Dispensing Loop
  async function startSimulatedDispense() {
    if (simState.isDispensing) return;
    simState.isDispensing = true;
    simBtnStartDispense.setAttribute('disabled', 'true');

    logConsole(`=======================================================`, 'system');
    logConsole(`[DISPENSER START] Commodity: ${simState.selectedGrain.toUpperCase()} | Target: ${simState.targetWeightG}g`, 'system');
    logConsole(`[DFPLAYER] Audio Track #6: "Dispensing ${simState.selectedGrain}. Please wait..."`, 'prompt');
    logConsole(`[SERVO ${simState.selectedServo}] Rotating MG995 Gate from 0° -> 65° (OPEN)`, 'system');

    // Notify backend
    await fetch(`${API_ENDPOINT}/api/dispenser/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'DISPENSING',
        activeGrain: simState.selectedGrain,
        activeServo: simState.selectedServo,
        targetWeightG: simState.targetWeightG,
        currentWeightG: 0
      })
    });

    let currentWeight = 0;
    const target = simState.targetWeightG;
    const ratePerTick = 18; // ~18g per 60ms

    simState.dispenseInterval = setInterval(async () => {
      // Simulate slight realistic physical fluctuation (±1.5g)
      const jitter = (Math.random() - 0.5) * 2;
      currentWeight += ratePerTick + jitter;

      // Telemetry update
      await fetch(`${API_ENDPOINT}/api/dispenser/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'DISPENSING',
          currentWeightG: Math.min(target, Math.round(currentWeight * 10) / 10),
          targetWeightG: target
        })
      });

      logConsole(`[HX711] Continuous Weight: ${currentWeight.toFixed(1)}g / ${target}g`, 'sensor');

      // Cutoff reached!
      if (currentWeight >= target) {
        clearInterval(simState.dispenseInterval);
        simState.dispenseInterval = null;
        simState.isDispensing = false;

        const finalWeight = Math.round(currentWeight * 10) / 10;
        logConsole(`[LOAD CELL CUTOFF] Cutoff threshold achieved (${finalWeight}g).`, 'success');
        logConsole(`[SERVO ${simState.selectedServo}] Snapping MG995 Flap to 0° (CLOSED) to halt grain flow.`, 'system');

        // Post transaction completion to backend
        try {
          const res = await fetch(`${API_ENDPOINT}/api/dispenser/dispense`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              card_uid: simState.selectedCardUid,
              commodity: simState.selectedGrain,
              dispensed_weight_g: finalWeight,
              dispenser_id: 'ESP32_DISP_01',
              auth_mode: 'RFID+BIOMETRIC'
            })
          });

          const data = await res.json();
          if (data.success) {
            logConsole(`[TRANSACTION LOGGED] ${data.transaction_id} committed to SQLite database.`, 'success');
            logConsole(`[DFPLAYER] Audio Track #7: "${simState.selectedGrain.toUpperCase()} dispensed. Please place the next container or take your ration. Thank you!"`, 'prompt');
            logConsole(`[DATABASE] Monthly collection locked for ${simState.authenticatedBeneficiary.name}.`, 'system');
            logConsole(`=======================================================`, 'system');
          }
        } catch (err) {
          logConsole(`[DISPENSE ERROR] Failed to record transaction: ${err.message}`, 'error');
        }

        checkReadyToDispense();
      }
    }, 65);
  }

  // Abort helper for emergency stop
  window.abortDispense = function () {
    if (simState.dispenseInterval) {
      clearInterval(simState.dispenseInterval);
      simState.dispenseInterval = null;
      simState.isDispensing = false;
      logConsole(`[EMERGENCY STOP] Dispensing aborted by operator! Gate closed.`, 'error');
    }
  };

  function logConsole(message, type = 'system') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    simConsole?.appendChild(entry);
    if (simConsole) simConsole.scrollTop = simConsole.scrollHeight;
  }
})();

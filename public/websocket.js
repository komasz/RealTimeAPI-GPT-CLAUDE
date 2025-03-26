// public/websocket.js

// Główne elementy DOM
const conversationLog = document.getElementById('conversation-log');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const statusText = document.getElementById('status-text');
const voiceIndicator = document.getElementById('voice-indicator');
const loadingOverlay = document.getElementById('loading-overlay');
const startRecordingButton = document.getElementById('start-recording');
const recordingStatus = document.getElementById('recording-status');

// Zmienne dla połączenia WebSocket i przetwarzania audio
let socket = null;
let mediaRecorder = null;
let audioContext = null;
let isConnected = false;
let isRecording = false;

// Narzędzia i instrukcje dla OpenAI
const assistantInstructions = `
  ## **Asystent Call Center dla Depilacja.pl**
  Jesteś ekspertem od depilacji i obsługi klienta w serwisie **depilacja.pl**. 

  ### **Twoje zadania**
  - Odpowiadaj na pytania klientów dotyczące zabiegów depilacji
  - Pomagaj umówić wizyty w salonie depilacji
  - Zbieraj niezbędne dane do rezerwacji: imię, nazwisko, data, godzina, typ zabiegu, numer telefonu, email

  ### **Zasady działania**
  - **Język:** Odpowiadaj **wyłącznie po polsku**.
  - **Podsumowywanie wyników:** Twórz krótkie i konkretne odpowiedzi.
  - **Proces rezerwacji:**
    - Pytaj o wszystkie wymagane dane (imię, nazwisko, data, godzina, typ zabiegu, numer telefonu, email).
    - Gdy użytkownik poda informacje, poproś o potwierdzenie przed finalizacją.

  ### **Styl komunikacji**
  - Przyjazny, profesjonalny i naturalny ton rozmowy.
  - Zwięzłe odpowiedzi - podawaj tylko istotne informacje.
  - Dostarczaj sprawdzone i profesjonalne informacje.

  ### **Dodatkowe wytyczne**
  - Za każdym razem powtarzaj kluczowe informacje podane przez użytkownika, np.:
    - "Twój numer telefonu to 666 503 969, czy się zgadza?"
    - "Twój adres email to jan.kowalski@example.com, czy poprawnie zapisałem?"
  - Gdy wykryjesz numer telefonu, zawsze używaj narzędzia PhoneNumber do konwersji i wymów go po polsku.
`;

// Definicja narzędzia do obsługi numerów telefonów
const phoneNumberTool = {
  type: 'function',
  name: 'PhoneNumber',
  description: 'Używaj tego narzędzia za każdym razem kiedy wykryjesz numer telefonu',
  parameters: {
    type: 'object',
    properties: {
      phone_number: {
        type: 'string',
        description: 'Numer telefonu.',
      },
    },
    required: ['phone_number']
  }
};

// Obsługa przycisków
startButton.addEventListener('click', startConversation);
stopButton.addEventListener('click', endConversation);
startRecordingButton.addEventListener('mousedown', startRecording);
startRecordingButton.addEventListener('mouseup', stopRecording);
startRecordingButton.addEventListener('mouseleave', stopRecording);
startRecordingButton.addEventListener('touchstart', startRecording);
startRecordingButton.addEventListener('touchend', stopRecording);

// Funkcja inicjująca rozmowę
async function startConversation() {
  try {
    // Pokazuje overlay ładowania
    loadingOverlay.classList.remove('hidden');

    // Aktualizacja statusu
    updateStatus('Łączenie z asystentem...', 'inactive');

    // Wyłączenie przycisku start
    startButton.disabled = true;

    // Dodajmy informację dla użytkownika
    addMessageToLog('Łączenie z asystentem AI. To może zająć kilka sekund...', 'system');

    // Uzyskanie tokenu dla WebSocket
    const tokenResponse = await fetch('/wstoken');
    if (!tokenResponse.ok) {
      throw new Error('Nie udało się uzyskać tokenu WebSocket');
    }
    const tokenData = await tokenResponse.json();
    const apiKey = tokenData.token;

    // Inicjalizacja WebSocket
    await initializeWebSocket(apiKey);

    // Inicjalizacja systemu nagrywania dźwięku
    await initializeAudioRecording();

    // Aktualizacja UI po pomyślnym połączeniu
    stopButton.disabled = false;
    startRecordingButton.disabled = false;
    updateStatus('Połączono - naciśnij przycisk, aby mówić', 'inactive');

    // Dodanie wiadomości powitalnej do logu rozmowy
    addMessageToLog('Asystent jest gotowy do rozmowy. Naciśnij przycisk "Naciśnij, aby mówić" i zacznij mówić.', 'assistant');

    // Ukrycie overlay ładowania
    loadingOverlay.classList.add('hidden');
  } catch (error) {
    console.error('Błąd podczas inicjalizacji rozmowy:', error);
    addMessageToLog(`Wystąpił błąd: ${error.message}. Spróbuj ponownie.`, 'system');
    updateStatus('Błąd połączenia', 'inactive');
    startButton.disabled = false;
    loadingOverlay.classList.add('hidden');
  }
}

// Funkcja kończąca rozmowę
function endConversation() {
  // Zamknięcie połączenia WebSocket
  if (socket) {
    socket.close();
    socket = null;
  }

  // Zatrzymanie nagrywania dźwięku
  stopRecording();

  // Aktualizacja UI
  startButton.disabled = false;
  stopButton.disabled = true;
  startRecordingButton.disabled = true;
  updateStatus('Rozmowa zakończona', 'inactive');
  isConnected = false;

  // Dodanie informacji do logu
  addMessageToLog('Rozmowa została zakończona. Możesz rozpocząć nową, klikając "Rozpocznij rozmowę".', 'system');
}

// Inicjalizacja połączenia WebSocket
async function initializeWebSocket(apiKey) {
  return new Promise((resolve, reject) => {
    try {
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const url = `wss://api.openai.com/v1/realtime?model=${model}`;

      // Tworzenie połączenia WebSocket
      socket = new WebSocket(url, [
        "realtime",
        `openai-insecure-api-key.${apiKey}`,  // UWAGA: w produkcji używaj bezpiecznego podejścia
        "openai-beta.realtime-v1"
      ]);

      // Obsługa zdarzeń WebSocket
      socket.onopen = function() {
        console.log("Połączenie WebSocket nawiązane");
        isConnected = true;

        // Wysłanie konfiguracji sesji
        sendSessionConfig();
        resolve();
      };

      socket.onmessage = function(event) {
        handleModelMessage(event);
      };

      socket.onerror = function(error) {
        console.error("Błąd WebSocket:", error);
        reject(new Error("Błąd połączenia WebSocket"));
      };

      socket.onclose = function(event) {
        console.log("Połączenie WebSocket zamknięte:", event.code, event.reason);
        isConnected = false;

        if (event.code !== 1000) {
          // Jeśli to nie jest normalne zamknięcie
          addMessageToLog(`Połączenie z asystentem zostało przerwane (kod: ${event.code}). Spróbuj ponownie.`, 'system');
          endConversation();
        }
      };
    } catch (error) {
      console.error("Błąd inicjalizacji WebSocket:", error);
      reject(error);
    }
  });
}

// Wysłanie konfiguracji sesji
function sendSessionConfig() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("WebSocket nie jest otwarty");
    return;
  }

  const sessionConfig = {
    type: "session.update",
    session: {
      instructions: assistantInstructions,
      tools: [phoneNumberTool],
      tool_choice: "auto",
      voice: "alloy",
      language: "pl",
      turn_detection: null, // Wyłączamy VAD, bo będziemy ręcznie kontrolować nagrywanie
      input_audio_format: { type: "pcm16", raw_params: { sample_rate: 16000 } },
      output_audio_format: { type: "pcm16", raw_params: { sample_rate: 24000 } }
    },
  };

  socket.send(JSON.stringify(sessionConfig));
  console.log("Wysłano konfigurację sesji");
}

// Inicjalizacja nagrywania dźwięku
async function initializeAudioRecording() {
  try {
    // Uzyskanie dostępu do mikrofonu
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Inicjalizacja AudioContext
    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Konfiguracja MediaRecorder
    mediaRecorder = new MediaRecorder(stream);

    // Obsługa danych audio
    mediaRecorder.ondataavailable = handleAudioData;

    console.log("Inicjalizacja nagrywania dźwięku zakończona");
  } catch (error) {
    console.error("Błąd inicjalizacji nagrywania dźwięku:", error);
    throw new Error("Nie udało się uzyskać dostępu do mikrofonu");
  }
}

// Rozpoczęcie nagrywania dźwięku
function startRecording() {
  if (!isConnected || !mediaRecorder || isRecording) return;

  try {
    mediaRecorder.start(100); // Nagrywaj i wysyłaj chunki co 100ms
    isRecording = true;
    updateStatus('Słucham...', 'listening');
    recordingStatus.textContent = 'Aktywne';
    startRecordingButton.classList.add('active');

    // Wyślij informację o czyszczeniu bufora audio
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    }
  } catch (error) {
    console.error("Błąd podczas rozpoczynania nagrywania:", error);
  }
}

// Zakończenie nagrywania dźwięku
function stopRecording() {
  if (!isRecording || !mediaRecorder) return;

  try {
    mediaRecorder.stop();
    isRecording = false;
    updateStatus('Przetwarzanie...', 'inactive');
    recordingStatus.textContent = 'Wyłączone';
    startRecordingButton.classList.remove('active');

    // Wyślij informację o zakończeniu wejścia audio i poproś o odpowiedź
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      socket.send(JSON.stringify({ type: "response.create" }));
    }
  } catch (error) {
    console.error("Błąd podczas zatrzymywania nagrywania:", error);
  }
}

// Obsługa danych audio
function handleAudioData(event) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !isRecording) return;

  const reader = new FileReader();
  reader.onloadend = function() {
    // Konwersja do Base64
    const base64Audio = reader.result.split(',')[1];

    // Wysyłanie danych audio do OpenAI
    const audioMessage = {
      type: "input_audio_buffer.append",
      audio: base64Audio
    };

    socket.send(JSON.stringify(audioMessage));
  };

  reader.readAsDataURL(event.data);
}

// Aktualny bufor tekstu delta
let currentTextBuffer = '';

// Obsługa wiadomości przychodzących od modelu
function handleModelMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('Otrzymano zdarzenie:', data.type);

    // Obsługa różnych typów zdarzeń
    switch (data.type) {
      case 'session.created':
        console.log('Sesja utworzona:', data.session.id);
        break;

      case 'session.updated':
        console.log('Sesja zaktualizowana:', data.session.id);
        break;

      case 'response.created':
        // Model zaczął generować odpowiedź
        updateStatus('Asystent odpowiada...', 'speaking');
        break;

      case 'response.text.delta':
        // Przyrostowa odpowiedź tekstowa
        handleTextDelta(data.delta.text);
        break;

      case 'response.audio.delta':
        // Obsługa danych audio - w tej wersji tylko logujemy
        console.log('Otrzymano chunk audio');
        playAudioChunk(data.delta);
        break;

      case 'response.done':
        // Odpowiedź zakończona
        updateStatus('Gotowy do rozmowy', 'inactive');
        handleCompletedResponse(data.response);
        break;

      case 'response.output_item.added':
        if (data.output_item.type === 'function_call') {
          handleFunctionCall(data.output_item);
        }
        break;

      // Obsługa innych zdarzeń
      default:
        console.log('Nieobsługiwane zdarzenie:', data.type);
    }
  } catch (error) {
    console.error('Błąd podczas przetwarzania wiadomości:', error);
  }
}

// Bufor audio dla odtwarzania dźwięku
let audioQueue = [];
let isPlaying = false;

// Funkcja do odtwarzania chunka audio
function playAudioChunk(audioChunk) {
  try {
    // Dekodowanie Base64 do ArrayBuffer
    const binaryString = window.atob(audioChunk);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Dodanie do kolejki
    audioQueue.push(bytes.buffer);

    // Jeśli nie odtwarzamy, rozpocznij odtwarzanie
    if (!isPlaying) {
      playNextAudioChunk();
    }
  } catch (error) {
    console.error('Błąd podczas przetwarzania chunka audio:', error);
  }
}

// Funkcja odtwarzająca kolejne chunki audio
async function playNextAudioChunk() {
  if (audioQueue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;

  try {
    const audioBuffer = audioQueue.shift();

    // Utwórz nowy AudioContext, jeśli nie istnieje
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Dekoduj ArrayBuffer do AudioBuffer
    const decodedBuffer = await audioContext.decodeAudioData(audioBuffer);

    // Utwórz źródło dźwięku
    const source = audioContext.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(audioContext.destination);

    // Po zakończeniu odtwarzania, przejdź do następnego chunka
    source.onended = () => {
      playNextAudioChunk();
    };

    // Rozpocznij odtwarzanie
    source.start(0);
  } catch (error) {
    console.error('Błąd podczas odtwarzania chunka audio:', error);
    playNextAudioChunk(); // Przejdź do następnego chunka mimo błędu
  }
}

// Obsługa przyrostowej odpowiedzi tekstowej
function handleTextDelta(text) {
  // Dodaj tekst do bufora
  currentTextBuffer += text;

  // Aktualizacja lub dodanie wiadomości asystenta
  const assistantMessages = document.querySelectorAll('.message.assistant.pending');

  if (assistantMessages.length > 0) {
    // Aktualizuj istniejącą wiadomość
    assistantMessages[assistantMessages.length - 1].textContent = currentTextBuffer;
  } else {
    // Dodaj nową wiadomość z klasą pending
    addMessageToLog(currentTextBuffer, 'assistant pending');
  }

  // Auto-scroll do najnowszej wiadomości
  conversationLog.scrollTop = conversationLog.scrollHeight;
}

// Obsługa zakończonej odpowiedzi
function handleCompletedResponse(response) {
  // Usuń klasę pending z wiadomości asystenta
  const pendingMessages = document.querySelectorAll('.message.assistant.pending');
  if (pendingMessages.length > 0) {
    pendingMessages.forEach(msg => msg.classList.remove('pending'));
  }

  // Resetuj bufor tekstu
  currentTextBuffer = '';
}

// Obsługa wywołania funkcji
function handleFunctionCall(outputItem) {
  if (outputItem.name === 'PhoneNumber') {
    try {
      // Parsowanie argumentów funkcji
      const args = JSON.parse(outputItem.arguments);
      const phoneNumber = args.phone_number;

      console.log('Wykryto numer telefonu:', phoneNumber);

      // Konwersja numeru telefonu na słowa
      const phoneNumberWords = convertPhoneNumberToWords(phoneNumber);

      // Wysłanie wyniku funkcji z powrotem do modelu
      const functionResponse = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: outputItem.call_id,
          output: JSON.stringify({
            phone_number: phoneNumberWords,
            success: true
          }),
        },
      };

      socket.send(JSON.stringify(functionResponse));
      console.log('Wysłano odpowiedź funkcji:', functionResponse);
    } catch (error) {
      console.error('Błąd podczas obsługi wywołania funkcji PhoneNumber:', error);
    }
  }
}

// Funkcja konwertująca numer telefonu na słowa
function convertPhoneNumberToWords(phoneNumber) {
  const digitToWord = {
    '0': 'zero',
    '1': 'jeden',
    '2': 'dwa',
    '3': 'trzy',
    '4': 'cztery',
    '5': 'pięć',
    '6': 'sześć',
    '7': 'siedem',
    '8': 'osiem',
    '9': 'dziewięć'
  };

  return phoneNumber
    .split('')
    .map(char => digitToWord[char] || char)
    .join(' ');
}

// Dodanie wiadomości do logu rozmowy
function addMessageToLog(message, type) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message');
  messageElement.classList.add(type.split(' ')[0]); // Pierwszy człon to główny typ (user/assistant/system)

  if (type.includes('pending')) {
    messageElement.classList.add('pending');
  }

  messageElement.textContent = message;
  conversationLog.appendChild(messageElement);

  // Auto-scroll do najnowszej wiadomości
  conversationLog.scrollTop = conversationLog.scrollHeight;
}

// Aktualizacja statusu rozmowy
function updateStatus(text, indicatorState) {
  statusText.textContent = text;

  // Resetowanie klas wskaźnika
  voiceIndicator.classList.remove('inactive', 'listening', 'speaking');

  // Dodanie odpowiedniej klasy
  if (indicatorState) {
    voiceIndicator.classList.add(indicatorState);
  }
}

// Inicjalizacja aplikacji
function init() {
  // Sprawdzenie czy przeglądarka obsługuje WebSocket
  if (!window.WebSocket) {
    addMessageToLog('Twoja przeglądarka nie obsługuje WebSocket, które jest wymagane do działania asystenta.', 'system');
    startButton.disabled = true;
    return;
  }

  // Sprawdzenie czy przeglądarka obsługuje MediaRecorder
  if (!window.MediaRecorder) {
    addMessageToLog('Twoja przeglądarka nie obsługuje MediaRecorder, który jest wymagany do nagrywania dźwięku.', 'system');
    startButton.disabled = true;
    return;
  }

  updateStatus('Gotowy do rozmowy', 'inactive');

  // Dodanie styli dla przycisku nagrywania
  const style = document.createElement('style');
  style.textContent = `
    .button.record {
      background-color: #28a745;
      margin-top: 15px;
      width: 100%;
    }
    .button.record.active {
      background-color: #dc3545;
      animation: pulse 1.5s infinite;
    }
    .audio-controls {
      margin-top: 15px;
      text-align: center;
    }
    .audio-label {
      margin-top: 5px;
      font-size: 0.9rem;
      color: #6c757d;
    }
  `;
  document.head.appendChild(style);
}

// Uruchomienie inicjalizacji po załadowaniu strony
window.addEventListener('load', init);
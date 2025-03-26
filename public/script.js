// public/script.js

// Główne elementy DOM
const conversationLog = document.getElementById('conversation-log');
const startButton = document.getElementById('start-button');
const stopButton = document.getElementById('stop-button');
const statusText = document.getElementById('status-text');
const voiceIndicator = document.getElementById('voice-indicator');
const loadingOverlay = document.getElementById('loading-overlay');

// Zmienne dla połączenia WebRTC
let peerConnection = null;
let dataChannel = null;
let audioElement = null;
let localStream = null;

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

// Funkcja inicjująca rozmowę
async function startConversation() {
  try {
    // Pokazuje overlay ładowania
    loadingOverlay.classList.remove('hidden');

    // Aktualizacja statusu
    updateStatus('Łączenie z asystentem...', 'inactive');

    // Wyłączenie przycisku start
    startButton.disabled = true;

    // Dodajmy informację dla użytkownika, że trwa proces łączenia
    addMessageToLog('Łączenie z asystentem AI. To może zająć kilka sekund...', 'system');

    console.log("Pobieranie tokenu sesji z serwera...");

    // Uzyskanie tokenu sesji z serwera
    let sessionResponse;
    try {
      sessionResponse = await fetch('/session');
      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        console.error(`Błąd odpowiedzi serwera: ${sessionResponse.status}`, errorText);
        throw new Error(`Nie udało się uzyskać tokenu sesji (${sessionResponse.status}): ${errorText}`);
      }
    } catch (fetchError) {
      console.error("Błąd fetch podczas pobierania tokenu:", fetchError);
      throw new Error(`Problem z połączeniem do serwera: ${fetchError.message}`);
    }

    let sessionData;
    try {
      sessionData = await sessionResponse.json();
      console.log("Otrzymano dane sesji:", JSON.stringify(sessionData, null, 2));

      if (!sessionData.client_secret || !sessionData.client_secret.value) {
        throw new Error("Nieprawidłowy format odpowiedzi serwera - brak tokenu");
      }
    } catch (jsonError) {
      console.error("Błąd podczas parsowania JSON:", jsonError);
      throw new Error(`Problem z formatem odpowiedzi serwera: ${jsonError.message}`);
    }

    const ephemeralToken = sessionData.client_secret.value;

    // Inicjalizacja WebRTC
    await initializeWebRTC(ephemeralToken);

    // Aktualizacja UI po pomyślnym połączeniu
    stopButton.disabled = false;
    updateStatus('Połączono - możesz zacząć mówić', 'listening');

    // Dodanie wiadomości powitalnej do logu rozmowy
    addMessageToLog('Asystent jest gotowy do rozmowy. W czym mogę pomóc?', 'assistant');

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
  // Zamknięcie połączenia WebRTC
  if (peerConnection) {
    if (dataChannel) {
      dataChannel.close();
    }
    peerConnection.close();
    peerConnection = null;
    dataChannel = null;
  }

  // Zatrzymanie lokalnego strumienia audio
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  // Aktualizacja UI
  startButton.disabled = false;
  stopButton.disabled = true;
  updateStatus('Rozmowa zakończona', 'inactive');

  // Dodanie informacji do logu
  addMessageToLog('Rozmowa została zakończona. Możesz rozpocząć nową, klikając "Rozpocznij rozmowę".', 'system');
}

// Funkcja inicjalizująca połączenie WebRTC
async function initializeWebRTC(token) {
  try {
    // Utwórz nowe połączenie peer
    peerConnection = new RTCPeerConnection();

    // Utwórz element audio do odtwarzania dźwięku od modelu
    audioElement = document.createElement('audio');
    audioElement.autoplay = true;
    document.body.appendChild(audioElement);

    // Obsługa strumieni audio przychodzących od modelu
    peerConnection.ontrack = (event) => {
      audioElement.srcObject = event.streams[0];
    };

    // Uzyskanie dostępu do mikrofonu
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    // Utworzenie kanału danych do wymiany komunikatów JSON
    dataChannel = peerConnection.createDataChannel('oai-events');

    // Nasłuchiwanie wiadomości przychodzących od modelu
    dataChannel.addEventListener('message', handleModelMessage);

    // Utworzenie oferty SDP
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // Wysłanie oferty do API OpenAI i uzyskanie odpowiedzi
    const baseUrl = "https://api.openai.com/v1/realtime";
    const model = "gpt-4o-realtime-preview-2024-12-17"; // Aktualizacja nazwy modelu
    console.log("Łączenie z modelem:", model);
    console.log("Wysyłanie oferty WebRTC...");

    try {
      const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/sdp",
          "OpenAI-Beta": "realtime=v1" // Dodajemy nagłówek wymagany w okresie beta
        },
      });

    if (!sdpResponse.ok) {
      const errorText = await sdpResponse.text();
      console.error("Błąd odpowiedzi API OpenAI:", sdpResponse.status, errorText);
      throw new Error(`Błąd API OpenAI: ${sdpResponse.status} ${errorText}`);
    }

    // Ustawienie remote description z odpowiedzią od OpenAI
    const sdpText = await sdpResponse.text();
    console.log("Odpowiedź SDP otrzymana, konfiguracja połączenia...");

    const answer = {
      type: "answer",
      sdp: sdpText,
    };
    await peerConnection.setRemoteDescription(answer);
    console.log("Połączenie WebRTC skonfigurowane pomyślnie.");

    // Wysłanie początkowej konfiguracji sesji
    await sendSessionConfig();

  } catch (error) {
    console.error('Błąd inicjalizacji WebRTC:', error);
    throw error;
  }
}

// Funkcja wysyłająca konfigurację sesji do OpenAI
async function sendSessionConfig() {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    return new Promise((resolve) => {
      dataChannel.addEventListener('open', async () => {
        await doSendSessionConfig();
        resolve();
      }, { once: true });
    });
  } else {
    return doSendSessionConfig();
  }
}

// Pomocnicza funkcja do wysyłania konfiguracji
function doSendSessionConfig() {
  return new Promise((resolve) => {
    // Wysyłanie konfiguracji
    const sessionConfig = {
      type: "session.update",
      session: {
        instructions: assistantInstructions,
        tools: [phoneNumberTool],
        tool_choice: "auto",
        voice: "alloy", // Można zmienić na inny głos: alloy, echo, fable, onyx, nova, shimmer
        language: "pl"
      },
    };

    dataChannel.send(JSON.stringify(sessionConfig));

    // Daj trochę czasu na przetworzenie konfiguracji
    setTimeout(resolve, 500);
  });
}

// Obsługa wiadomości przychodzących od modelu
function handleModelMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log('Received event:', data);

    // Obsługa różnych typów zdarzeń
    switch (data.type) {
      case 'session.created':
        console.log('Sesja utworzona:', data.session.id);
        break;

      case 'session.updated':
        console.log('Sesja zaktualizowana:', data.session.id);
        break;

      case 'input_audio_buffer.speech_started':
        // Użytkownik zaczął mówić
        updateStatus('Słucham...', 'listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        // Użytkownik przestał mówić
        updateStatus('Przetwarzanie...', 'inactive');
        break;

      case 'response.created':
        // Model zaczął generować odpowiedź
        updateStatus('Asystent odpowiada...', 'speaking');
        break;

      case 'response.text.delta':
        // Przyrostowa odpowiedź tekstowa
        handleTextDelta(data.delta.text);
        break;

      case 'response.done':
        // Odpowiedź zakończona
        updateStatus('Gotowy do rozmowy', 'listening');
        handleCompletedResponse(data.response);
        break;

      case 'response.function_call_arguments.delta':
        // Model wywołuje funkcję - przyrostowe argumenty
        console.log('Function call args delta:', data.delta);
        break;

      // Obsługa wywołania funkcji
      case 'response.output_item.added':
        if (data.output_item.type === 'function_call') {
          handleFunctionCall(data.output_item);
        }
        break;
    }
  } catch (error) {
    console.error('Błąd podczas przetwarzania wiadomości:', error);
  }
}

// Aktualny bufor tekstu delta
let currentTextBuffer = '';

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

      dataChannel.send(JSON.stringify(functionResponse));
      console.log('Wysłano odpowiedź funkcji:', functionResponse);
    } catch (error) {
      console.error('Błąd podczas obsługi wywołania funkcji PhoneNumber:', error);
    }
  }
}

// Funkcja konwertująca numer telefonu na słowa w języku polskim
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
  // Sprawdzenie czy przeglądarka obsługuje WebRTC
  if (!navigator.mediaDevices || !window.RTCPeerConnection) {
    addMessageToLog('Twoja przeglądarka nie obsługuje WebRTC, które jest wymagane do działania asystenta głosowego.', 'system');
    startButton.disabled = true;
    return;
  }

  updateStatus('Gotowy do rozmowy', 'inactive');

  // Prośba o zgodę na dostęp do mikrofonu
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      // Zatrzymanie strumienia - będzie uruchomiony ponownie podczas rozmowy
      stream.getTracks().forEach(track => track.stop());
      console.log('Dostęp do mikrofonu: OK');
    })
    .catch(error => {
      console.error('Błąd dostępu do mikrofonu:', error);
      addMessageToLog('Nie udało się uzyskać dostępu do mikrofonu. Sprawdź ustawienia przeglądarki.', 'system');
      startButton.disabled = true;
    });
}

// Uruchomienie inicjalizacji po załadowaniu strony
window.addEventListener('load', init);
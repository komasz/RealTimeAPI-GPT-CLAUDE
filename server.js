// server.js - nowy plik serwera
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware dla statycznych plików
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Główna strona
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Strona diagnostyczna
app.get('/diagnostic', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'diagnostic.html'));
});

// WebSocket auth
app.get('/wsauth', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ 
        error: "Brak klucza API OpenAI" 
      });
    }
    
    const encryptedKey = Buffer.from(process.env.OPENAI_API_KEY).toString('base64');
    res.json({ 
      key: encryptedKey,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error("Błąd:", error);
    res.status(500).json({ error: "Błąd serwera" });
  }
});

// OpenAI token
app.get('/session', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Brak klucza API OpenAI" });
    }
    
    console.log("Generowanie tokenu...");
    
    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1"
      },
      body: JSON.stringify({
        model: "gpt-4o-realtime-preview-2024-12-17",
        voice: "alloy",
        instructions: "Jesteś asystentem depilacja.pl. Odpowiadaj po polsku."
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Błąd API:", errorText);
      return res.status(response.status).json({ 
        error: "Błąd API OpenAI", 
        details: errorText 
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Błąd:", error);
    res.status(500).json({ error: "Błąd serwera" });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Uruchomienie serwera
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});

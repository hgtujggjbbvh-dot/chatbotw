import express from "express";
import session from "express-session";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs-extra";
import path from "path";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI Setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || "geheim123",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Vercel: Nutze /tmp für Datei-Speicherung
const conversationsFile = "/tmp/conversations.json";

// Hilfsfunktion: Konversationen laden
async function loadConversations() {
  try {
    if (await fs.pathExists(conversationsFile)) {
      return await fs.readJson(conversationsFile);
    }
    return [];
  } catch (error) {
    console.error("Load error:", error);
    return [];
  }
}

// Hilfsfunktion: Konversationen speichern
async function saveConversation(userMsg, botReply) {
  try {
    const conversations = await loadConversations();
    conversations.push({
      timestamp: new Date().toISOString(),
      user: userMsg,
      bot: botReply
    });
    await fs.writeJson(conversationsFile, conversations);
  } catch (error) {
    console.error("Save error:", error);
  }
}

// Hilfsfunktion: Kontext aus alten Chats erstellen
async function buildContext() {
  const conversations = await loadConversations();
  const recent = conversations.slice(-30);
  const contextMessages = [];
  
  recent.forEach(conv => {
    contextMessages.push({ role: "user", content: conv.user });
    contextMessages.push({ role: "assistant", content: conv.bot });
  });
  
  return contextMessages;
}

// ROUTES

// Startseite
app.get("/", (req, res) => {
  res.render("index");
});

// Chat-Seite
app.get("/chat", (req, res) => {
  res.render("chat");
});

// Chat API
app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage || userMessage.trim() === "") {
      return res.status(400).json({ error: "Nachricht darf nicht leer sein" });
    }

    // Session-Memory initialisieren
    if (!req.session.chatHistory) {
      req.session.chatHistory = [];
    }

    // User-Nachricht zur Session hinzufügen
    req.session.chatHistory.push({
      role: "user",
      content: userMessage
    });

    // Kontext aus gespeicherten Konversationen laden
    const contextMessages = await buildContext();

    // OpenAI API Call
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Du bist ein hilfreicher Chatbot mit perfektem Gedächtnis. Du erinnerst dich an ALLE bisherigen Gespräche mit dem User und beziehst dich darauf. Nutze frühere Infos, um bessere Antworten zu geben."
        },
        ...contextMessages,
        ...req.session.chatHistory
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const botReply = completion.choices[0].message.content;

    // Bot-Antwort zur Session hinzufügen
    req.session.chatHistory.push({
      role: "assistant",
      content: botReply
    });

    // Konversation dauerhaft speichern
    await saveConversation(userMessage, botReply);

    // Session-History auf max 30 Nachrichten begrenzen
    if (req.session.chatHistory.length > 30) {
      req.session.chatHistory = req.session.chatHistory.slice(-30);
    }

    res.json({ reply: botReply });

  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ 
      error: "Ein Fehler ist aufgetreten",
      details: error.message 
    });
  }
});

// Konversationen löschen
app.post("/api/reset", async (req, res) => {
  try {
    await fs.writeJson(conversationsFile, []);
    req.session.chatHistory = [];
    res.json({ success: true, message: "Alle Konversationen gelöscht" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Für lokale Entwicklung
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
  });
}

// Für Vercel: Export als Serverless Function
export default app;

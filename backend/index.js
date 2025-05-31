import express from "express";
import cors from "cors";
import path from "path";
import url, { fileURLToPath } from "url";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { clerkClient, requireAuth, getAuth } from "@clerk/express";
import dotenv from "dotenv";
dotenv.config();

const port = process.env.PORT || 3000;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());

const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
  }
};

const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

app.get("/api/upload", (req, res) => {
  try {
    const result = imagekit.getAuthenticationParameters();
    res.send(result);
  } catch (err) {
    res.status(500).send("Error generating authentication parameters!");
  }
});

app.post("/api/chats", requireAuth(), async (req, res) => {
  const userId = req.auth?.userId;
  const { text } = req.body;

  if (!text) return res.status(400).send("Text is required!");

  try {
    const newChat = new Chat({
      userId: userId,
      history: [{ role: "user", parts: [{ text }] }],
    });

    const savedChat = await newChat.save();
    const userChats = await UserChats.findOne({ userId });

    if (!userChats) {
      const newUserChats = new UserChats({
        userId: userId,
        chats: [{ _id: savedChat._id, title: text.substring(0, 40) }],
      });

      await newUserChats.save();
      return res.status(201).send(newChat._id);
    } else {
      await UserChats.updateOne(
        { userId: userId },
        {
          $push: {
            chats: { _id: savedChat._id, title: text.substring(0, 40) },
          },
        }
      );

      res.status(201).send(newChat._id);
    }
  } catch (err) {
    res.status(500).send("Error creating chat!");
  }
});

app.get("/api/userchats", requireAuth(), async (req, res) => {
  const userId = req.auth?.userId;

  try {
    const userChats = await UserChats.findOne({ userId });
    res.status(200).send(userChats?.chats || []);
  } catch (err) {
    res.status(500).send("Error fetching user chats!");
  }
});

app.get("/api/chats/:id", requireAuth(), async (req, res) => {
  const userId = req.auth?.userId;
  const chatId = req.params.id;

  try {
    const chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) return res.status(404).send("Chat not found!");
    res.status(200).send(chat);
  } catch (err) {
    res.status(500).send("Error fetching chat!");
  }
});

app.put("/api/chats/:id", requireAuth(), async (req, res) => {
  const userId = req.auth?.userId;
  const chatId = req.params.id;
  const { question, answer, img } = req.body;

  if (!question || !answer) return res.status(400).send("Question and answer are required!");

  const newItems = [
    {
      role: "user",
      parts: [{ text: question }],
      ...(img && { img }),
    },
    { role: "model", parts: [{ text: answer }] },
  ];

  try {
    const updatedChat = await Chat.updateOne(
      { _id: chatId, userId },
      { $push: { history: { $each: newItems } } }
    );

    if (!updatedChat.nModified) return res.status(404).send("Chat not found!");
    res.status(200).send(updatedChat);
  } catch (err) {
    res.status(500).send("Error updating chat!");
  }
});

app.use((err, req, res, next) => {
  res.status(401).send("Unauthenticated!");
});

app.use(express.static(path.join(__dirname, "../client/dist")));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

app.listen(port, () => {
  connect();
  console.log(`Server running on port ${port}`);
});

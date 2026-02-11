import { io } from "socket.io-client";
import { SERVER_URL } from "../env.js";
import { Session } from "../state/session.js";
import { Events } from "../state/events.js";

/**
 * IMPORTANT:
 * Socket is created ONCE here.
 * Scenes never call io() and never register persistent socket handlers.
 */

export function ensureSocket() {
  if (Session.socket) return Session.socket;

  const socket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 500,
    timeout: 20000
  });

  Session.socket = socket;

  socket.on("connect", () => {
    Session.myId = socket.id;
  });

  socket.on("roomError", (e) => {
    alert(e?.message || "Room error");
  });

  // Core state events -> update Session + broadcast via Events bus
  socket.on("leaderboard", (lb) => {
    Session.globalLB = lb || [];
    Events.emit("leaderboard", Session.globalLB);
  });

  socket.on("roomJoined", (room) => {
    Session.room = room;
    Events.emit("roomJoined", room);
  });

  socket.on("roomUpdate", (room) => {
    Session.room = room;
    Events.emit("roomUpdate", room);
  });

  socket.on("matchStarted", (room) => {
    Session.room = room;
    Events.emit("matchStarted", room);
  });

  socket.on("roundStart", ({ room, roundTime }) => {
    Session.room = room;
    Events.emit("roundStart", { room, roundTime });
  });

  socket.on("guessCount", (x) => Events.emit("guessCount", x));
  socket.on("roundReveal", (x) => Events.emit("roundReveal", x));
  socket.on("matchEnded", (x) => Events.emit("matchEnded", x));
  socket.on("toast", (x) => Events.emit("toast", x));
  socket.on("ping", (x) => Events.emit("ping", x));

  return socket;
}

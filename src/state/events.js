import Phaser from "phaser";

export const Events = new Phaser.Events.EventEmitter();

/**
 * Events used across scenes:
 * - "toast" {text,type}
 * - "ping" {from,kind}
 * - "roomJoined" room
 * - "roomUpdate" room
 * - "matchStarted" room
 * - "roundStart" {room, roundTime}
 * - "guessCount" {guessed,total}
 * - "roundReveal" payload
 * - "matchEnded" payload
 * - "leaderboard" lb
 */

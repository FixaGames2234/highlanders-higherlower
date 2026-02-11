import Phaser from "phaser";
import "./style.css";

import { BootScene } from "./scenes/BootScene.js";
import { MenuScene } from "./scenes/MenuScene.js";
import { LobbyScene } from "./scenes/LobbyScene.js";
import { OnlineScene } from "./scenes/OnlineScene.js";
import { OfflineScene } from "./scenes/OfflineScene.js";

console.log("FRONTEND VERSION: modular-refactor-v1");

const config = {
  type: Phaser.AUTO,
  parent: "app",
  width: 1100,
  height: 680,
  backgroundColor: "#070A12",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  dom: { createContainer: true },
  scene: [BootScene, MenuScene, LobbyScene, OnlineScene, OfflineScene]
};

new Phaser.Game(config);

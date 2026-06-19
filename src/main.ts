import Phaser from "phaser";
import { MainScene } from "./scenes/MainScene";
import "./style.css";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: "game",
  backgroundColor: "#10130f",
  width: 1200,
  height: 800,
  pixelArt: false,
  antialias: true,
  scale: {
    mode: Phaser.Scale.ScaleModes.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1200,
    height: 800
  },
  scene: [MainScene]
};

new Phaser.Game(config);

import Phaser from "phaser";
import { AudioDirector } from "../audio/AudioDirector";
import { ITEMS, ROOMS } from "../data/content";
import { GameState, type EndingId, type ItemId, type RoomId } from "../state/GameState";

const GAME_W = 1200;
const GAME_H = 800;

type ButtonSpec = {
  label: string;
  action: () => void;
};

type Hotspot = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
};

type InventoryFocusTarget = {
  itemId: ItemId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type KeyboardFocusTarget =
  | {
      kind: "hotspot";
      spot: Hotspot;
    }
  | ({
      kind: "inventory";
    } & InventoryFocusTarget);

type TitleFocusTarget = {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
};

type SequenceButton = {
  label: string;
  value: string;
};

type LoadFailureFile = {
  key?: string;
  url?: string;
  src?: string;
};

type ModalEscapeHandler = (event: KeyboardEvent) => void;

export class MainScene extends Phaser.Scene {
  private state = new GameState();
  private audio = new AudioDirector();
  private selectedItem?: ItemId;
  private hoverLabel?: Phaser.GameObjects.Text;
  private roomTitle?: Phaser.GameObjects.Text;
  private overlay?: Phaser.GameObjects.Container;
  private domOverlay?: HTMLDivElement;
  private hintLevels: Partial<Record<RoomId, number>> = {};
  private lastPuzzleInput: string[] = [];
  private hoverFocus?: Phaser.GameObjects.Container;
  private loadFailed = false;
  private loadErrors: string[] = [];
  private optionalLoadErrors: string[] = [];
  private titleActive = false;
  private keyboardHotspots: Hotspot[] = [];
  private keyboardInventoryTargets: InventoryFocusTarget[] = [];
  private keyboardFocusIndex = -1;
  private titleFocusTargets: TitleFocusTarget[] = [];
  private titleFocusIndex = -1;
  private modalEscapeHandler?: ModalEscapeHandler;
  private lastShortcutKey = "";
  private lastShortcutAt = 0;
  private saveUnavailableWarned = false;
  private gamepadButtonLatch: Record<string, boolean> = {};
  private gamepadNavDirection = 0;
  private gamepadNavAt = 0;

  constructor() {
    super("MainScene");
  }

  preload(): void {
    this.showLoadingScreen();
    this.load.image("bg-title", "assets/images/title-department.webp");
    this.load.image("bg-reception", "assets/images/reception.webp");
    this.load.image("bg-clock", "assets/images/clock-hall.webp");
    this.load.image("bg-security", "assets/images/security-office.webp");
    this.load.image("bg-interrogation", "assets/images/interrogation-booth.webp");
    this.load.image("bg-archive", "assets/images/records-archive.webp");
    this.load.image("bg-break", "assets/images/break-room.webp");
    this.load.image("bg-mirror", "assets/images/mirror-server.webp");
    this.load.image("bg-ending", "assets/images/ending-dawn.webp");
    this.load.audio("sfx-click", "assets/audio/ui/click.ogg");
    this.load.audio("sfx-hover", "assets/audio/ui/hover.ogg");
    this.load.audio("sfx-pickup", "assets/audio/ui/pickup.ogg");
    this.load.audio("sfx-success", "assets/audio/ui/success.ogg");
    this.load.audio("sfx-fail", "assets/audio/ui/fail.ogg");
    this.load.audio("sfx-open", "assets/audio/ui/open.ogg");
    this.load.audio("sfx-glitch", "assets/audio/ui/glitch.ogg");
    this.load.audio("sfx-machine", "assets/audio/ui/machine.ogg");
    this.load.audio("sfx-metal", "assets/audio/ui/metal.ogg");
    this.load.audio("sfx-paper", "assets/audio/ui/paper.ogg");
    this.load.audio("sfx-drop", "assets/audio/ui/drop.ogg");
    this.load.audio("sfx-glass", "assets/audio/ui/glass.ogg");
    this.load.audio("sfx-stinger", "assets/audio/ui/stinger.ogg");
    this.load.audio("sfx-toggle", "assets/audio/ui/toggle.ogg");
  }

  create(): void {
    document.getElementById("boot-screen")?.remove();
    this.game.canvas.tabIndex = 0;
    this.game.canvas.setAttribute("role", "application");
    this.game.canvas.setAttribute("aria-label", "The Department of Misplaced Hours playable game canvas");
    this.game.canvas.setAttribute("aria-describedby", "game-accessibility-summary");
    this.game.canvas.setAttribute("aria-keyshortcuts", "Tab Shift+Tab Enter Space ArrowLeft ArrowRight ArrowUp ArrowDown M N H F1 S");
    this.input.setDefaultCursor("default");
    this.input.keyboard?.on("keydown", this.handleKeyboardShortcut, this);
    this.audio.setAssetPlayer((key, volume) => {
      const assetKey = `sfx-${key}`;
      if (this.cache.audio.exists(assetKey)) {
        this.sound.play(assetKey, { volume: Phaser.Math.Clamp(volume, 0, 1) });
      }
    });
    this.state.loadPreferences();
    this.audio.setVolume(this.state.audioVolume);
    this.audio.setMuted(this.state.muted);
    this.applyAccessibilityPreferences();
    if (this.loadFailed) {
      this.showLoadFailure();
      return;
    }
    this.showTitle();
  }

  update(): void {
    this.warnIfSaveUnavailable();
    this.pollGamepadControls();
  }

  private warnIfSaveUnavailable(): void {
    if (this.saveUnavailableWarned || !this.state.storageUnavailable() || this.domOverlay || this.loadFailed || this.titleActive) {
      return;
    }
    this.saveUnavailableWarned = true;
    this.showMessage(
      "Saves Unavailable",
      "Your browser is blocking localStorage. You can keep playing this session, but progress and preferences will reset if the page closes or reloads.",
      [{ label: "Continue", action: () => this.closeOverlay() }]
    );
  }

  private handleKeyboardShortcut(event: KeyboardEvent): void {
    if (this.domOverlay || this.loadFailed) {
      return;
    }

    const key = event.key.toLowerCase();
    const code = event.code.toLowerCase();
    if (this.titleActive) {
      if (key === "tab") {
        event.preventDefault();
        this.cycleTitleFocus(event.shiftKey ? -1 : 1);
      } else if (key === "enter" || event.key === " ") {
        event.preventDefault();
        if (this.activateTitleFocus()) {
          return;
        }
        if (GameState.hasSave()) {
          this.confirmStartNewShift();
          return;
        }
        this.startNewShift();
      } else if ((key === "c" || code === "keyc") && GameState.hasSave()) {
        event.preventDefault();
        this.continueShift();
      }
      return;
    }

    if (!this.roomTitle) {
      return;
    }

    if (key === "tab") {
      event.preventDefault();
      this.cycleKeyboardFocus(event.shiftKey ? -1 : 1);
    } else if (key === "enter" || event.key === " ") {
      if (this.activateKeyboardFocus()) {
        event.preventDefault();
      }
    } else if (key === "m" || code === "keym") {
      if (!this.acceptKeyboardShortcut(event, "m")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.showMap();
    } else if (key === "n" || code === "keyn") {
      if (!this.acceptKeyboardShortcut(event, "n")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.showNotes();
    } else if (key === "h" || code === "keyh") {
      if (!this.acceptKeyboardShortcut(event, "h")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.showHint();
    } else if (event.key === "F1") {
      if (!this.acceptKeyboardShortcut(event, "f1")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.showHelp();
    } else if (key === "s" || code === "keys") {
      if (!this.acceptKeyboardShortcut(event, "s")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.toggleMute();
    } else if (event.key === "[" || event.key === "-") {
      if (!this.acceptKeyboardShortcut(event, "volume-down")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.adjustVolume(-0.12);
    } else if (event.key === "]" || event.key === "+" || event.key === "=") {
      if (!this.acceptKeyboardShortcut(event, "volume-up")) {
        return;
      }
      event.preventDefault();
      this.audio.click();
      this.adjustVolume(0.12);
    }
  }

  private acceptKeyboardShortcut(event: KeyboardEvent, shortcutKey: string): boolean {
    const now = event.timeStamp || performance.now();
    if (event.repeat || (this.lastShortcutKey === shortcutKey && now - this.lastShortcutAt < 120)) {
      event.preventDefault();
      return false;
    }
    this.lastShortcutKey = shortcutKey;
    this.lastShortcutAt = now;
    return true;
  }

  private pollGamepadControls(): void {
    const getGamepads = navigator.getGamepads?.bind(navigator);
    if (!getGamepads || this.loadFailed) {
      return;
    }

    const pad = getGamepads().find((candidate): candidate is Gamepad => Boolean(candidate?.connected));
    if (!pad) {
      this.gamepadButtonLatch = {};
      this.gamepadNavDirection = 0;
      return;
    }

    const now = performance.now();
    const justPressed = (key: string, index: number) => {
      const button = pad.buttons[index];
      const pressed = Boolean(button?.pressed || (button?.value ?? 0) > 0.55);
      const wasPressed = this.gamepadButtonLatch[key] === true;
      this.gamepadButtonLatch[key] = pressed;
      return pressed && !wasPressed;
    };

    const navDirection = this.gamepadNavigationDirection(pad);
    if (navDirection === 0) {
      this.gamepadNavDirection = 0;
    } else if (navDirection !== this.gamepadNavDirection || now - this.gamepadNavAt > 240) {
      this.gamepadNavDirection = navDirection;
      this.gamepadNavAt = now;
      this.handleGamepadNavigate(navDirection as 1 | -1);
    }

    if (justPressed("confirm", 0)) {
      this.handleGamepadConfirm();
    }
    if (justPressed("cancel", 1)) {
      this.handleGamepadCancel();
    }
    if (justPressed("map", 8)) {
      this.handleGamepadPanelShortcut(() => this.showMap());
    }
    if (justPressed("notes", 2)) {
      this.handleGamepadPanelShortcut(() => this.showNotes());
    }
    if (justPressed("hint", 3)) {
      this.handleGamepadPanelShortcut(() => this.showHint());
    }
    if (justPressed("help", 9)) {
      this.handleGamepadPanelShortcut(() => this.showHelp());
    }
    if (justPressed("volume-down", 4)) {
      this.handleGamepadPanelShortcut(() => this.adjustVolume(-0.12));
    }
    if (justPressed("volume-up", 5)) {
      this.handleGamepadPanelShortcut(() => this.adjustVolume(0.12));
    }
  }

  private gamepadNavigationDirection(pad: Gamepad): 1 | -1 | 0 {
    const axisX = pad.axes[0] ?? 0;
    const axisY = pad.axes[1] ?? 0;
    const left = Boolean(pad.buttons[14]?.pressed) || axisX < -0.58 || axisY < -0.58;
    const right = Boolean(pad.buttons[15]?.pressed) || Boolean(pad.buttons[13]?.pressed) || axisX > 0.58 || axisY > 0.58;
    const up = Boolean(pad.buttons[12]?.pressed);

    if (left || up) {
      return -1;
    }
    if (right) {
      return 1;
    }
    return 0;
  }

  private handleGamepadNavigate(direction: 1 | -1): void {
    if (this.domOverlay) {
      this.focusModalButton(direction);
      return;
    }
    if (this.titleActive) {
      this.cycleTitleFocus(direction);
      return;
    }
    if (this.roomTitle) {
      this.cycleKeyboardFocus(direction);
    }
  }

  private handleGamepadConfirm(): void {
    if (this.domOverlay) {
      this.activateFocusedModalButton();
      return;
    }
    if (this.titleActive) {
      this.activateTitleFocusOrDefault();
      return;
    }
    if (this.roomTitle && this.keyboardFocusIndex < 0) {
      this.cycleKeyboardFocus(1);
      return;
    }
    this.activateKeyboardFocus();
  }

  private handleGamepadCancel(): void {
    if (this.domOverlay) {
      this.audio.click();
      this.closeOverlay();
      return;
    }
    if (!this.titleActive && this.roomTitle && this.selectedItem) {
      const item = ITEMS[this.selectedItem];
      this.selectedItem = undefined;
      this.createHudRefresh();
      this.say(`Put away ${item.name}.`);
    }
  }

  private handleGamepadPanelShortcut(action: () => void): void {
    if (this.domOverlay || this.loadFailed || this.titleActive || !this.roomTitle) {
      return;
    }
    this.audio.click();
    action();
  }

  private showLoadingScreen(): void {
    this.cameras.main.setBackgroundColor("#080a08");
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x080a08, 1);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, 680, 260, 0x0f160f, 0.96).setStrokeStyle(2, 0xd7b85f, 0.78);
    this.add
      .text(GAME_W / 2, 320, "THE DEPARTMENT\nOF MISPLACED HOURS", {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "38px",
        color: "#f5edcf",
        align: "center",
        stroke: "#050705",
        strokeThickness: 5,
        lineSpacing: -6
      })
      .setOrigin(0.5);
    const track = this.add.rectangle(GAME_W / 2, 438, 520, 18, 0x1b2417, 1).setStrokeStyle(2, 0x806036, 0.8);
    const bar = this.add.rectangle(track.x - 258, track.y, 4, 10, 0xf0d079, 1).setOrigin(0, 0.5);
    const percent = this.add
      .text(GAME_W / 2, 480, "Loading case files... 0%", {
        fontSize: "20px",
        color: "#d8cda9",
        align: "center"
      })
      .setOrigin(0.5);

    this.load.on("progress", (value: number) => {
      if (this.loadFailed) {
        return;
      }
      bar.displayWidth = Math.max(4, 516 * value);
      percent.setText(`Loading case files... ${Math.round(value * 100)}%`);
    });

    this.load.on("loaderror", (file: LoadFailureFile) => {
      if (!this.recordLoadFailure(file)) {
        return;
      }
      document.getElementById("boot-screen")?.remove();
      bar.displayWidth = 516;
      bar.setFillStyle(0xb9402e, 1);
      percent.setColor("#ffd7c2");
      percent.setText("Asset load failed. Preparing recovery screen...");
    });
  }

  private recordLoadFailure(file: LoadFailureFile): boolean {
    const key = file.key ? String(file.key) : "unknown";
    const url = file.url ?? file.src;
    const detail = url ? `${key} (${String(url)})` : key;
    if (key.startsWith("sfx-")) {
      if (!this.optionalLoadErrors.includes(detail)) {
        this.optionalLoadErrors.push(detail);
      }
      document.getElementById("game")?.setAttribute("data-audio-load-warning", this.optionalLoadErrors.join(" | "));
      return false;
    }

    this.loadFailed = true;
    if (!this.loadErrors.includes(detail)) {
      this.loadErrors.push(detail);
    }
    const game = document.getElementById("game");
    game?.setAttribute("data-load-state", "asset-failed");
    game?.setAttribute("data-load-error", this.loadErrors.join(" | "));
    return true;
  }

  private showLoadFailure(): void {
    this.clearScene();
    const details =
      this.loadErrors.length > 0
        ? this.loadErrors.slice(0, 4).join("\n")
        : "A required image file did not load.";
    this.cameras.main.setBackgroundColor("#080a08");
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x080a08, 1);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, 780, 420, 0x11170f, 0.98).setStrokeStyle(3, 0xd7b85f, 0.9);
    this.add.rectangle(GAME_W / 2, 190, 620, 5, 0xd7b85f, 0.9);
    this.add.rectangle(GAME_W / 2, 552, 620, 3, 0x806036, 0.95);
    this.add
      .text(GAME_W / 2, 248, "ASSET LOAD FAILED", {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "48px",
        color: "#f5edcf",
        align: "center",
        stroke: "#050705",
        strokeThickness: 6
      })
      .setOrigin(0.5);
    this.add
      .text(
        GAME_W / 2,
        392,
        `The game could not load required release files.\n\n${details}\n\nCheck that the release folder was uploaded intact, then reload.`,
        {
          fontSize: "24px",
          color: "#e9dec0",
          align: "center",
          lineSpacing: 6,
          wordWrap: { width: 660 }
        }
      )
      .setOrigin(0.5);
    this.makeButton(GAME_W / 2, 610, 260, 64, "Reload", () => window.location.reload(), 10);
    document.getElementById("game")?.setAttribute("data-load-state", "asset-failed-visible");
  }

  private showTitle(): void {
    this.audio.stopPhoneClue();
    this.audio.stopAmbience();
    this.clearScene();
    this.titleActive = true;
    this.add.image(GAME_W / 2, GAME_H / 2, "bg-title").setDisplaySize(GAME_W, GAME_H);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x071008, 0.32);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, 0.16);
    this.addVignette();

    this.add
      .text(GAME_W / 2, 108, "THE DEPARTMENT\nOF MISPLACED HOURS", {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "58px",
        color: "#f5edcf",
        align: "center",
        stroke: "#15110d",
        strokeThickness: 7,
        lineSpacing: -8
      })
      .setOrigin(0.5);

    this.add
      .text(
        GAME_W / 2,
        245,
        "Night shift begins at 12:00. The clocks disagree. The forms already know your name.",
        {
          fontSize: "21px",
          color: "#f1e6c2",
          align: "center",
          wordWrap: { width: 760 }
        }
      )
      .setOrigin(0.5);

    const hasSave = GameState.hasSave();
    this.titleFocusTargets = [
      {
        label: "Start New Shift",
        x: 600,
        y: 390,
        w: 300,
        h: 56,
        action: () => {
          if (GameState.hasSave()) {
            this.confirmStartNewShift();
            return;
          }
          this.startNewShift();
        }
      },
      ...(hasSave
        ? [
            {
              label: "Continue Shift",
              x: 600,
              y: 462,
              w: 300,
              h: 52,
              action: () => this.continueShift()
            }
          ]
        : []),
      {
        label: "Controls",
        x: 600,
        y: 534,
        w: 300,
        h: 48,
        action: () => {
          this.showMessage(
            "Controls",
            "Move the cursor around the room. When it becomes a hand and the status line names something, click to inspect it. Select an inventory item first to try using it on the room.\n\nKeyboard: Tab cycles targets, Enter or Space activates. Controller: D-pad or stick cycles focus, A selects, B closes panels.",
            [{ label: "Close", action: () => this.closeOverlay() }]
          );
        }
      }
    ];
    this.titleFocusTargets.forEach((target) => {
      this.makeButton(target.x, target.y, target.w, target.h, target.label, target.action);
    });

    this.add
      .text(GAME_W / 2, 742, "A surreal office mystery for headphones, curiosity, and poor career boundaries.", {
        fontSize: "17px",
        color: "#d8cda9",
        align: "center"
      })
      .setOrigin(0.5);
  }

  private startNewShift(): void {
    void this.audio.resume();
    this.state.reset();
    this.startGame(false);
  }

  private confirmStartNewShift(): void {
    this.showMessage(
      "Start New Shift?",
      "A saved shift already exists. Starting over will erase that progress, but keep audio and accessibility preferences.",
      [
        {
          label: "Start New",
          action: () => {
            this.closeOverlay();
            this.startNewShift();
          }
        },
        {
          label: "Continue",
          action: () => {
            this.closeOverlay();
            this.continueShift();
          }
        },
        { label: "Cancel", action: () => this.closeOverlay() }
      ],
      false,
      "Continue"
    );
  }

  private continueShift(): void {
    void this.audio.resume();
    if (this.state.load()) {
      this.startGame(true);
      return;
    }
    this.state.reset();
    this.applyAccessibilityPreferences();
    this.showTitle();
    this.showMessage("Save Missing", "That saved shift is corrupt or unavailable. Start a new shift instead.");
  }

  private startGame(fromSave: boolean): void {
    this.audio.setVolume(this.state.audioVolume);
    this.audio.setMuted(this.state.muted);
    this.applyAccessibilityPreferences();
    if (!fromSave) {
      this.showRoom("reception");
      this.showMessage(
        "Midnight Orientation",
        "The badge drawer opens before you touch it. A visitor badge slides out with your photograph, though the picture was taken tomorrow. Somewhere behind the desk, a phone begins counting its own teeth.",
        [
          {
            label: "Clock In",
            action: () => {
              this.state.add("visitorBadge");
              this.state.setFlag("introSeen", true);
              this.audio.pickup();
              this.state.save();
              this.closeOverlayAndRefresh();
            }
          }
        ]
      );
      return;
    }

    if (this.state.ending) {
      this.showEnding(this.state.ending, true);
      return;
    }
    this.state.room = this.validLoadedRoom(this.state.room);
    this.showRoom(this.state.room);
  }

  private validLoadedRoom(roomId: RoomId): RoomId {
    const canUseInnerRooms = this.state.flag("clockSolved");
    const canUseMirror =
      canUseInnerRooms && this.state.has("auditWarrant") && this.state.flag("glassCaseCollected") && this.state.flag("vendingSolved");

    if (roomId === "mirror" && !canUseMirror) {
      return canUseInnerRooms ? "security" : this.state.flag("clockUnlocked") ? "clock" : "reception";
    }
    if (["security", "interrogation", "archive", "break"].includes(roomId) && !canUseInnerRooms) {
      return this.state.flag("clockUnlocked") ? "clock" : "reception";
    }
    if (roomId === "clock" && !this.state.flag("clockUnlocked") && !canUseInnerRooms) {
      return "reception";
    }
    return roomId;
  }

  private showRoom(roomId: RoomId, preserveSelection = false): void {
    this.clearScene();
    this.closeOverlay();
    if (!preserveSelection) {
      this.selectedItem = undefined;
    }
    this.lastPuzzleInput = [];
    this.state.room = roomId;
    this.state.save();

    const room = ROOMS[roomId];
    this.audio.startAmbience(room.ambience);

    this.add.image(GAME_W / 2, GAME_H / 2, room.background).setDisplaySize(GAME_W, GAME_H);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x061008, 0.1);
    this.createAtmosphere(roomId);
    this.addVignette();
    this.createHud();
    this.createHotspots(this.getHotspots(roomId));
    this.createInventory();
    this.say(`${room.name}: ${this.roomStatus(roomId)}`);
  }

  private clearScene(): void {
    this.closeOverlay();
    this.tweens.killAll();
    this.children.each((child) => {
      const gameObject = child as Phaser.GameObjects.GameObject & { input?: Phaser.Types.Input.InteractiveObject };
      if (gameObject.input) {
        this.input.disable(gameObject, true);
      }
    });
    this.input.resetCursor();
    this.children.removeAll(true);
    this.overlay = undefined;
    this.hoverLabel = undefined;
    this.roomTitle = undefined;
    this.hoverFocus = undefined;
    this.titleActive = false;
    this.keyboardHotspots = [];
    this.keyboardInventoryTargets = [];
    this.keyboardFocusIndex = -1;
    this.titleFocusTargets = [];
    this.titleFocusIndex = -1;
  }

  private createHud(): void {
    this.add.rectangle(GAME_W / 2, 32, GAME_W, 64, 0x080b08, 0.72).setDepth(20);
    this.roomTitle = this.add
      .text(26, 18, ROOMS[this.state.room].name.toUpperCase(), {
        fontSize: "20px",
        color: "#f2e8c9",
        fontStyle: "bold",
        fixedWidth: 486
      })
      .setDepth(21);

    this.hoverLabel = this.add
      .text(26, 50, "", {
        fontSize: "19px",
        color: "#d4c798",
        fixedWidth: 486,
        wordWrap: { width: 486, useAdvancedWrap: true }
      })
      .setDepth(21);

    this.makeButton(548, 32, 76, 36, "Map", () => this.showMap(), 22);
    this.makeButton(638, 32, 82, 36, "Notes", () => this.showNotes(), 22);
    this.makeButton(730, 32, 76, 36, "Hint", () => this.showHint(), 22);
    this.makeButton(816, 32, 76, 36, "Help", () => this.showHelp(), 22);
    this.makeButton(928, 32, 88, 36, this.state.muted ? "Muted" : "Sound", () => this.toggleMute(), 22);
    this.makeButton(1014, 32, 48, 36, "-", () => this.adjustVolume(-0.12), 22);
    this.makeButton(1066, 32, 48, 36, "+", () => this.adjustVolume(0.12), 22);
    this.addHudHitZone(1014, 32, 50, 40, () => this.adjustVolume(-0.12));
    this.addHudHitZone(1066, 32, 50, 40, () => this.adjustVolume(0.12));
    this.makeButton(1132, 32, 82, 36, "Reset", () => this.confirmReset(), 22);
  }

  private addHudHitZone(x: number, y: number, w: number, h: number, action: () => void): void {
    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true }).setDepth(80);
    zone.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      this.audio.hover();
    });
    zone.on("pointerout", () => this.input.setDefaultCursor("default"));
    zone.on("pointerdown", () => {
      this.audio.click();
      action();
    });
  }

  private createInventory(): void {
    this.keyboardInventoryTargets = [];
    this.add.rectangle(GAME_W / 2, 750, GAME_W, 100, 0x090c08, 0.82).setDepth(20);
    this.add
      .text(24, 710, "INVENTORY", {
        fontSize: "17px",
        color: "#b7af8a",
        fontStyle: "bold"
      })
      .setDepth(21);

    const items = [...this.state.inventory];
    if (items.length === 0) {
      this.add
        .text(24, 744, "Empty. The inbox is optimistic.", {
          fontSize: "18px",
          color: "#e6d9b0"
        })
        .setDepth(21);
      return;
    }

    const firstSlotX = items.length > 10 ? 64 : 116;
    const lastSlotX = GAME_W - 64;
    const gap = items.length <= 1 ? 96 : Math.min(96, (lastSlotX - firstSlotX) / (items.length - 1));
    const slotWidth = gap < 84 || items.length > 10 ? 68 : 82;

    items.forEach((itemId, index) => {
      const item = ITEMS[itemId];
      const x = firstSlotX + index * gap;
      const selected = this.selectedItem === itemId;
      const compact = slotWidth < 76;
      const spent = this.isSpentItem(itemId);
      const slot = this.add.rectangle(x, 752, slotWidth, 68, selected ? 0x74342b : spent ? 0x15190f : 0x222719, 0.94);
      slot.setStrokeStyle(2, selected ? 0xf0d079 : spent ? 0x4e4c3c : 0x7f7a5d, selected ? 1 : spent ? 0.48 : 0.74).setDepth(21);
      const icon = this.createItemIcon(itemId, x, 738, selected, compact).setAlpha(spent && !selected ? 0.52 : 1);
      const label = this.add
        .text(x, 766, item.shortName, {
          fontSize: compact ? "11px" : "14px",
          color: spent && !selected ? "#8e876a" : "#d6c89b",
          align: "center"
        })
        .setOrigin(0.5)
        .setDepth(22);

      const hit = this.add.zone(x, 752, slotWidth, 68).setInteractive({ useHandCursor: true }).setDepth(23);
      this.keyboardInventoryTargets.push({ itemId, label: item.name, x, y: 752, w: slotWidth, h: 68 });
      hit.on("pointerover", () => {
        this.audio.hover();
        this.setHover(`${item.name}: ${item.description}`);
        slot.setStrokeStyle(2, 0xf0d079, 1);
      });
      hit.on("pointerout", () => {
        this.setHover("");
        slot.setStrokeStyle(2, selected ? 0xf0d079 : 0x7f7a5d, selected ? 1 : 0.74);
      });
      hit.on("pointerdown", () => {
        this.audio.click();
        this.toggleInventoryItem(itemId);
      });

      icon.setData("slotHit", hit);
      label.setData("slotHit", hit);
    });
  }

  private toggleInventoryItem(itemId: ItemId): void {
    const item = ITEMS[itemId];
    this.selectedItem = this.selectedItem === itemId ? undefined : itemId;
    this.createHudRefresh();
    this.say(this.selectedItem ? `Selected ${item.name}.` : `Put away ${item.name}.`);
  }

  private createItemIcon(
    itemId: ItemId,
    x: number,
    y: number,
    selected: boolean,
    compact: boolean
  ): Phaser.GameObjects.Container {
    const scale = compact ? 0.82 : 1;
    const ink = selected ? 0xfff4c8 : 0xe7ddba;
    const dim = selected ? 0xd7b85f : 0x9f956e;
    const red = 0xb9402e;
    const parts: Phaser.GameObjects.GameObject[] = [];

    const rect = (rx: number, ry: number, w: number, h: number, fill = ink, alpha = 1) => {
      const shape = this.add.rectangle(rx * scale, ry * scale, w * scale, h * scale, fill, alpha);
      shape.setStrokeStyle(Math.max(1, 2 * scale), dim, 0.9);
      parts.push(shape);
      return shape;
    };
    const circle = (rx: number, ry: number, radius: number, fill = ink, alpha = 1) => {
      const shape = this.add.circle(rx * scale, ry * scale, radius * scale, fill, alpha);
      shape.setStrokeStyle(Math.max(1, 2 * scale), dim, 0.9);
      parts.push(shape);
      return shape;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, color = dim) => {
      const shape = this.add.line(0, 0, x1 * scale, y1 * scale, x2 * scale, y2 * scale, color, 1);
      shape.setLineWidth(Math.max(1, 2 * scale));
      parts.push(shape);
      return shape;
    };

    if (itemId === "rubberStamp") {
      rect(-8, -3, 14, 18);
      rect(0, 10, 30, 8);
    } else if (itemId === "visitorBadge") {
      rect(0, 2, 30, 26, ink, 0.28);
      circle(-7, -2, 5, ink, 0.9);
      line(3, -5, 12, -5);
      line(3, 2, 12, 2);
      line(-10, 11, 10, 11);
    } else if (itemId === "timeToken") {
      circle(0, 2, 15, ink, 0.22);
      circle(0, 2, 8, ink, 0.12);
      line(0, -7, 0, 11, ink);
    } else if (itemId === "paperCup" || itemId === "memoryCup") {
      const cup = this.add.triangle(0, 0, -13 * scale, -10 * scale, 13 * scale, -10 * scale, 9 * scale, 15 * scale, ink, 0.22);
      cup.setStrokeStyle(Math.max(1, 2 * scale), dim, 0.9);
      parts.push(cup);
      if (itemId === "memoryCup") {
        line(-7, -17, -3, -23, ink);
        line(2, -17, 6, -23, ink);
        line(9, -16, 13, -21, ink);
      }
    } else if (itemId === "misfiledFolder") {
      rect(2, 4, 32, 22, ink, 0.18);
      rect(-7, -8, 16, 8, ink, 0.22);
      line(-10, 2, 11, 2);
    } else if (itemId === "mirrorShard") {
      const shard = this.add.triangle(0, 0, -12 * scale, 15 * scale, 2 * scale, -16 * scale, 15 * scale, 8 * scale, ink, 0.22);
      shard.setStrokeStyle(Math.max(1, 2 * scale), dim, 0.95);
      parts.push(shard);
      line(-5, 5, 8, -5, ink);
    } else if (itemId === "serverFuse") {
      rect(0, 1, 28, 12, ink, 0.2);
      rect(-18, 1, 8, 8, dim, 0.6);
      rect(18, 1, 8, 8, dim, 0.6);
      line(-7, 1, 7, 1, ink);
    } else if (itemId === "rainCipher") {
      line(-12, -14, -12, 11, ink);
      line(0, -10, 0, 11, ink);
      line(12, -5, 12, 11, ink);
      circle(12, 16, 3, ink, 0.8);
    } else if (itemId === "securityKey") {
      circle(-10, 0, 8, ink, 0.18);
      rect(8, 0, 28, 5, ink, 0.65);
      rect(18, 7, 5, 10, ink, 0.65);
      rect(25, 5, 5, 7, ink, 0.65);
    } else if (itemId === "auditWarrant") {
      rect(0, 1, 28, 30, ink, 0.2);
      circle(8, 9, 5, red, 0.72);
      line(-8, -7, 8, -7);
      line(-8, 0, 6, 0);
    } else {
      rect(0, 1, 28, 30, ink, 0.2);
      line(-8, -7, 8, -7);
      line(-8, 0, 8, 0);
      line(-8, 7, 3, 7);
      if (itemId === "stampedForm") {
        circle(8, 9, 5, red, 0.72);
      }
      if (itemId === "selfFile") {
        circle(0, 2, 6, ink, 0.14);
      }
    }

    return this.add.container(x, y, parts).setDepth(22);
  }

  private isSpentItem(itemId: ItemId): boolean {
    if (itemId === "visitorBadge") {
      return this.state.has("securityKey");
    }
    if (itemId === "stampedForm") {
      return this.state.flag("clockUnlocked") && this.state.has("securityKey");
    }
    if (itemId === "securityKey") {
      return this.state.has("auditWarrant");
    }
    if (itemId === "rainCipher") {
      return this.state.flag("vendingSolved");
    }
    if (itemId === "misfiledFolder") {
      return this.state.flag("folderCrossReferenced") || this.state.flag("serverSolved");
    }
    if (itemId === "timeToken" || itemId === "paperCup" || itemId === "mirrorShard" || itemId === "serverFuse") {
      return false;
    }
    return false;
  }

  private createHudRefresh(): void {
    this.showRoom(this.state.room, true);
  }

  private createHotspots(hotspots: Hotspot[]): void {
    this.keyboardHotspots = hotspots;
    for (const spot of hotspots) {
      const zone = this.add.zone(spot.x, spot.y, spot.w, spot.h).setInteractive({ useHandCursor: true }).setDepth(11);
      zone.on("pointerover", () => {
        this.input.setDefaultCursor("pointer");
        this.audio.hover();
        this.showHotspotFocus(spot);
        this.setHover(this.selectedItem ? `${spot.label} with ${ITEMS[this.selectedItem].name}` : spot.label);
      });
      zone.on("pointerout", () => {
        this.input.setDefaultCursor("default");
        this.hideHotspotFocus();
        this.setHover("");
      });
      zone.on("pointerdown", () => {
        this.audio.click();
        this.hideHotspotFocus();
        spot.action();
      });
    }
  }

  private keyboardTargets(): KeyboardFocusTarget[] {
    return [
      ...this.keyboardHotspots.map((spot) => ({ kind: "hotspot" as const, spot })),
      ...this.keyboardInventoryTargets.map((target) => ({ kind: "inventory" as const, ...target }))
    ];
  }

  private cycleKeyboardFocus(direction: 1 | -1): void {
    const targets = this.keyboardTargets();
    if (targets.length === 0) {
      this.keyboardFocusIndex = -1;
      this.hideHotspotFocus();
      this.setHover("");
      return;
    }

    if (this.keyboardFocusIndex < 0 || this.keyboardFocusIndex >= targets.length) {
      this.keyboardFocusIndex = direction > 0 ? 0 : targets.length - 1;
    } else {
      this.keyboardFocusIndex = (this.keyboardFocusIndex + direction + targets.length) % targets.length;
    }
    this.showKeyboardFocus(targets[this.keyboardFocusIndex], true);
  }

  private activateKeyboardFocus(): boolean {
    const targets = this.keyboardTargets();
    const target = targets[this.keyboardFocusIndex];
    if (!target) {
      return false;
    }

    this.audio.click();
    this.keyboardFocusIndex = -1;
    this.hideHotspotFocus();
    this.setHover("");
    if (target.kind === "hotspot") {
      target.spot.action();
    } else {
      this.toggleInventoryItem(target.itemId);
    }
    return true;
  }

  private showKeyboardFocus(target: KeyboardFocusTarget, playSound: boolean): void {
    if (playSound) {
      this.audio.hover();
    }
    if (target.kind === "hotspot") {
      this.showHotspotFocus(target.spot);
      this.setHover(this.selectedItem ? `${target.spot.label} with ${ITEMS[this.selectedItem].name}` : target.spot.label);
      return;
    }

    this.showHotspotFocus({
      id: `inventory-${target.itemId}`,
      label: target.label,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
      action: () => this.toggleInventoryItem(target.itemId)
    });
    this.setHover(`${target.label}: ${ITEMS[target.itemId].description}`);
  }

  private cycleTitleFocus(direction: 1 | -1): void {
    if (this.titleFocusTargets.length === 0) {
      this.titleFocusIndex = -1;
      this.hideHotspotFocus();
      return;
    }

    if (this.titleFocusIndex < 0 || this.titleFocusIndex >= this.titleFocusTargets.length) {
      this.titleFocusIndex = direction > 0 ? 0 : this.titleFocusTargets.length - 1;
    } else {
      this.titleFocusIndex = (this.titleFocusIndex + direction + this.titleFocusTargets.length) % this.titleFocusTargets.length;
    }
    this.showTitleFocus(this.titleFocusTargets[this.titleFocusIndex], true);
  }

  private activateTitleFocusOrDefault(): void {
    if (this.titleFocusTargets.length === 0) {
      return;
    }
    if (this.titleFocusIndex < 0 || this.titleFocusIndex >= this.titleFocusTargets.length) {
      this.titleFocusIndex = 0;
      this.showTitleFocus(this.titleFocusTargets[this.titleFocusIndex], false);
    }
    this.activateTitleFocus();
  }

  private activateTitleFocus(): boolean {
    const target = this.titleFocusTargets[this.titleFocusIndex];
    if (!target) {
      return false;
    }
    this.audio.click();
    this.hideHotspotFocus();
    target.action();
    return true;
  }

  private showTitleFocus(target: TitleFocusTarget, playSound: boolean): void {
    if (playSound) {
      this.audio.hover();
    }
    this.showHotspotFocus({
      id: `title-${target.label}`,
      label: target.label,
      x: target.x,
      y: target.y,
      w: target.w,
      h: target.h,
      action: target.action
    });
  }

  private showHotspotFocus(spot: Hotspot): void {
    this.hideHotspotFocus();
    const w = Math.max(36, spot.w + 10);
    const h = Math.max(28, spot.h + 10);
    const alpha = this.selectedItem ? 0.8 : 0.58;
    const glow = this.add.rectangle(0, 0, w, h, 0xf0d079, 0.035).setStrokeStyle(1, 0xf0d079, 0.18);
    const corner = Math.min(30, Math.max(14, Math.min(w, h) * 0.18));
    const halfW = w / 2;
    const halfH = h / 2;
    const lines = [
      this.add.line(0, 0, -halfW, -halfH, -halfW + corner, -halfH, 0xf0d079, alpha),
      this.add.line(0, 0, -halfW, -halfH, -halfW, -halfH + corner, 0xf0d079, alpha),
      this.add.line(0, 0, halfW, -halfH, halfW - corner, -halfH, 0xf0d079, alpha),
      this.add.line(0, 0, halfW, -halfH, halfW, -halfH + corner, 0xf0d079, alpha),
      this.add.line(0, 0, -halfW, halfH, -halfW + corner, halfH, 0xf0d079, alpha),
      this.add.line(0, 0, -halfW, halfH, -halfW, halfH - corner, 0xf0d079, alpha),
      this.add.line(0, 0, halfW, halfH, halfW - corner, halfH, 0xf0d079, alpha),
      this.add.line(0, 0, halfW, halfH, halfW, halfH - corner, 0xf0d079, alpha)
    ];
    lines.forEach((line) => line.setLineWidth(3));

    const label = this.add
      .text(0, -halfH - 9, spot.label, {
        fontSize: "18px",
        color: "#fff0c5",
        fontStyle: "bold",
        align: "center",
        stroke: "#050705",
        strokeThickness: 4
      })
      .setOrigin(0.5, 1);
    const labelBg = this.add
      .rectangle(0, label.y - label.height / 2 + 1, label.width + 18, label.height + 8, 0x080b08, 0.82)
      .setStrokeStyle(1, 0xf0d079, 0.35);

    this.hoverFocus = this.add.container(spot.x, spot.y, [glow, ...lines, labelBg, label]).setDepth(12);
  }

  private hideHotspotFocus(): void {
    this.hoverFocus?.destroy();
    this.hoverFocus = undefined;
  }

  private getHotspots(roomId: RoomId): Hotspot[] {
    if (roomId === "reception") {
      return [
        { id: "forms", label: "In-Tray", x: 226, y: 650, w: 170, h: 100, action: () => this.receptionForms() },
        { id: "stamp", label: "Stamp", x: 590, y: 660, w: 100, h: 110, action: () => this.receptionStamp() },
        { id: "badge", label: "Badge Drawer", x: 456, y: 430, w: 86, h: 180, action: () => this.badgeDrawer() },
        { id: "phone", label: "Future Phone", x: 875, y: 635, w: 190, h: 120, action: () => this.futurePhone() },
        { id: "circleDoor", label: "Circle Door", x: 360, y: 374, w: 134, h: 270, action: () => this.circleDoor() },
        { id: "triangleDoor", label: "Triangle Door", x: 612, y: 376, w: 136, h: 270, action: () => this.triangleDoor() },
        { id: "memo", label: "Desk Memo", x: 706, y: 656, w: 140, h: 92, action: () => this.showReceptionMemo() }
      ];
    }

    if (roomId === "clock") {
      return [
        { id: "clockPuzzle", label: "Mood Clocks", x: 610, y: 274, w: 570, h: 210, action: () => this.clockPuzzle() },
        { id: "calendar", label: "Personnel Calendar", x: 936, y: 314, w: 168, h: 144, action: () => this.showCalendarClue() },
        { id: "security", label: "Security Office", x: 768, y: 492, w: 160, h: 250, action: () => this.goSecurity() },
        { id: "archive", label: "Archive Elevator", x: 1000, y: 502, w: 172, h: 260, action: () => this.goArchive() },
        { id: "break", label: "Break Room Stairs", x: 184, y: 500, w: 190, h: 270, action: () => this.goBreak() },
        { id: "interrogation", label: "Interrogation Booth", x: 420, y: 506, w: 170, h: 260, action: () => this.goInterrogation() },
        { id: "back", label: "Reception", x: 604, y: 662, w: 180, h: 72, action: () => this.showRoom("reception") }
      ];
    }

    if (roomId === "security") {
      return [
        { id: "monitors", label: "Monitor Bank", x: 200, y: 386, w: 350, h: 280, action: () => this.securityMonitors() },
        { id: "safe", label: "Evidence Safe", x: 522, y: 392, w: 210, h: 330, action: () => this.evidenceSafe() },
        { id: "keys", label: "Key Cabinet", x: 696, y: 352, w: 150, h: 230, action: () => this.keyCabinet() },
        { id: "board", label: "Incident Board", x: 1026, y: 326, w: 250, h: 266, action: () => this.incidentBoard() },
        { id: "desk", label: "Security Log", x: 570, y: 690, w: 250, h: 96, action: () => this.securityLog() },
        { id: "clock", label: "Clock Hall", x: 866, y: 456, w: 152, h: 300, action: () => this.showRoom("clock") },
        { id: "archive", label: "Records Archive", x: 1060, y: 682, w: 170, h: 72, action: () => this.goArchive() }
      ];
    }

    if (roomId === "interrogation") {
      return [
        { id: "recorder", label: "Tape Recorder", x: 520, y: 532, w: 220, h: 126, action: () => this.tapeRecorder() },
        { id: "window", label: "Rain Window", x: 292, y: 300, w: 260, h: 220, action: () => this.rainWindow() },
        { id: "file", label: "Interview File", x: 638, y: 622, w: 260, h: 118, action: () => this.interviewFile() },
        { id: "clock", label: "Handless Clock", x: 862, y: 246, w: 142, h: 142, action: () => this.handlessClock() },
        { id: "clockHall", label: "Clock Hall", x: 1110, y: 650, w: 150, h: 100, action: () => this.showRoom("clock") },
        { id: "break", label: "Break Room", x: 102, y: 660, w: 160, h: 92, action: () => this.showRoom("break") }
      ];
    }

    if (roomId === "archive") {
      return [
        { id: "drawers", label: "Index Drawers", x: 356, y: 420, w: 360, h: 352, action: () => this.archiveDrawers() },
        { id: "case", label: "Glass Case", x: 706, y: 394, w: 220, h: 224, action: () => this.glassCase() },
        { id: "token", label: "Coin Drawer", x: 910, y: 558, w: 144, h: 140, action: () => this.coinDrawer() },
        { id: "table", label: "Archive Table", x: 610, y: 646, w: 320, h: 110, action: () => this.archiveTable() },
        { id: "security", label: "Security Office", x: 250, y: 674, w: 170, h: 78, action: () => this.showRoom("security") },
        { id: "clock", label: "Clock Hall", x: 100, y: 674, w: 154, h: 78, action: () => this.showRoom("clock") },
        { id: "break", label: "Break Room", x: 1082, y: 674, w: 160, h: 78, action: () => this.showRoom("break") }
      ];
    }

    if (roomId === "break") {
      return [
        { id: "cork", label: "Cork Board", x: 304, y: 250, w: 260, h: 180, action: () => this.corkBoard() },
        { id: "cups", label: "Paper Cups", x: 398, y: 606, w: 140, h: 100, action: () => this.paperCups() },
        { id: "vending", label: "Memory Vending", x: 854, y: 396, w: 250, h: 430, action: () => this.vendingMachine() },
        { id: "microwave", label: "Microwave", x: 548, y: 456, w: 140, h: 126, action: () => this.microwave() },
        { id: "archive", label: "Records Archive", x: 110, y: 674, w: 180, h: 80, action: () => this.showRoom("archive") },
        { id: "security", label: "Security Office", x: 490, y: 676, w: 160, h: 80, action: () => this.showRoom("security") },
        { id: "interrogation", label: "Interrogation Booth", x: 640, y: 676, w: 190, h: 80, action: () => this.showRoom("interrogation") },
        { id: "mirror", label: "Mirror Office", x: 1080, y: 674, w: 170, h: 80, action: () => this.goMirror() }
      ];
    }

    return [
      { id: "mirror", label: "Black Mirror", x: 334, y: 346, w: 250, h: 420, action: () => this.blackMirror() },
      { id: "server", label: "Server Console", x: 858, y: 438, w: 274, h: 300, action: () => this.serverConsole() },
      { id: "intercom", label: "Red Intercom", x: 612, y: 596, w: 180, h: 120, action: () => this.redIntercom() },
      { id: "exit", label: "Exit Door", x: 1080, y: 386, w: 176, h: 360, action: () => this.exitDoor() },
      { id: "break", label: "Break Room", x: 112, y: 680, w: 160, h: 72, action: () => this.showRoom("break") }
    ];
  }

  private receptionForms(): void {
    if (this.selectedItem === "rubberStamp" && this.state.has("blankForm")) {
      this.makeStampedForm();
      return;
    }
    if (this.state.add("blankForm")) {
      this.audio.pickup();
      this.say("You take a Blank Form 11-H. It smells like rain trapped in a copier.");
      this.state.save();
      this.createHudRefresh();
      return;
    }
    this.showMessage(
      "In-Tray",
      "The remaining forms politely refuse to be born. One blank form is more than enough paperwork for one vanished life."
    );
  }

  private receptionStamp(): void {
    if (!this.state.has("rubberStamp")) {
      this.state.add("rubberStamp");
      this.audio.pickup();
      this.say("You pocket the Rubber Stamp. It leaves a red oval on your palm that says MAYBE.");
      this.state.save();
      this.createHudRefresh();
      return;
    }
    if (this.selectedItem === "blankForm" || this.state.has("blankForm")) {
      this.makeStampedForm();
      return;
    }
    this.showMessage("Rubber Stamp", "The stamp clicks by itself: one official heartbeat, then silence.");
  }

  private makeStampedForm(): void {
    if (!this.state.has("blankForm")) {
      this.audio.fail();
      this.showMessage("Stamp", "You need a form before the stamp can wound it.");
      return;
    }
    if (!this.state.has("rubberStamp")) {
      this.audio.fail();
      this.showMessage("Stamp", "The desk has the appetite of a stamp pad, but you need the stamp itself.");
      return;
    }
      if (!this.state.has("stampedForm")) {
      this.state.remove("blankForm");
      this.state.remove("rubberStamp");
      this.state.add("stampedForm");
      this.state.setFlag("formStamped");
      this.selectedItem = undefined;
      this.audio.success();
      this.state.save();
      this.showMessage(
        "Form 11-H",
        "The stamp slams down too hard. The form now reads: REQUEST TO ENTER A ROOM THAT ENTERED YOU FIRST.",
        [{ label: "Accept", action: () => this.closeOverlayAndRefresh() }]
      );
    }
  }

  private badgeDrawer(): void {
    if (this.state.has("visitorBadge")) {
      this.showMessage("Badge Drawer", "The empty drawer contains a stale rectangle of warmth where your badge waited.");
      return;
    }
    this.state.add("visitorBadge");
    this.audio.pickup();
    this.state.save();
    this.showMessage(
      "Badge Drawer",
      "You take the Visitor Badge. The photo shows you looking toward this drawer, surprised that you needed a second chance.",
      [{ label: "Close", action: () => this.closeOverlayAndRefresh() }]
    );
  }

  private futurePhone(): void {
    this.state.setFlag("heardPhone");
    const started = this.audio.playPhoneClue();
    this.state.save();
    this.showMessage(
      "Future Phone",
      started
        ? "The receiver gnashes out three groups of clicks. Count them by ear, then write the number in your head. Beneath the clicks, a future version of you whispers, 'Do not buy the hour unless you can carry it.'"
        : "The receiver is still speaking. Let the three click-groups finish before you replay them."
    );
  }

  private circleDoor(): void {
    if (this.selectedItem === "stampedForm") {
      this.state.setFlag("clockUnlocked");
      this.selectedItem = undefined;
      this.audio.success();
      this.state.save();
      this.showRoom("clock");
      return;
    }

    this.audio.fail();
    this.showMessage(
      "Circle Door",
      this.state.has("stampedForm")
        ? "The circular seal sniffs the air. Select the Stamped Form, then present it to the door."
        : "The circular seal on the door sniffs for red ink. A small security notice adds: MIRROR CONTACT REQUIRES AUDIT AUTHORITY."
    );
  }

  private triangleDoor(): void {
    if (!this.state.flag("clockSolved")) {
      this.audio.fail();
      this.showMessage("Triangle Door", "The triangle door leads to an interview room, but its lock waits for the clocks to agree first.");
      return;
    }
    this.audio.open();
    this.showRoom("interrogation");
  }

  private showReceptionMemo(): void {
    this.state.setFlag("receptionMemoSeen");
    this.state.save();
    this.showDocument(
      "Reception Memo",
      "New clerks must process emotions before entering the inner offices:\n\nREGRET knocks first.\nJOY is never early.\nCALM is not possible until something has been fed.\n\nReminder: future-phone messages are legally binding if counted aloud."
    );
  }

  private clockPuzzle(): void {
    if (this.state.flag("clockSolved")) {
      this.showMessage("Mood Clocks", "The clocks display one impossible minute: the exact time an apology becomes a door.");
      return;
    }
    if (!this.state.flag("receptionMemoSeen") || !this.state.flag("calendarSeen")) {
      this.audio.fail();
      this.showMessage(
        "Mood Clocks",
        "The clocks refuse blind calibration. Read the Reception Memo for the first and last moods, and the Personnel Calendar for the middle order."
      );
      return;
    }
    this.showSequencePuzzle(
      "Mood Clocks",
      "Set the clocks to the order used for new clerks. The reception memo is annoyingly sincere about this.",
      [
        { label: "Calm", value: "calm" },
        { label: "Joy", value: "joy" },
        { label: "Regret", value: "regret" },
        { label: "Hunger", value: "hunger" }
      ],
      ["regret", "hunger", "calm", "joy"],
      () => {
        this.state.setFlag("clockSolved");
        this.audio.success();
        this.state.save();
        this.showMessage(
          "Clock Hall",
          "The clocks exhale in sequence. Security wakes, an elevator sighs open, and the break-room stairs remember that they exist. A notice beside the Mirror Office route blinks: WARRANT REQUIRED.",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
        );
      }
    );
  }

  private showCalendarClue(): void {
    this.state.setFlag("calendarSeen");
    this.state.save();
    this.showDocument(
      "Personnel Calendar",
      "The calendar has no months, only moods. The intact row has four blank squares. Someone wrote under them:\n\n'Paperwork makes the building hungry. Hunger comes before Calm. Joy signs last.'"
    );
  }

  private goArchive(): void {
    if (!this.state.flag("clockSolved")) {
      this.audio.fail();
      this.showMessage("Archive Elevator", "The elevator buttons blink in alphabetical order by emotion. None of them are ready.");
      return;
    }
    this.showRoom("archive");
  }

  private goBreak(): void {
    if (!this.state.flag("clockSolved")) {
      this.audio.fail();
      this.showMessage("Break Room Stairs", "The stairs have union rules. They descend only after the clocks finish their shift.");
      return;
    }
    this.showRoom("break");
  }

  private goSecurity(): void {
    if (!this.state.flag("clockSolved")) {
      this.audio.fail();
      this.showMessage("Security Office", "The security door is awake, but it refuses to watch anything until the clocks agree on what happened first.");
      return;
    }
    this.audio.open();
    this.showRoom("security");
  }

  private goInterrogation(): void {
    if (!this.state.flag("clockSolved")) {
      this.audio.fail();
      this.showMessage("Interrogation Booth", "The booth will not schedule your interview until the clocks stop arguing.");
      return;
    }
    this.audio.open();
    this.showRoom("interrogation");
  }

  private securityMonitors(): void {
    if (this.selectedItem === "misfiledFolder" && this.state.has("misfiledFolder")) {
      this.state.setFlag("folderCrossReferenced");
      this.state.setFlag("securityFootageSeen");
      this.audio.success();
      this.state.save();
      this.showDocument(
        "Monitor Cross-Reference",
        "You hold the misfiled folder against the monitor glass. The cameras stop showing cabinets and start showing the same clerk from four angles, each carrying a different version of the file.\n\nThe folder stops pretending it belongs under Weather. It now knows it is evidence."
      );
      return;
    }

    this.state.setFlag("securityFootageSeen");
    this.state.save();
    this.showDocument(
      "Monitor Bank",
      "Nine dead monitors show one living feed: the Records Archive moving after hours. The drawers open themselves, but the camera keeps dropping frames whenever the labels face forward.\n\nA sticky note below the controls says: 'If paperwork fails, security footage counts as a witness.'"
    );
  }

  private keyCabinet(): void {
    if (this.state.has("securityKey")) {
      this.showMessage("Key Cabinet", "Only blank hooks remain. The evidence key is already making your pocket heavier.");
      return;
    }
    if (this.selectedItem === "visitorBadge" || this.selectedItem === "stampedForm") {
      this.showMessage(
        "Key Cabinet",
        "The cabinet reads your authority differently depending on what you present. Badge or stamped form, it does not care. A heavy evidence key drops into your hand.",
        [
          {
            label: "Take Key",
            action: () => {
              this.state.add("securityKey");
              this.selectedItem = undefined;
              this.audio.drop();
              this.state.save();
              this.closeOverlayAndRefresh();
            }
          }
        ]
      );
      return;
    }
    this.audio.fail();
    this.showMessage(
      "Key Cabinet",
      "The cabinet has a reader shaped like an ID badge and a slot shaped like a stamped form. Select either one, then try again."
    );
  }

  private evidenceSafe(): void {
    if (this.state.has("auditWarrant")) {
      this.showDocument(
        "Audit Warrant",
        "AUTHORIZATION: enter the Mirror Office, inspect the ledger server, and correct any person being processed as missing, present, or both.\n\nWARNING: Auditors may be audited in return."
      );
      return;
    }
    if (this.selectedItem !== "securityKey") {
      this.audio.fail();
      this.showMessage("Evidence Safe", "The safe has no keypad, only an old lock with teeth. It wants the evidence key from the cabinet.");
      return;
    }
    if (!this.state.flag("securityFootageSeen") && !this.state.flag("incidentBoardSeen") && !this.state.flag("securityLogSeen")) {
      this.audio.fail();
      this.showMessage(
        "Evidence Safe",
        "The lock turns halfway, then stops. Security will not issue a warrant until you inspect some evidence: monitors, incident board, or log."
      );
      return;
    }
    this.showMessage(
      "Evidence Safe",
      "The key turns with the sound of a file cabinet deciding not to lie. Inside is an Audit Warrant already stamped with tomorrow's date.",
      [
        {
          label: "Take Warrant",
          action: () => {
            this.state.add("auditWarrant");
            this.state.setFlag("evidenceSafeOpened");
            this.selectedItem = undefined;
            this.audio.metal();
            this.audio.stinger();
            this.state.save();
            this.closeOverlayAndRefresh();
          }
        }
      ]
    );
  }

  private incidentBoard(): void {
    this.state.setFlag("incidentBoardSeen");
    this.state.save();
    this.showDocument(
      "Incident Board",
      "SECURITY INCIDENT 11-H\n\nSubject entered at 00:00 with valid visitor identification.\nSubject later appears on archive camera carrying a folder filed under the wrong category.\nSubject purchases an hour from an unauthorized vending machine.\n\nRecommended containment: issue Audit Warrant before Mirror Office contact."
    );
  }

  private securityLog(): void {
    this.state.setFlag("securityLogSeen");
    this.state.save();
    this.showDocument(
      "Security Log",
      "00:00 - Clerk appears in Reception before being hired.\n00:07 - Clock Hall rearranges emotional access order.\n00:13 - Archive drawers self-sort when observed.\n00:24 - Vending machine accepts future debt.\n00:31 - Mirror Office requests warrant, identity, hour, and power."
    );
  }

  private tapeRecorder(): void {
    this.state.setFlag("heardPhone");
    const started = this.audio.playPhoneClue();
    this.state.save();
    this.showMessage(
      "Tape Recorder",
      started
        ? "The recorder plays the same future-phone click groups, but cleaner. Three clusters. Count them carefully. The reels keep turning after the tape ends."
        : "The reels are already turning. Let the click-groups finish, then play them again if you need."
    );
  }

  private rainWindow(): void {
    this.state.setFlag("rainCipherSeen");
    this.state.save();
    if (!this.state.has("rainCipher")) {
      this.showMessage(
        "Rain Window",
        "Rain crawls down the observation glass in three unnatural groups: seven thin trails, three heavy trails, and one drop that refuses company. You copy the pattern as a Rain Cipher.",
        [
          {
            label: "Take Note",
            action: () => {
              this.state.add("rainCipher");
              this.audio.paper();
              this.state.save();
              this.closeOverlayAndRefresh();
            }
          }
        ]
      );
      return;
    }
    this.showMessage(
      "Rain Window",
      "The rain still repeats its visual code: seven thin trails, three heavy trails, one lonely drop. It is the phone clue for players who listen with their eyes."
    );
  }

  private interviewFile(): void {
    this.state.setFlag("interviewFileSeen");
    this.state.save();
    this.showDocument(
      "Interview File",
      "TRANSCRIPT EXCERPT\n\nQ: When did the missing hour vanish?\nA: Tomorrow, during a shift I had already survived.\n\nQ: Who authorized the purchase?\nA: A vending machine with my signature in its coin slot.\n\nQ: Corrective action?\nA: Recover the hour before the Department files the person around it."
    );
  }

  private handlessClock(): void {
    this.showMessage(
      "Handless Clock",
      "The clock has no hands because the room is not measuring time. It is measuring how long you can avoid answering."
    );
  }

  private archiveDrawers(): void {
    if (this.state.flag("archiveSolved")) {
      this.showMessage(
        "Index Drawers",
        "The drawers sit in corrected order: apology, appetite, witness, rest. They resent the clarity."
      );
      return;
    }
    if (this.selectedItem === "auditWarrant" && this.state.flag("securityFootageSeen")) {
      this.state.setFlag("archiveSolved");
      this.selectedItem = undefined;
      this.audio.stinger();
      this.state.save();
      this.showMessage(
        "Security Override",
        "You press the Audit Warrant against the drawer labels and cite the camera footage as a witness. The archive accepts the shortcut and unlocks the glass case.",
        [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
      );
      return;
    }
    if (this.selectedItem === "auditWarrant" && !this.state.flag("securityFootageSeen")) {
      this.audio.fail();
      this.showMessage(
        "Security Override",
        "The warrant has authority, but the archive wants a witness. Inspect the Security Office monitor bank first, then use the Audit Warrant here."
      );
      return;
    }
    if (!this.state.flag("archiveTableSeen") || !this.state.flag("breakBoardSeen")) {
      this.audio.fail();
      this.showMessage(
        "Index Drawers",
        "The drawers refuse blind guesses. Find the archive table's symbol mapping and the break-room category order, or select the Audit Warrant after inspecting the Security Office monitors."
      );
      return;
    }
    this.showSequencePuzzle(
      "Index Drawers",
      "Sort the four symbol files by category. The archive table maps symbols to meanings; the break-room board gives the official category order. Security footage can also justify an override if you have a warrant.",
      [
        { label: "Eye", value: "eye" },
        { label: "Triangle", value: "triangle" },
        { label: "Square", value: "square" },
        { label: "Circle", value: "circle" }
      ],
      ["triangle", "circle", "eye", "square"],
      () => {
        this.state.setFlag("archiveSolved");
        this.audio.success();
        this.state.save();
        this.showMessage(
          "Records Corrected",
          "The cabinets inhale and the glass case unlocks with a small official gasp. The important records are visible now; you still need to take them.",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
        );
      }
    );
  }

  private glassCase(): void {
    if (!this.state.flag("archiveSolved")) {
      this.audio.fail();
      this.showMessage(
        "Glass Case",
        "The case contains a face-shaped absence. The lock has four symbol dents. The drawers nearby decide which symbols are allowed to matter."
      );
      return;
    }
    if (!this.state.flag("glassCaseCollected")) {
      this.showMessage(
        "Glass Case",
        "You open the case. Inside are a misfiled folder, a mirror shard wrapped in carbon paper, and a missing-person file with your name changing in the margins.",
        [
          {
            label: "Take Them",
            action: () => {
              this.state.setFlag("glassCaseCollected");
              this.state.add("misfiledFolder");
              this.state.add("mirrorShard");
              this.state.add("selfFile");
              this.state.setFlag("selfFileReviewed");
              this.audio.glass();
              this.state.save();
              this.showMessage(
                "Your Missing-Person File",
                "The file opens to a photograph of the back of your head, taken from inside this room. Every page agrees on one thing: the Department can authorize your correction, but only your own record proves who is being corrected.",
                [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }],
                true
              );
            }
          }
        ]
      );
      return;
    }
    this.showDocument(
      "Your Missing-Person File",
      "SUBJECT: night-shift clerk.\nSTATUS: partly employed, mostly absent.\nLAST KNOWN HOUR: purchased from unauthorized vending machine.\nCORRECTIVE ACTION: either file subject under SELF, or break the ledger and accept incomplete memory."
    );
  }

  private coinDrawer(): void {
    if (this.state.add("timeToken")) {
      this.audio.pickup();
      this.state.save();
      this.say("A Time Token rolls out of the drawer and stops at your shoe, exhausted.");
      this.createHudRefresh();
      return;
    }
    this.showMessage("Coin Drawer", "The drawer is now empty except for the smell of hot pennies.");
  }

  private archiveTable(): void {
    this.state.setFlag("archiveTableSeen");
    this.state.save();
    this.showDocument(
      "Sorting Slip",
      "A handwritten slip maps symbols to file categories:\n\nTRIANGLE = Apology\nCIRCLE = Appetite\nEYE = Witness\nSQUARE = Rest\n\nIt does not give the drawer order. Someone circled the words BREAK ROOM twice."
    );
  }

  private corkBoard(): void {
    this.state.setFlag("breakBoardSeen");
    this.state.save();
    this.showDocument(
      "Break-Room Cork Board",
      "A coffee-stained policy sheet lists the official category order, not the symbols:\n\n1. Apology\n2. Appetite\n3. Witness\n4. Rest\n\nA note below says: 'Match this to the archive table. Do not let the cabinets choose for themselves.'"
    );
  }

  private paperCups(): void {
    if (this.state.add("paperCup")) {
      this.audio.pickup();
      this.state.save();
      this.say("You take a paper cup. It immediately forgets being stacked.");
      this.createHudRefresh();
      return;
    }
    this.showMessage("Paper Cups", "The stack has collapsed into an argument about whose turn it is to hold liquids.");
  }

  private vendingMachine(): void {
    if (this.state.flag("vendingSolved")) {
      this.showMessage("Memory Vending", "The vending machine displays SOLD OUT OF TUESDAY, though no readable letters are lit.");
      return;
    }
    if (!this.state.has("timeToken")) {
      this.audio.fail();
      this.showMessage("Memory Vending", "The machine wants a Time Token. Coins from normal countries are beneath its dignity.");
      return;
    }
    if (!this.state.has("paperCup")) {
      this.audio.fail();
      this.showMessage("Memory Vending", "A slot shaped like a cup waits beneath the dispenser.");
      return;
    }
    if (!this.state.flag("glassCaseCollected")) {
      this.audio.fail();
      this.showMessage(
        "Memory Vending",
        "The machine refuses to sell an hour to someone without a file. Recover the records from the archive glass case first, then return with the token, cup, and clue."
      );
      return;
    }
    const hasRainClue = this.state.has("rainCipher") || this.state.flag("rainCipherSeen");
    if (!this.state.flag("heardPhone") && !hasRainClue) {
      this.audio.fail();
      this.showMessage(
        "Memory Vending",
        "The keypad blinks three empty digits. The future phone can be counted by ear, and the interrogation booth has a visual clue if you need another path."
      );
      return;
    }

    const cluePath = this.state.has("rainCipher")
      ? "Use the Rain Cipher or the phone clicks. Both point to the same three digits."
      : this.state.flag("rainCipherSeen")
        ? "You remember the rain cipher: seven, three, one. Taking the note keeps it in inventory, but the clue is already known."
        : this.state.muted
        ? "You have engaged with the audio clue. Accessibility transcript: the groups count seven, three, one."
        : this.state.flag("vendingFailed")
          ? "The keypad clears wrong guesses. Recheck the phone or tape clicks, the rain clue, Notes, or Hint before trying again."
          : "Enter the number counted from the future phone. If you miss it, replay the phone or tape recorder.";

    this.showKeypadPuzzle("Memory Vending", cluePath, "731", () => {
      this.showMessage(
        "Memory Dispensed",
        "The machine accepts the token, the cup, and several facts about your childhood. It dispenses a steaming missing hour and a server fuse taped to the bottom.",
        [
          {
            label: "Take Them",
            action: () => {
              this.state.setFlag("vendingSolved");
              this.state.remove("timeToken");
              this.state.remove("paperCup");
              this.state.add("memoryCup");
              this.state.add("serverFuse");
              this.audio.machine();
              this.audio.success();
              this.state.save();
              this.closeOverlayAndRefresh();
            }
          }
        ]
      );
    }, () => this.state.setFlag("vendingFailed"));
  }

  private microwave(): void {
    this.showMessage(
      "Microwave",
      "The microwave door shows a tiny version of you heating soup in 1998. You have never owned that shirt."
    );
  }

  private goMirror(): void {
    if (!this.state.has("auditWarrant")) {
      this.audio.fail();
      this.showMessage(
        "Mirror Office",
        "The office beyond the break room is under audit lock, just like the Clock Hall notice warned. Security can issue the warrant."
      );
      return;
    }
    const missing = this.missingMirrorRequirements();
    if (missing.length > 0) {
      this.audio.fail();
      this.showMessage(
        "Mirror Office",
        `The office beyond the break room is visible only in reflection. Your warrant is valid, but you still need ${this.formatRequirementList(missing)}.`
      );
      return;
    }
    this.showRoom("mirror");
  }

  private missingMirrorRequirements(): string[] {
    const missing: string[] = [];
    if (!this.state.flag("glassCaseCollected")) {
      missing.push("the glass-case records from the archive");
    }
    if (!this.state.flag("vendingSolved")) {
      missing.push("the missing hour from the vending machine");
    }
    return missing;
  }

  private formatRequirementList(items: string[]): string {
    if (items.length <= 1) {
      return items[0] ?? "";
    }
    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`;
    }
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  private blackMirror(): void {
    if (!this.state.flag("mirrorShardInstalled")) {
      if (this.selectedItem === "mirrorShard" && this.state.has("mirrorShard")) {
        this.state.remove("mirrorShard");
        this.state.setFlag("mirrorShardInstalled");
        this.state.setFlag("mirrorClueSeen");
        this.selectedItem = undefined;
        this.audio.glitch();
        this.state.save();
        this.showMessage(
          "Mirror Reflection",
          "The shard completes a corner of the black mirror. The reflected office rearranges itself into four clean symbols:\n\nCIRCLE -> TRIANGLE -> EYE -> SQUARE\n\nIn the mirror, the exit door mouths the words: 'Power. Identity. Hour. Sequence.'",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }],
          true
        );
        return;
      }
      this.audio.fail();
      this.showMessage("Black Mirror", "The mirror reflects a locked version of the room. A shard-shaped gap shines near its corner.");
      return;
    }
    this.showDocument(
      "Mirror Reflection",
      "The completed reflection still shows the server order:\n\nCIRCLE -> TRIANGLE -> EYE -> SQUARE\n\nPower, identity, hour, sequence. The mirror is not subtle; it is just backwards."
    );
  }

  private serverConsole(): void {
    if (!this.state.flag("fuseInstalled")) {
      if (this.selectedItem === "serverFuse" && this.state.has("serverFuse")) {
        this.state.remove("serverFuse");
        this.state.setFlag("fuseInstalled");
        this.selectedItem = undefined;
        this.audio.machine();
        this.state.save();
        this.showMessage(
          "Server Console",
          "You seat the fuse in the empty cradle. The console wakes, prints your employee number in static, then asks for identity verification.",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
        );
        return;
      }
      this.audio.fail();
      this.showMessage("Server Console", "The server console has an empty fuse cradle. Use the Server Fuse here before it can obey anything.");
      return;
    }
    if (!this.state.flag("identityVerified") || !this.state.flag("hourVerified")) {
      this.audio.fail();
      this.showMessage("Server Console", "The console has power, but refuses instructions until the red intercom verifies both your file and your missing hour.");
      return;
    }
    if (!this.state.flag("mirrorClueSeen")) {
      this.audio.fail();
      this.showMessage("Server Console", "The console displays four blank symbol slots. The mirror may know what order it wants.");
      return;
    }
    if (this.state.flag("serverSolved")) {
      this.showMessage("Server Console", "The console purrs. The exit is open in every timeline except the reasonable one.");
      return;
    }
    this.showSequencePuzzle(
      "Server Console",
      "Enter the symbol order reflected in the black mirror.",
      [
        { label: "Eye", value: "eye" },
        { label: "Circle", value: "circle" },
        { label: "Square", value: "square" },
        { label: "Triangle", value: "triangle" }
      ],
      ["circle", "triangle", "eye", "square"],
      () => {
        this.state.setFlag("serverSolved");
        this.audio.success();
        this.state.save();
        this.showMessage(
          "Ledger Unlatched",
          "The servers agree to disagree. The exit door unlocks with the dry cough of a thousand corrected forms.",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
        );
      }
    );
  }

  private redIntercom(): void {
    if (!this.state.flag("identityVerified")) {
      if (this.selectedItem === "selfFile" && this.state.has("selfFile")) {
        this.state.setFlag("identityVerified");
        this.selectedItem = undefined;
        this.audio.success();
        this.state.save();
        this.showMessage(
          "Red Intercom",
          "You slide your missing-person file under the grille. The Auditor stamps it twice: PRESENT and ABSENT. 'Identity contradiction accepted. Present the hour.'",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
        );
        return;
      }
      if (this.selectedItem === "auditWarrant" && this.state.has("auditWarrant")) {
        this.state.setFlag("identityVerified");
        this.state.setFlag("identityVerifiedByWarrant");
        this.selectedItem = undefined;
        this.audio.success();
        this.state.save();
        this.showMessage(
          "Red Intercom",
          "You slide the Audit Warrant under the grille. The Auditor reads the stamped date, then reads it again backward. 'Administrative identity accepted. Present the hour.'",
          [{ label: "Continue", action: () => this.closeOverlayAndRefresh() }]
        );
        return;
      }
      this.audio.fail();
      this.showMessage("Red Intercom", "The intercom asks for proof that you are allowed to correct the person being processed. Use your Missing-Person File or the Audit Warrant here.");
      return;
    }
    if (!this.state.flag("hourVerified")) {
      if (this.selectedItem === "memoryCup" && this.state.has("memoryCup")) {
        this.state.setFlag("hourPresented");
        this.selectedItem = undefined;
        this.audio.glitch();
        this.state.save();
        this.showMessage(
          "Red Intercom",
          "You hold the Cup of Missing Hour to the grille. Steam passes through the holes and speaks in your childhood voice. The Auditor clears its throat and begins the final verification.",
          [{ label: "Answer", action: () => this.dialogueQuestion(0) }]
        );
        return;
      }
      this.audio.fail();
      this.showMessage("Red Intercom", "The Auditor has your identity. Now it wants the missing hour itself.");
      return;
    }
    this.showMessage("Red Intercom", "The Auditor hums softly. Your file and missing hour remain verified.");
  }

  private dialogueQuestion(index: number): void {
    const questions = [
      {
        title: "The Auditor",
        body: "A voice like paper cuts asks: Who is missing?",
        answers: [
          { label: "The vending machine.", correct: false },
          { label: "The clerk holding the file.", correct: true },
          { label: "No one. This is normal.", correct: false }
        ]
      },
      {
        title: "The Auditor",
        body: "What three-digit pattern did the phone, tape, or rain give you?",
        answers: [
          { label: "One-three-seven.", correct: false },
          { label: "Twelve sharp.", correct: false },
          { label: "Seven-three-one.", correct: true }
        ]
      },
      {
        title: "The Auditor",
        body: "Where should an impossible hour be kept?",
        answers: [
          { label: "In the microwave.", correct: false },
          { label: "Outside the system.", correct: true },
          { label: "Under management review.", correct: false }
        ]
      }
    ];
    const question = questions[index];
    this.showMessage(
      question.title,
      question.body,
      question.answers.map((answer) => ({
        label: answer.label,
        action: () => {
          if (!answer.correct) {
            this.audio.fail();
            this.showMessage(
              "The Auditor",
              "The intercom emits one red cough. 'Incorrect. Please reconsider your disappearance.'",
              [{ label: "Try Again", action: () => this.dialogueQuestion(index) }]
            );
            return;
          }
          this.audio.success();
          if (index < questions.length - 1) {
            this.dialogueQuestion(index + 1);
            return;
          }
          this.state.setFlag("dialoguePassed");
          this.state.setFlag("hourVerified");
          this.state.save();
          this.showMessage(
            "Contradiction Verified",
            "The Auditor signs something on the other side of the wall. 'You are missing, present, and liable. Proceed.'",
            [{ label: "Proceed", action: () => this.closeOverlayAndRefresh() }]
          );
        }
      }))
    );
  }

  private exitDoor(): void {
    if (!this.state.flag("serverSolved")) {
      this.audio.fail();
      this.showMessage("Exit Door", "The exit opens onto an office behind you. The server ledger is still holding the hallway in place.");
      return;
    }
    if (this.selectedItem === "selfFile") {
      this.finish("filed");
      return;
    }
    if (this.selectedItem === "memoryCup") {
      this.finish("escaped");
      return;
    }
    if (this.selectedItem === "auditWarrant") {
      this.finish("audited");
      return;
    }
    this.showMessage(
      "Exit Door",
      "The exit splits into three mechanisms: a ledger slot that wants paperwork, a bright crack in the wall that drinks steam, and an audit seal waiting for official authority. Choose what you trust enough to place there.",
      [{ label: "Step Back", action: () => this.closeOverlay() }]
    );
  }

  private finish(ending: EndingId): void {
    this.closeOverlay();
    this.state.ending = ending;
    this.state.save();
    this.audio.ending(ending);
    this.showEnding(ending, false);
  }

  private showEnding(ending: EndingId, fromSave: boolean): void {
    this.clearScene();
    this.audio.stopAmbience();
    this.add.image(GAME_W / 2, GAME_H / 2, "bg-ending").setDisplaySize(GAME_W, GAME_H);
    this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x050705, 0.36);
    this.addVignette();

    const title = ending === "filed" ? "Filed Ending" : ending === "audited" ? "Audit Ending" : "Escaped Ending";
    const body =
      ending === "filed"
        ? "You file yourself under SELF, cross-reference the missing hour, and become beautifully easy to find. By morning, your desk is clean. The badge drawer is warm."
        : ending === "audited"
          ? "You press the Audit Warrant into the exit seal and cite the Department for mishandling a person as paperwork. By dawn, the building is still there, but every door now needs your signature."
          : "You pour the missing hour into the ledger. Every clock in the department stutters. You leave with a pocket full of incomplete memories and the useful certainty that some systems deserve bad paperwork.";
    const titleFontSize = this.state.largeText ? "58px" : "52px";
    const bodyFontSize = this.state.largeText ? "32px" : "28px";

    this.add
      .text(GAME_W / 2, 118, title.toUpperCase(), {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: titleFontSize,
        color: "#fff0c7",
        stroke: "#110f0d",
        strokeThickness: 6
      })
      .setOrigin(0.5);
    this.add
      .text(GAME_W / 2, 236, body, {
        fontSize: bodyFontSize,
        color: "#f3e6c2",
        align: "center",
        wordWrap: { width: 860 },
        lineSpacing: 9
      })
      .setOrigin(0.5);
    this.makeButton(510, 610, 210, 52, "Play Again", () => {
      this.state.reset();
      this.showTitle();
    });
    this.makeButton(735, 610, 210, 52, fromSave ? "Title" : "Credits", fromSave ? () => this.showTitle() : () => this.showCredits());
  }

  private showCredits(): void {
    this.showMessage(
      "Credits",
      "Created as a static Phaser web game. Visual backgrounds were generated for this project, then optimized as local WebP assets. Sound uses procedural Web Audio ambience plus selected CC0 Kenney interface effects."
    );
  }

  private showSequencePuzzle(
    title: string,
    body: string,
    buttons: SequenceButton[],
    correct: string[],
    onSolved: () => void
  ): void {
    this.lastPuzzleInput = [];
    const redraw = () => {
      const progress =
        this.lastPuzzleInput.length === 0
          ? "No entries yet."
          : this.lastPuzzleInput.map((value) => value.toUpperCase()).join(" -> ");
      const specs = buttons.map((button) => ({
        label: button.label,
        action: () => {
          this.audio.click();
          this.lastPuzzleInput.push(button.value);
          if (this.lastPuzzleInput.length === correct.length) {
            const solved = this.lastPuzzleInput.every((value, index) => value === correct[index]);
            if (solved) {
              onSolved();
              return;
            }
            this.audio.fail();
            const attempted = this.lastPuzzleInput.map((value) => value.toUpperCase()).join(" -> ");
            this.lastPuzzleInput = [];
            this.showMessage(title, `${body}\n\nSubmitted order: ${attempted}\n\nThe mechanism rejects that order. Start again.`, [
              { label: "Try Again", action: () => redraw() },
              { label: "Leave", action: () => this.closeOverlay() }
            ]);
            return;
          }
          redraw();
        }
      }));
      const reviewSpecs = this.puzzleReviewButtons(title, redraw);
      this.showMessage(title, `${body}\n\nCurrent order: ${progress}`, [
        ...specs,
        ...reviewSpecs,
        {
          label: "Reset",
          action: () => {
            this.lastPuzzleInput = [];
            redraw();
          }
        },
        { label: "Leave", action: () => this.closeOverlay() }
      ]);
    };
    redraw();
  }

  private showKeypadPuzzle(title: string, body: string, correct: string, onSolved: () => void, onFailed?: () => void): void {
    let input = "";
    let feedback = "";
    const redraw = () => {
      const specs: ButtonSpec[] = "1234567890".split("").map((digit) => ({
        label: digit,
        action: () => {
          feedback = "";
          input += digit;
          if (input.length === correct.length) {
            if (input === correct) {
              onSolved();
              return;
            }
            this.audio.fail();
            onFailed?.();
            this.state.save();
            input = "";
            feedback = "Incorrect code. The keypad clears.";
          }
          redraw();
        }
      }));
      const reviewSpecs = this.puzzleReviewButtons(title, redraw);
      const feedbackLine = feedback ? `\n\n${feedback}` : "";
      this.showMessage(title, `${body}\n\nEntered: ${input.padEnd(correct.length, "_")}${feedbackLine}`, [
        ...specs,
        ...reviewSpecs,
        {
          label: "Clear",
          action: () => {
            input = "";
            feedback = "";
            redraw();
          }
        },
        { label: "Leave", action: () => this.closeOverlay() }
      ]);
    };
    redraw();
  }

  private puzzleReviewButtons(title: string, returnToPuzzle: () => void): ButtonSpec[] {
    let body = "";
    if (title === "Mood Clocks") {
      const lines = [];
      if (this.state.flag("receptionMemoSeen")) {
        lines.push("Reception Memo: Regret knocks first. Joy is never early. Calm is not possible until something has been fed.");
      }
      if (this.state.flag("calendarSeen")) {
        lines.push("Personnel Calendar: Paperwork makes the building hungry. Hunger comes before Calm. Joy signs last.");
      }
      if (lines.length === 0) {
        lines.push("You have not reviewed the clock evidence yet. Look for the Reception memo and the Personnel Calendar.");
      } else if (!this.state.flag("calendarSeen")) {
        lines.push("A wall calendar in Clock Hall may explain what the building means by hunger.");
      } else if (!this.state.flag("receptionMemoSeen")) {
        lines.push("The Reception memo explains which emotion knocks first and which one signs last.");
      }
      body = lines.join("\n\n");
    } else if (title === "Index Drawers") {
      const lines = [];
      if (this.state.flag("archiveTableSeen")) {
        lines.push("Archive Table: Triangle=Apology, Circle=Appetite, Eye=Witness, Square=Rest.");
      }
      if (this.state.flag("breakBoardSeen")) {
        lines.push("Break Board: Apology, Appetite, Witness, Rest.");
      }
      if (this.state.flag("securityFootageSeen")) {
        lines.push("Security Footage: the cameras can support an Audit Warrant override, but they do not replace the table and break-room deduction.");
      }
      if (lines.length === 0) {
        lines.push("You have not found enough drawer evidence yet. Look for category mapping, category order, or a warrant-backed security override.");
      }
      body = lines.join("\n\n");
    } else if (title === "Memory Vending") {
      if (this.state.has("rainCipher")) {
        body = "Rain Cipher: seven thin trails, three heavy trails, one lonely drop.";
      } else if (this.state.flag("rainCipherSeen")) {
        body = "Rain memory: seven thin trails, three heavy trails, one lonely drop. Taking the note only keeps the clue in inventory.";
      } else if (this.state.muted) {
        body = "Accessibility transcript: the phone/tape clue clicks in groups of seven, three, and one.";
      } else if (this.state.flag("vendingFailed")) {
        body = "Wrong guesses clear the keypad. Recheck the phone/tape clicks, the rain clue, Notes, or Hint before trying again.";
      } else if (this.state.flag("heardPhone")) {
        body = "Future Phone / Tape Recorder: three groups of clicks. Count each group.";
      } else {
        body = "The vending keypad needs a three-digit clue. The future phone, tape recorder, or rain window can provide it.";
      }
    } else if (title === "Server Console") {
      body = this.state.flag("mirrorClueSeen")
        ? "Black Mirror: Circle -> Triangle -> Eye -> Square.\n\nMirror text: Power. Identity. Hour. Sequence."
        : "The console wants a reflected order. The black mirror has a shard-shaped gap.";
    }

    if (!body) {
      return [];
    }

    return [
      {
        label: "Review Clue",
        action: () =>
          this.showMessage(title, body, [
            { label: "Back", action: () => returnToPuzzle() },
            { label: "Leave", action: () => this.closeOverlay() }
          ])
      }
    ];
  }

  private showDocument(title: string, body: string): void {
    this.audio.paper();
    this.showMessage(title, body, [{ label: "Close", action: () => this.closeOverlay() }], true);
  }

  private showMessage(title: string, body: string, buttons?: ButtonSpec[], documentStyle = false, initialFocusLabel?: string): void {
    this.closeOverlay();
    const actualButtons = buttons ?? [{ label: "Close", action: () => this.closeOverlay() }];
    const backdrop = document.createElement("div");
    backdrop.className = `game-modal-backdrop${documentStyle ? " game-modal-document" : ""}`;
    backdrop.addEventListener("pointerdown", (event) => event.stopPropagation());
    backdrop.addEventListener("pointerup", (event) => event.stopPropagation());
    backdrop.addEventListener("click", (event) => event.stopPropagation());
    const panel = document.createElement("section");
    panel.className = `game-modal-panel${actualButtons.length > 3 ? " game-modal-panel-grid" : ""}${actualButtons.length > 6 ? " game-modal-panel-many" : ""}`;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);

    const heading = document.createElement("h2");
    heading.className = "game-modal-title";
    heading.textContent = title;

    const message = document.createElement("div");
    message.className = "game-modal-body";
    message.textContent = body;

    const actions = document.createElement("div");
    actions.className = `game-modal-actions${actualButtons.length > 6 ? " game-modal-actions-many" : ""}${actualButtons.length === 4 ? " game-modal-actions-even" : ""}`;

    actualButtons.forEach((button) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "game-modal-button";
      element.textContent = button.label;
      element.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      element.addEventListener("pointerup", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      element.addEventListener("mouseenter", () => this.audio.hover());
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.audio.click();
        button.action();
      });
      actions.append(element);
    });

    panel.append(heading, message, actions);
    backdrop.append(panel);
    document.body.append(backdrop);
    this.domOverlay = backdrop;
    this.modalEscapeHandler = (event: KeyboardEvent) => {
      if (this.domOverlay !== backdrop) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeOverlay();
        return;
      }
      if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        this.focusModalButton(event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = [...actions.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !backdrop.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !backdrop.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", this.modalEscapeHandler, true);
    window.setTimeout(() => {
      const preferred = initialFocusLabel
        ? [...actions.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === initialFocusLabel)
        : undefined;
      (preferred ?? actions.querySelector<HTMLButtonElement>("button"))?.focus();
    }, 0);
  }

  private modalButtons(): HTMLButtonElement[] {
    if (!this.domOverlay) {
      return [];
    }
    return [...this.domOverlay.querySelectorAll<HTMLButtonElement>(".game-modal-button:not([disabled])")];
  }

  private focusModalButton(direction: 1 | -1): void {
    const buttons = this.modalButtons();
    if (buttons.length === 0) {
      return;
    }
    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const nextIndex =
      currentIndex < 0 ? (direction > 0 ? 0 : buttons.length - 1) : (currentIndex + direction + buttons.length) % buttons.length;
    this.audio.hover();
    buttons[nextIndex].focus();
  }

  private activateFocusedModalButton(): void {
    const buttons = this.modalButtons();
    if (buttons.length === 0) {
      return;
    }
    const active = document.activeElement instanceof HTMLButtonElement && buttons.includes(document.activeElement) ? document.activeElement : buttons[0];
    active.focus();
    active.click();
  }

  private closeOverlay(): void {
    if (this.modalEscapeHandler) {
      document.removeEventListener("keydown", this.modalEscapeHandler, true);
      this.modalEscapeHandler = undefined;
    }
    this.domOverlay?.remove();
    this.domOverlay = undefined;
    window.setTimeout(() => this.game.canvas.focus({ preventScroll: true }), 0);
    this.overlay?.destroy(true);
    this.overlay = undefined;
  }

  private closeOverlayAndRefresh(): void {
    this.closeOverlay();
    this.showRoom(this.state.room);
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: () => void,
    depth = 50,
    paperButton = false
  ): Phaser.GameObjects.Container {
    const rect = this.add.rectangle(0, 0, w, h, paperButton ? 0xd5bd83 : 0x27301e, 0.94);
    rect.setStrokeStyle(2, paperButton ? 0x806036 : 0xbba05b, 0.8);
    const text = this.add
      .text(0, 0, label, {
        fontSize:
          w <= 50
            ? "22px"
            : h >= 52
              ? label.length > 22
                ? "18px"
                : label.length > 14
                  ? "22px"
                  : "29px"
              : label.length > 18
                ? "17px"
                : "20px",
        color: paperButton ? "#241c13" : "#fff0c5",
        align: "center",
        fontStyle: "bold",
        wordWrap: { width: w - 14 }
      })
      .setOrigin(0.5);
    const container = this.add.container(x, y, [rect, text]).setDepth(depth);
    container.setSize(w, h);
    container.setInteractive(new Phaser.Geom.Rectangle(-w / 2, -h / 2, w, h), Phaser.Geom.Rectangle.Contains);
    container.on("pointerover", () => {
      this.input.setDefaultCursor("pointer");
      this.audio.hover();
      rect.setFillStyle(paperButton ? 0xebd79c : 0x3f4b2b, 1);
      rect.setStrokeStyle(2, 0xf0d079, 1);
    });
    container.on("pointerout", () => {
      this.input.setDefaultCursor("default");
      rect.setFillStyle(paperButton ? 0xd5bd83 : 0x27301e, 0.94);
      rect.setStrokeStyle(2, paperButton ? 0x806036 : 0xbba05b, 0.8);
    });
    container.on("pointerdown", () => {
      this.audio.click();
      action();
    });
    return container;
  }

  private showMap(): void {
    const canUseInnerRooms = this.state.flag("clockSolved");
    const canUseMirror =
      canUseInnerRooms && this.state.has("auditWarrant") && this.state.flag("glassCaseCollected") && this.state.flag("vendingSolved");
    const destinations: ButtonSpec[] = [
      {
        label: "Reception",
        action: () => {
          this.closeOverlay();
          this.showRoom("reception");
        }
      }
    ];

    if (this.state.flag("clockUnlocked") || canUseInnerRooms || this.state.room === "clock") {
      destinations.push({
        label: "Clock Hall",
        action: () => {
          this.closeOverlay();
          this.showRoom("clock");
        }
      });
    }

    if (canUseInnerRooms) {
      destinations.push(
        {
          label: "Security",
          action: () => {
            this.closeOverlay();
            this.showRoom("security");
          }
        },
        {
          label: "Interrogation",
          action: () => {
            this.closeOverlay();
            this.showRoom("interrogation");
          }
        },
        {
          label: "Archive",
          action: () => {
            this.closeOverlay();
            this.showRoom("archive");
          }
        },
        {
          label: "Break Room",
          action: () => {
            this.closeOverlay();
            this.showRoom("break");
          }
        }
      );
    }

    if (canUseMirror) {
      destinations.push({
        label: "Mirror Office",
        action: () => {
          this.closeOverlay();
          this.showRoom("mirror");
        }
      });
    }

    destinations.push({ label: "Close", action: () => this.closeOverlay() });
    const mirrorMissing = this.missingMirrorRequirements();
    const lockSummary = canUseMirror
      ? "Mirror Office is cleared for travel."
      : this.state.has("auditWarrant")
        ? mirrorMissing.length > 0
          ? `Mirror Office still needs ${this.formatRequirementList(mirrorMissing)}.`
          : "Mirror Office access is waiting for the inner floor route to stabilize."
        : canUseInnerRooms
          ? "Security can issue the warrant after you inspect evidence."
          : "Stamp the paperwork and solve the clocks to open the inner floor.";
    this.showMessage("Floor Map", `${lockSummary}\n\nUnlocked rooms can be reached from here without walking every hallway again.`, destinations);
  }

  private showHint(): void {
    const hints: Record<RoomId, string[]> = {
      reception: [
        "The circular door wants official red ink.",
        "Try taking a blank form and the stamp. Select either one, then click the other.",
        "The future phone is not just flavor. Count the three click groups, but there is also a visual version later."
      ],
      clock: [
        "The mood clocks need the clerk-processing order.",
        "Reception tells you the first and last moods. The calendar confirms the middle.",
        "The order is Regret, Hunger, Calm, Joy. Solving it opens Security, Interrogation, Archive, and Break Room."
      ],
      security: [
        "Security is about authorization and evidence, not another number code.",
        "Inspect the monitors, incident board, or log. Then use your Visitor Badge or Stamped Form on the key cabinet, and the Security Key on the safe.",
        "The Audit Warrant opens the path toward Mirror Office. Monitor footage can also witness an archive override if you use the warrant there."
      ],
      interrogation: [
        "The booth gives an alternate clue for the vending code.",
        "The tape recorder replays the phone clue; the rain window shows it visually.",
        "The rain groups are seven, three, one."
      ],
      archive: [
        "The archive drawers want category order, then symbols.",
        "The archive table maps symbols to categories. The break-room board gives category order. Security monitor footage can support a warrant override.",
        "Triangle, Circle, Eye, Square unlocks the glass case. Or use an Audit Warrant after viewing the security footage."
      ],
      break: [
        "The vending machine needs a token, a cup, and a number.",
        "The token is in the archive. The cup is in this room. The number can come from the phone, tape recorder, or rain cipher.",
        "The vending code is 731."
      ],
      mirror: [
        "You need authorization, power, identity, the missing hour, and the reflected sequence.",
        "Use the shard on the black mirror and the fuse on the server console. Use the file or Audit Warrant on the intercom, then the Cup of Missing Hour.",
        "Final order: install fuse, verify file, verify hour, read mirror, run console. At the exit, file, hour, and warrant each lead somewhere different."
      ]
    };
    const pool = hints[this.state.room];
    const hintLevel = this.hintLevels[this.state.room] ?? 0;
    const hint = pool[hintLevel % pool.length];
    this.hintLevels[this.state.room] = hintLevel + 1;
    this.showMessage("Hint", hint);
  }

  private showHelp(): void {
    this.showMessage(
      "Help",
      "Hand cursor marks useful objects. Select inventory, then click an object. Tab/D-pad moves focus; Enter/Space/A activates; B/Escape closes panels. Map fast-travels.",
      [
        { label: this.state.largeText ? "Normal Text" : "Large Text", action: () => this.toggleLargeText() },
        { label: this.state.reducedMotion ? "Full Motion" : "Reduced Motion", action: () => this.toggleReducedMotion() },
        { label: "Recover Position", action: () => this.recoverPosition() },
        { label: "Close", action: () => this.closeOverlay() }
      ]
    );
  }

  private applyAccessibilityPreferences(): void {
    document.body.classList.toggle("game-text-large", this.state.largeText);
    document.body.classList.toggle("game-reduced-motion", this.state.reducedMotion);
    document.getElementById("game")?.setAttribute("data-motion-mode", this.state.reducedMotion ? "reduced" : "full");
  }

  private toggleLargeText(): void {
    this.state.largeText = !this.state.largeText;
    this.state.save();
    this.applyAccessibilityPreferences();
    this.showHelp();
  }

  private toggleReducedMotion(): void {
    this.state.reducedMotion = !this.state.reducedMotion;
    this.state.save();
    this.applyAccessibilityPreferences();
    this.showRoom(this.state.room, true);
    this.showHelp();
  }

  private recoverPosition(): void {
    this.state.repairInvariants();
    this.selectedItem = undefined;
    const targetRoom = this.validLoadedRoom(this.state.room);
    this.state.room = targetRoom;
    this.state.save();
    this.showRoom(targetRoom);
    this.showMessage(
      "Position Repaired",
      "Your save has been checked, impossible inventory gaps were repaired, and your hands are empty. No progress was deleted."
    );
  }

  private showNotes(): void {
    const objective = this.currentObjective();
    const notes = [
      "Current objective: " + objective,
      this.state.flag("formStamped") ? "Form 11-H has been stamped." : "Reception paperwork still needs official red ink.",
      this.state.flag("clockSolved")
        ? "Clock order solved: Regret, Hunger, Calm, Joy."
        : "Clock clue: new clerks process emotions from first regret to late joy.",
      this.state.has("securityKey") ? "Security key collected from the cabinet." : "",
      this.state.has("auditWarrant") ? "Audit Warrant acquired: Mirror Office access is authorized." : "",
      this.state.flag("securityFootageSeen") ? "Security footage can witness an Audit Warrant archive override." : "",
      this.state.flag("incidentBoardSeen") ? "Incident board ties your missing hour to the vending machine and Mirror Office audit." : "",
      this.state.flag("securityLogSeen") ? "Security log says Mirror Office wants warrant, identity, hour, and power." : "",
      this.state.flag("archiveTableSeen") ? "Archive table: Triangle=Apology, Circle=Appetite, Eye=Witness, Square=Rest." : "",
      this.state.flag("breakBoardSeen") ? "Break board order: Apology, Appetite, Witness, Rest." : "",
      this.state.flag("rainCipherSeen") ? "Rain cipher / phone groups: 7, 3, 1." : "",
      this.state.flag("glassCaseCollected") ? "Your file, mirror shard, and misfiled folder came from the glass case." : "",
      this.state.flag("selfFileReviewed") ? "Your file proves who the Department is correcting, even if the warrant authorizes the correction." : "",
      this.state.flag("vendingSolved") ? "Memory Vending dispensed the missing hour and server fuse." : "",
      this.state.flag("fuseInstalled") ? "Server fuse installed." : "",
      this.state.flag("mirrorClueSeen") ? "Mirror sequence: Circle, Triangle, Eye, Square." : "",
      this.state.flag("identityVerifiedByWarrant")
        ? "Intercom accepted the Audit Warrant as administrative identity."
        : this.state.flag("identityVerified")
          ? "Intercom accepted your Missing-Person File."
          : "",
      this.state.flag("hourVerified") ? "Intercom accepted the Cup of Missing Hour." : ""
    ].filter(Boolean);
    this.showDocument("Notes", notes.join("\n\n"));
  }

  private currentObjective(): string {
    if (!this.state.flag("formStamped")) {
      return "Collect a blank form and stamp it.";
    }
    if (!this.state.flag("clockSolved")) {
      return "Use the stamped form on the circle door and solve the mood clocks.";
    }
    if (!this.state.has("auditWarrant")) {
      return "Security can issue the warrant needed for Mirror Office. Inspect evidence, prove authority, then open the safe.";
    }
    if (!this.state.flag("archiveSolved")) {
      return "Unlock the archive glass case with the table and break-room clues, or inspect security footage and use the Audit Warrant.";
    }
    if (!this.state.flag("glassCaseCollected")) {
      return "Open the glass case and collect the records inside.";
    }
    if (!this.state.flag("vendingSolved")) {
      return "Use the token, cup, and three-digit clue at Memory Vending.";
    }
    if (!this.state.flag("mirrorShardInstalled")) {
      return "Enter Mirror Office and repair the black mirror with the shard.";
    }
    if (!this.state.flag("fuseInstalled")) {
      return "Power the server console with the fuse.";
    }
    if (!this.state.flag("identityVerified")) {
      return "Verify identity at the red intercom with your file or audit warrant.";
    }
    if (!this.state.flag("hourVerified")) {
      return "Present the missing hour to the red intercom and answer the Auditor.";
    }
    if (!this.state.flag("serverSolved")) {
      return "Run the server sequence reflected in the black mirror.";
    }
    return "Choose what to trust at the exit: your file, the missing hour, or the Audit Warrant.";
  }

  private toggleMute(): void {
    this.state.muted = !this.state.muted;
    this.audio.setMuted(this.state.muted);
    this.state.save();
    this.showRoom(this.state.room);
  }

  private adjustVolume(delta: number): void {
    this.state.audioVolume = Phaser.Math.Clamp(this.state.audioVolume + delta, 0, 1);
    this.audio.setVolume(this.state.audioVolume);
    this.state.save();
    this.say(`Volume ${Math.round(this.state.audioVolume * 100)}%.`);
  }

  private confirmReset(): void {
    this.showMessage(
      "Reset Shift",
      "Discard the current save and return to the title screen?",
      [
        {
          label: "Reset",
          action: () => {
            this.state.reset();
            this.applyAccessibilityPreferences();
            this.showTitle();
          }
        },
        { label: "Cancel", action: () => this.closeOverlay() }
      ],
      false,
      "Cancel"
    );
  }

  private roomStatus(roomId: RoomId): string {
    if (roomId === "reception") {
      return this.state.flag("clockUnlocked") ? "the circle door remembers you." : "the desk waits for proper paperwork.";
    }
    if (roomId === "clock") {
      return this.state.flag("clockSolved") ? "the clocks are grudgingly synchronized." : "the clocks need an emotional order.";
    }
    if (roomId === "security") {
      return this.state.has("auditWarrant")
        ? "warrant issued; monitors active."
        : this.state.has("securityKey")
          ? "inspect evidence, then open the safe."
          : "inspect evidence and prove authority.";
    }
    if (roomId === "interrogation") {
      return this.state.has("rainCipher") ? "the rain has confessed its number." : "the booth is waiting to give the vending clue another way.";
    }
    if (roomId === "archive") {
      return this.state.flag("glassCaseCollected")
        ? "your file is awake."
        : this.state.flag("archiveSolved")
          ? "the glass case is unlocked."
          : "the cabinets want symbols sorted by category.";
    }
    if (roomId === "break") {
      return this.state.flag("vendingSolved") ? "the vending machine has sold you an hour." : "the machine hums in three digits.";
    }
    return this.state.flag("serverSolved") ? "the exit is unlocked." : "the mirror, intercom, and server disagree about you.";
  }

  private say(message: string): void {
    this.setHover(message);
  }

  private setHover(message: string): void {
    this.hoverLabel?.setText(message);
  }

  private createAtmosphere(roomId: RoomId): void {
    this.applyAccessibilityPreferences();
    const colorByRoom: Record<RoomId, number> = {
      reception: 0xb4d39b,
      clock: 0x9bcad3,
      security: 0x8fb6a8,
      interrogation: 0x88a8bf,
      archive: 0xd3bd86,
      break: 0x8ed8cf,
      mirror: 0x7bb0ff
    };
    if (this.state.reducedMotion) {
      this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, 3, colorByRoom[roomId], 0.035).setDepth(5);
      for (let i = 0; i < 7; i += 1) {
        this.add
          .rectangle(Phaser.Math.Between(70, GAME_W - 70), Phaser.Math.Between(100, 660), Phaser.Math.Between(3, 7), 1, 0xf4e9c1, 0.08)
          .setDepth(4);
      }
      if (roomId === "interrogation") {
        for (let i = 0; i < 6; i += 1) {
          this.add
            .rectangle(Phaser.Math.Between(170, 420), Phaser.Math.Between(120, 360), 2, Phaser.Math.Between(24, 56), 0xa8c7d6, 0.1)
            .setDepth(5)
            .setRotation(-0.12);
        }
      }
      if (roomId === "security") {
        for (let i = 0; i < 9; i += 1) {
          this.add.rectangle(70 + (i % 3) * 120, 292 + Math.floor(i / 3) * 88, 94, 54, 0x99d8c9, 0.055).setDepth(5);
        }
      }
      return;
    }

    const scan = this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, 4, colorByRoom[roomId], 0.06).setDepth(5);
    this.tweens.add({
      targets: scan,
      y: GAME_H + 10,
      duration: 4200,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
    for (let i = 0; i < 18; i += 1) {
      const fleck = this.add
        .rectangle(Phaser.Math.Between(40, GAME_W - 40), Phaser.Math.Between(72, 690), Phaser.Math.Between(2, 8), 1, 0xf4e9c1, 0.16)
        .setDepth(4);
      this.tweens.add({
        targets: fleck,
        x: fleck.x + Phaser.Math.Between(-24, 24),
        y: fleck.y + Phaser.Math.Between(12, 42),
        alpha: { from: 0.04, to: 0.24 },
        duration: Phaser.Math.Between(1800, 4200),
        repeat: -1,
        yoyo: true,
        ease: "Sine.easeInOut"
      });
    }

    if (roomId === "interrogation") {
      for (let i = 0; i < 20; i += 1) {
        const rain = this.add
          .rectangle(Phaser.Math.Between(160, 430), Phaser.Math.Between(110, 370), 2, Phaser.Math.Between(26, 72), 0xa8c7d6, 0.16)
          .setDepth(5)
          .setRotation(-0.12);
        this.tweens.add({
          targets: rain,
          y: rain.y + Phaser.Math.Between(80, 160),
          alpha: { from: 0.05, to: 0.24 },
          duration: Phaser.Math.Between(900, 1800),
          repeat: -1,
          yoyo: true,
          delay: Phaser.Math.Between(0, 1200),
          ease: "Sine.easeInOut"
        });
      }
    }

    if (roomId === "security") {
      for (let i = 0; i < 9; i += 1) {
        const glow = this.add
          .rectangle(70 + (i % 3) * 120, 292 + Math.floor(i / 3) * 88, 94, 54, 0x99d8c9, 0.045)
          .setDepth(5);
        this.tweens.add({
          targets: glow,
          alpha: { from: 0.025, to: 0.12 },
          duration: Phaser.Math.Between(900, 1800),
          repeat: -1,
          yoyo: true,
          delay: Phaser.Math.Between(0, 600),
          ease: "Sine.easeInOut"
        });
      }
    }
  }

  private addVignette(): void {
    this.add.rectangle(GAME_W / 2, 0, GAME_W, 100, 0x000000, 0.3).setDepth(6);
    this.add.rectangle(GAME_W / 2, GAME_H, GAME_W, 130, 0x000000, 0.42).setDepth(6);
    this.add.rectangle(0, GAME_H / 2, 130, GAME_H, 0x000000, 0.34).setDepth(6);
    this.add.rectangle(GAME_W, GAME_H / 2, 130, GAME_H, 0x000000, 0.34).setDepth(6);
  }
}

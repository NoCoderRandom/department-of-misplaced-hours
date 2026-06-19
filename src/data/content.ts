import type { ItemId, RoomId } from "../state/GameState";

export interface ItemDef {
  id: ItemId;
  name: string;
  shortName: string;
  glyph: string;
  description: string;
}

export interface RoomDef {
  id: RoomId;
  name: string;
  background: string;
  ambience: "lobby" | "clock" | "security" | "interrogation" | "archive" | "break" | "server";
}

export const ITEMS: Record<ItemId, ItemDef> = {
  blankForm: {
    id: "blankForm",
    name: "Blank Form 11-H",
    shortName: "Form",
    glyph: "FORM",
    description: "A triplicate form for events that deny happening."
  },
  rubberStamp: {
    id: "rubberStamp",
    name: "Rubber Stamp",
    shortName: "Stamp",
    glyph: "STAMP",
    description: "The stamp face reads APPROVED when viewed directly and NO when reflected."
  },
  stampedForm: {
    id: "stampedForm",
    name: "Stamped Form",
    shortName: "Stamped",
    glyph: "SEAL",
    description: "The form now carries an official bruise of red ink."
  },
  visitorBadge: {
    id: "visitorBadge",
    name: "Visitor Badge",
    shortName: "Badge",
    glyph: "ID",
    description: "Temporary identification for a building that insists you have always worked here."
  },
  timeToken: {
    id: "timeToken",
    name: "Time Token",
    shortName: "Token",
    glyph: "TOK",
    description: "A dull coin minted for vending machines that accept regrets."
  },
  paperCup: {
    id: "paperCup",
    name: "Paper Cup",
    shortName: "Cup",
    glyph: "CUP",
    description: "Clean enough for water. Too thin for memory."
  },
  memoryCup: {
    id: "memoryCup",
    name: "Cup of Missing Hour",
    shortName: "Hour",
    glyph: "HOUR",
    description: "Steam rises in the shape of your own handwriting."
  },
  misfiledFolder: {
    id: "misfiledFolder",
    name: "Misfiled Folder",
    shortName: "Folder",
    glyph: "FILE",
    description: "Someone filed you under Weather, Office Furniture, and Apology."
  },
  mirrorShard: {
    id: "mirrorShard",
    name: "Mirror Shard",
    shortName: "Shard",
    glyph: "MIRR",
    description: "A piece of glass that reflects what the room is trying not to become."
  },
  serverFuse: {
    id: "serverFuse",
    name: "Server Fuse",
    shortName: "Fuse",
    glyph: "FUSE",
    description: "Warm, humming, and lightly embarrassed."
  },
  rainCipher: {
    id: "rainCipher",
    name: "Rain Cipher",
    shortName: "Cipher",
    glyph: "RAIN",
    description: "Three rain-streak groups copied from the interrogation window."
  },
  securityKey: {
    id: "securityKey",
    name: "Security Key",
    shortName: "Key",
    glyph: "KEY",
    description: "A heavy office key tagged EVIDENCE / DO NOT BECOME EVIDENCE."
  },
  auditWarrant: {
    id: "auditWarrant",
    name: "Audit Warrant",
    shortName: "Warrant",
    glyph: "WARR",
    description: "Authorization to inspect a system that has been inspecting you."
  },
  selfFile: {
    id: "selfFile",
    name: "Your Missing-Person File",
    shortName: "Self",
    glyph: "SELF",
    description: "Every page has your name, but the spelling changes when you blink."
  }
};

export const ROOMS: Record<RoomId, RoomDef> = {
  reception: {
    id: "reception",
    name: "Reception Desk",
    background: "bg-reception",
    ambience: "lobby"
  },
  clock: {
    id: "clock",
    name: "Clock Hall",
    background: "bg-clock",
    ambience: "clock"
  },
  security: {
    id: "security",
    name: "Security Office",
    background: "bg-security",
    ambience: "security"
  },
  interrogation: {
    id: "interrogation",
    name: "Interrogation Booth",
    background: "bg-interrogation",
    ambience: "interrogation"
  },
  archive: {
    id: "archive",
    name: "Records Archive",
    background: "bg-archive",
    ambience: "archive"
  },
  break: {
    id: "break",
    name: "Break Room",
    background: "bg-break",
    ambience: "break"
  },
  mirror: {
    id: "mirror",
    name: "Mirror Office",
    background: "bg-mirror",
    ambience: "server"
  }
};

export const RESEARCH_LINKS = [
  {
    label: "Phaser Vite TypeScript template",
    url: "https://github.com/phaserjs/template-vite-ts"
  },
  {
    label: "GitHub Pages custom workflows",
    url: "https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages"
  },
  {
    label: "GitHub Pages publishing source",
    url: "https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site"
  },
  {
    label: "Kenney CC0 asset reference",
    url: "https://kenney.nl/support"
  },
  {
    label: "Point-and-click puzzle design article",
    url: "https://www.gamedeveloper.com/design/how-to-design-brillo-point-and-click-adventure-game-puzzles"
  },
  {
    label: "Horror puzzle-design caution notes",
    url: "https://horror.dreamdawn.com/?p=202230"
  }
];

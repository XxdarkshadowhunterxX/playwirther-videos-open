// lib/assGenerator.ts
// Gerador de arquivo .ASS (Advanced SubStation Alpha) para burn-in de legendas
// [CONFIRMADO: método libass com {\\kf} karaoke tags para highlight word-by-word]

interface WordInput {
  id: string;
  text: string;
  type: "word" | "silence" | "punctuation";
  startTime: number;
  endTime: number;
  isFiller: boolean;
  isRemoved: boolean;
}

interface TemplateTheme {
  fontFamily: string;
  fontWeight: number;   // 700 = bold, 900 = black
  fontSize: number;
  textColor: string;    // hex #RRGGBB
  highlightColor: string;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidth: number;
  shadowEnabled: boolean;
  positionY: number;    // 0-100 % vertical
  wordsPerLine: number;
}

// Templates confirmados [CONFIRMADO: Submagic reverse engineering]
export const TEMPLATES: Record<string, TemplateTheme> = {
  Karl: {
    fontFamily: "Montserrat",
    fontWeight: 900,
    fontSize: 36,
    textColor: "#FFFFFF",
    highlightColor: "#FF6B00",
    outlineEnabled: true,
    outlineColor: "#000000",
    outlineWidth: 2,
    shadowEnabled: true,
    positionY: 55,
    wordsPerLine: 3,
  },
  Matt: {
    fontFamily: "Montserrat",
    fontWeight: 700,
    fontSize: 32,
    textColor: "#FFFFFF",
    highlightColor: "#00D4FF",
    outlineEnabled: true,
    outlineColor: "#000000",
    outlineWidth: 2,
    shadowEnabled: false,
    positionY: 55,
    wordsPerLine: 3,
  },
  Doug: {
    fontFamily: "BebasNeue",
    fontWeight: 400,
    fontSize: 48,
    textColor: "#FFFFFF",
    highlightColor: "#FFD700",
    outlineEnabled: false,
    outlineColor: "#000000",
    outlineWidth: 0,
    shadowEnabled: true,
    positionY: 60,
    wordsPerLine: 4,
  },
  Kendrick: {
    fontFamily: "Poppins",
    fontWeight: 700,
    fontSize: 34,
    textColor: "#FFFFFF",
    highlightColor: "#00FF88",
    outlineEnabled: true,
    outlineColor: "#000000",
    outlineWidth: 1,
    shadowEnabled: false,
    positionY: 55,
    wordsPerLine: 3,
  },
};

// ── Conversão de cor #RRGGBB → &HAABBGGRR (formato ASS) ──────────────
function hexToAssColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${r.toString(16).padStart(2, "0").toUpperCase()}`;
}

// ── Timestamp ASS: H:MM:SS.cs ─────────────────────────────────────────
function toAssTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

// ── Agrupamento de palavras em linhas (N palavras por linha) ──────────
function groupWordsIntoLines(words: WordInput[], wordsPerLine: number): WordInput[][] {
  const lines: WordInput[][] = [];
  let currentLine: WordInput[] = [];
  let wordCount = 0;

  for (const word of words) {
    if (word.isRemoved) continue;
    if (word.type === "silence") continue;

    currentLine.push(word);

    if (word.type === "word") {
      wordCount++;
      if (wordCount >= wordsPerLine) {
        lines.push(currentLine);
        currentLine = [];
        wordCount = 0;
      }
    }
  }

  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

// ── Geração do arquivo .ASS completo ─────────────────────────────────
export function generateAssFile(
  words: WordInput[],
  templateName: string,
  videoWidth = 1080,
  videoHeight = 1920
): string {
  const theme = TEMPLATES[templateName] ?? TEMPLATES.Karl;

  const primaryColor = hexToAssColor(theme.textColor);
  const secondaryColor = hexToAssColor(theme.highlightColor); // cor do karaoke ativo
  const outlineColor = hexToAssColor(theme.outlineEnabled ? theme.outlineColor : "#000000");
  const shadowColor = hexToAssColor("#000000", theme.shadowEnabled ? 0 : 255);
  const boldFlag = theme.fontWeight >= 700 ? "-1" : "0";
  const outlineWidth = theme.outlineEnabled ? theme.outlineWidth : 0;
  const shadowDepth = theme.shadowEnabled ? 1 : 0;

  // MarginV = distância da borda inferior
  const marginV = Math.floor(videoHeight * (1 - theme.positionY / 100));

  const header = [
    "[Script Info]",
    "Title: Playwirther Generated Captions",
    "ScriptType: v4.00+",
    "Collisions: Normal",
    `PlayResX: ${videoWidth}`,
    `PlayResY: ${videoHeight}`,
    "Timer: 100.0000",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${theme.fontFamily},${theme.fontSize},${primaryColor},${secondaryColor},${outlineColor},${shadowColor},${boldFlag},0,0,0,100,100,0,0,1,${outlineWidth},${shadowDepth},2,10,10,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");

  const lines = groupWordsIntoLines(words, theme.wordsPerLine);
  const events: string[] = [];

  for (const line of lines) {
    const activeWords = line.filter((w) => !w.isRemoved && w.type === "word");
    if (activeWords.length === 0) continue;

    const lineStart = activeWords[0].startTime;
    const lineEnd = activeWords[activeWords.length - 1].endTime;

    // Construir texto com tags karaoke {\\kf N}
    // N = duração em centisegundos
    // {\\kf} = karaoke fill — palavra fica na highlightColor enquanto ativa
    const textParts: string[] = [];
    for (let i = 0; i < activeWords.length; i++) {
      const word = activeWords[i];
      const durationCs = Math.round((word.endTime - word.startTime) * 100);
      textParts.push(`{\\kf${durationCs}}${word.text}`);
      if (i < activeWords.length - 1) textParts.push(" ");
    }

    const startTs = toAssTimestamp(lineStart);
    const endTs = toAssTimestamp(lineEnd);
    events.push(`Dialogue: 0,${startTs},${endTs},Default,,0,0,0,,${textParts.join("")}`);
  }

  return header + "\n" + events.join("\n") + "\n";
}

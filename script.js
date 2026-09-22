// ============================================================
// MODE CONFIGURATION
// ============================================================

const MODES = {
  daily: {
    label: "Daily",
    dataFile: "daily_g3.json",
  },

  challenge: {
    label: "Challenge",
    dataFile: "challenge_g4.json",
  },

  bonus: {
    label: "Bonus",
    dataFile: "bonus_b3.json",
  },
};

let currentMode = "daily";
let gameData = null;
let puzzleIndex = 0;
let puzzle = null;

const LAUNCH_YEAR = 2026;
const LAUNCH_MONTH = 8; // September; JS months start at 0
const LAUNCH_DAY = 20;

let gameNumber = 1;
let usingPuzzleOverride = false;

let showValues = false;

let timerStart = null;
let savedBonusSession = null;

let state = {
  left: [],
  right: [],
  leftValue: null,
  rightValue: null,
  selected: null,
  solved: false,
  hintLevel: 0,

  // Bonus-only
  bonusStarted: false,
  bonusLeftOps: [],
  elapsedMs: null,
};

// ============================================================
// ELEMENTS
// ============================================================

const els = {
  board: document.getElementById("board"),

  gameCard: document.getElementById("game-card"),

  leftBank: document.getElementById("left-bank"),
  rightBank: document.getElementById("right-bank"),

  leftExpression: document.getElementById("left-expression"),
  rightExpression: document.getElementById("right-expression"),

  leftValue: document.getElementById("left-value"),
  rightValue: document.getElementById("right-value"),

  equalsSign: document.getElementById("equals-sign"),

  operatorBankWrap: document.getElementById("operator-bank-wrap"),
  operatorBank: document.getElementById("operator-bank"),

  bonusControls: document.getElementById("bonus-controls"),
  bonusStartBtn: document.getElementById("bonus-start-btn"),
  bonusTimer: document.getElementById("bonus-timer"),

  helpRow: document.getElementById("help-row"),
  showValuesToggle: document.getElementById("show-values-toggle"),
  hintBtn: document.getElementById("hint-btn"),
  hintText: document.getElementById("hint-text"),

  helpInfoBtn: document.getElementById("help-info-btn"),

  helpDialog: document.getElementById("help-dialog"),
  helpDialogX: document.getElementById("help-dialog-x"),
  helpDialogClose: document.getElementById("help-dialog-close"),

  status: document.getElementById("status"),
  puzzleNumber: document.getElementById("puzzle-number"),

  clearBtn: document.getElementById("clear-btn"),
  shareBtn: document.getElementById("share-btn"),

  howToPlayBtn: document.getElementById("how-to-play-btn"),

  howToPlayDialog: document.getElementById("how-to-play-dialog"),

  howToPlayX: document.getElementById("how-to-play-x"),

  howToPlayClose: document.getElementById("how-to-play-close"),

  modeButtons: document.querySelectorAll(".mode-btn"),
};

// ============================================================
// MODE HELPERS
// ============================================================

function isBonusMode() {
  return currentMode === "bonus";
}

function getInitialMode() {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get("mode");

  if (requestedMode in MODES) {
    return requestedMode;
  }

  return "daily";
}

// ============================================================
// LOAD MODE DATA
// ============================================================

function saveCurrentBonusSession() {
  if (!isBonusMode() || !puzzle) {
    return;
  }

  savedBonusSession = {
    puzzleId: puzzle.id,
    puzzleIndex,

    state: {
      ...state,
      bonusLeftOps: [...state.bonusLeftOps],
    },

    timerStart,
  };
}

async function loadMode(mode) {
  if (!(mode in MODES)) {
    mode = "daily";
  }

  prepareGameReveal();

  // If we're leaving Bonus, preserve its current session.
  if (isBonusMode()) {
    saveCurrentBonusSession();
  }

  currentMode = mode;

  updateModeButtons();

  const config = MODES[currentMode];

  try {
    const response = await fetch(config.dataFile);

    if (!response.ok) {
      throw new Error(`Could not load ${config.dataFile}`);
    }

    gameData = await response.json();

    if (!gameData.puzzles?.length) {
      throw new Error("The puzzle file contains no puzzles.");
    }

    els.board.dataset.digits = gameData.digitsPerSide;

    puzzleIndex = initialPuzzleIndex(gameData.puzzles.length);

    updateURLMode();

    startPuzzle(puzzleIndex);

    playGameReveal();
  } catch (error) {
    console.error(error);
    els.gameCard.classList.remove("reveal-pending");
    showStatus(`Could not load ${config.dataFile}.`, "error");
  }
}

// ============================================================
// URL / ROTATION
// ============================================================

function initialPuzzleIndex(length) {
  const params = new URLSearchParams(window.location.search);

  // Development/testing override.
  if (params.has("puzzle")) {
    const requested = Number(params.get("puzzle"));

    if (Number.isInteger(requested)) {
      usingPuzzleOverride = true;

      return ((requested % length) + length) % length;
    }
  }

  usingPuzzleOverride = false;

  const now = new Date();

  // Convert LOCAL calendar dates to UTC timestamps.
  // This avoids daylight-saving-time problems while still
  // changing puzzles at the user's local midnight.
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const launchUTC = Date.UTC(LAUNCH_YEAR, LAUNCH_MONTH, LAUNCH_DAY);

  const daysSinceLaunch = Math.floor((todayUTC - launchUTC) / 86400000);

  gameNumber = Math.max(1, daysSinceLaunch + 1);

  return (gameNumber - 1) % length;
}

function updateURLMode() {
  const url = new URL(window.location.href);
  url.searchParams.set("mode", currentMode);
  window.history.replaceState({}, "", url);
}

// ============================================================
// MODE BUTTONS
// ============================================================

function updateModeButtons() {
  els.modeButtons.forEach((button) => {
    const active = button.dataset.mode === currentMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active);
  });
}

els.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.dataset.mode;

    if (mode === currentMode) {
      return;
    }

    loadMode(mode);
  });
});

// ============================================================
// START PUZZLE
// ============================================================

function startPuzzle(index) {
  puzzleIndex =
    ((index % gameData.puzzles.length) + gameData.puzzles.length) %
    gameData.puzzles.length;

  puzzle = gameData.puzzles[puzzleIndex];

  // ========================================================
  // BONUS
  // ========================================================

  if (isBonusMode()) {
    // If we're returning to the same Bonus puzzle,
    // restore exactly where we left off.
    if (savedBonusSession && savedBonusSession.puzzleId === puzzle.id) {
      state = {
        ...savedBonusSession.state,

        bonusLeftOps: [...savedBonusSession.state.bonusLeftOps],
      };

      timerStart = savedBonusSession.timerStart;

      render();

      return;
    }

    // Otherwise this is genuinely a new Bonus puzzle.
    stopBonusTimer();

    savedBonusSession = null;

    state = {
      left: [],
      right: [],

      leftValue: null,
      rightValue: null,

      selected: null,

      solved: false,

      hintLevel: 0,

      bonusStarted: false,

      bonusLeftOps: Array(puzzle.leftDigits.length - 1).fill(null),

      elapsedMs: null,
    };

    render();

    return;
  }

  // ========================================================
  // DAILY / CHALLENGE
  // ========================================================

  state = {
    left: Array(puzzle.leftDigits.length).fill(null),

    right: Array(puzzle.rightDigits.length).fill(null),

    leftValue: null,
    rightValue: null,

    selected: null,

    solved: false,

    hintLevel: 0,

    bonusStarted: false,

    bonusLeftOps: [],

    elapsedMs: null,
  };

  restoreState();

  updateCalculatedValues();

  render();
}

// ============================================================
// DAILY COMPLETION
// ============================================================

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();

  const month = String(date.getMonth() + 1).padStart(2, "0");

  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getLocalDateLabel(date = new Date()) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function completionStorageKey() {
  return `arithmetic-puzzle:completion:` + getLocalDateKey();
}

function getTodayCompletions() {
  const blank = {
    daily: null,
    challenge: null,
    bonus: null,
  };

  try {
    const raw = localStorage.getItem(completionStorageKey());

    if (!raw) {
      return blank;
    }

    const saved = JSON.parse(raw);

    return {
      ...blank,
      ...saved,
    };
  } catch {
    return blank;
  }
}

function saveTodayCompletions(completions) {
  localStorage.setItem(completionStorageKey(), JSON.stringify(completions));
}

function recordCompletionIfNeeded() {
  // Test puzzles never count.
  if (usingPuzzleOverride || !state.solved) {
    return;
  }

  const completions = getTodayCompletions();

  // First solve counts.
  // Replays do not overwrite the result.
  if (completions[currentMode]) {
    return;
  }

  if (isBonusMode()) {
    completions.bonus = {
      solved: true,

      elapsedMs: Math.round(state.elapsedMs ?? 0),
    };
  } else {
    completions[currentMode] = {
      solved: true,

      hints: Math.max(0, Math.min(2, Number(state.hintLevel) || 0)),
    };
  }

  saveTodayCompletions(completions);
}

// ============================================================
// STORAGE (main modes only)
// ============================================================

function storageKey() {
  // Developer/test puzzles can retain their own
  // test state independently.
  if (usingPuzzleOverride) {
    return `arithmetic-puzzle:test:` + `${currentMode}:${puzzle.id}`;
  }

  // Normal daily play is tied to the date.
  //
  // This prevents puzzle G3-0123 from restoring its
  // old solved state when it appears again 700 days later.
  return (
    `arithmetic-puzzle:` +
    `${getLocalDateKey()}:` +
    `${currentMode}:` +
    `${puzzle.id}`
  );
}

function saveState() {
  if (isBonusMode()) return;

  localStorage.setItem(
    storageKey(),
    JSON.stringify({
      left: state.left,
      right: state.right,
      solved: state.solved,
      hintLevel: state.hintLevel,
    }),
  );
}

function restoreState() {
  const raw = localStorage.getItem(storageKey());
  if (!raw) return;

  try {
    const saved = JSON.parse(raw);

    if (
      Array.isArray(saved.left) &&
      Array.isArray(saved.right) &&
      saved.left.length === puzzle.leftDigits.length &&
      saved.right.length === puzzle.rightDigits.length
    ) {
      state.left = saved.left;
      state.right = saved.right;
      state.solved = Boolean(saved.solved);
      state.hintLevel = Number(saved.hintLevel) || 0;
    }
  } catch {
    // ignore
  }
}

// ============================================================
// RENDER
// ============================================================

function render() {
  const label = MODES[currentMode].label;

  if (usingPuzzleOverride) {
    els.puzzleNumber.textContent = `${label} • Test puzzle ${puzzleIndex + 1} of ${gameData.puzzles.length}`;
  } else {
    const today = new Date();

    const dateLabel = today.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    els.puzzleNumber.textContent = `${label} • ${dateLabel}`;
  }

if (isBonusMode()) {
  renderBonus();
} else {
  renderMainModes();
}

  if (state.solved) {
    if (isBonusMode() && state.elapsedMs !== null) {
      showStatus(`Solved! ${formatElapsed(state.elapsedMs)}`, "success");
    } else {
      showStatus("Solved!", "success");
    }
  } else {
    showStatus("", "");
  }

  renderCompletionUI();
}

function prepareGameReveal() {
  // Remove any previous animation state.
  els.gameCard.classList.remove("initial-reveal");

  // Hide the card while the newly selected
  // mode is loading.
  els.gameCard.classList.add("reveal-pending");
}

function playGameReveal() {
  // Force the browser to recognize a fresh animation
  // even if modes are changed quickly.
  void els.gameCard.offsetWidth;

  requestAnimationFrame(() => {
    els.gameCard.classList.remove("reveal-pending");

    els.gameCard.classList.add("initial-reveal");

    els.gameCard.addEventListener(
      "animationend",
      () => {
        els.gameCard.classList.remove("initial-reveal");
      },
      {
        once: true,
      },
    );
  });
}

function flashIncorrectEquality() {
  // Remove first so the animation can restart
  // on consecutive incorrect attempts.
  els.equalsSign.classList.remove("incorrect");

  // Force the browser to register that removal.
  void els.equalsSign.offsetWidth;

  els.equalsSign.classList.add("incorrect");

  // Always clean up, including for users who
  // have reduced-motion enabled.
  window.setTimeout(() => {
    els.equalsSign.classList.remove("incorrect");
  }, 350);
}

function renderMainModes() {
  els.board.hidden = false;

  els.leftBank.hidden = false;
  els.rightBank.hidden = false;

  els.bonusControls.hidden = true;
  els.operatorBankWrap.hidden = true;

  // Daily / Challenge use Show Values and Hint.
  els.helpRow.hidden = false;
  els.showValuesToggle.parentElement.hidden = false;
  els.hintBtn.hidden = false;
  els.hintText.hidden = false;

  els.leftValue.hidden = false;
  els.rightValue.hidden = false;

  renderBank("left");
  renderBank("right");

  renderDigitExpression("left", puzzle.operators);

  renderDigitExpression("right", [...puzzle.operators].reverse());

  renderSideValues();
  renderHint();
}

function buildShareText() {
  const completions = getTodayCompletions();

  const gameTitle =
    document.getElementById("game-title").textContent.trim() || "PalindrOps";

  const lines = [`${gameTitle} — ${getLocalDateLabel()}`, ""];

  if (completions.daily) {
    const hints = completions.daily.hints;

    lines.push(`Daily ✓  ${hints} ${hints === 1 ? "hint" : "hints"}`);
  }

  if (completions.challenge) {
    const hints = completions.challenge.hints;

    lines.push(`Challenge ✓  ${hints} ${hints === 1 ? "hint" : "hints"}`);
  }

  if (completions.bonus) {
    lines.push(`Bonus ✓  ${formatElapsed(completions.bonus.elapsedMs)}`);
  }

  return lines.join("\n");
}

function flashShareButton(message) {
  const originalText = els.shareBtn.textContent;

  els.shareBtn.textContent = message;

  window.setTimeout(() => {
    els.shareBtn.textContent = originalText;
  }, 1400);
}

async function shareResults() {
  const text = buildShareText();

  try {
    await navigator.clipboard.writeText(text);

    flashShareButton("Copied!");
  } catch (error) {
    console.error("Could not copy results:", error);

    flashShareButton("Could not copy");
  }
}

function renderCompletionUI() {
  const completions = getTodayCompletions();

  els.modeButtons.forEach((button) => {
    const mode = button.dataset.mode;

    const completed = !usingPuzzleOverride && Boolean(completions[mode]);

    button.classList.toggle("completed", completed);

    const label = MODES[mode].label;

    button.setAttribute(
      "aria-label",
      completed ? `${label}, completed` : label,
    );
  });

  const anythingCompleted =
    !usingPuzzleOverride && Object.values(completions).some(Boolean);

  els.shareBtn.hidden = !anythingCompleted;
}

function renderBonus() {
  // Bonus does not use digit banks.
  els.leftBank.hidden = true;
  els.rightBank.hidden = true;

  // Bonus uses Show Values, but not Hint.
  els.helpRow.hidden = false;
  els.showValuesToggle.parentElement.hidden = false;
  els.hintBtn.hidden = true;
  els.hintText.hidden = true;

  els.leftValue.hidden = false;
  els.rightValue.hidden = false;

  els.board.hidden = false;
  els.operatorBankWrap.hidden = false;

  renderBonusExpression("left");
  renderBonusExpression("right");

  renderBonusOperatorBank();
  renderSideValues();

  // BEFORE START
  if (!state.bonusStarted) {
    els.bonusControls.hidden = false;
    els.bonusStartBtn.hidden = false;
    els.bonusTimer.hidden = true;

    return;
  }

  // ONCE STARTED
  els.bonusControls.hidden = true;
}

// ============================================================
// MAIN MODE RENDERING
// ============================================================

function renderBank(side) {
  const bank = side === "left" ? els.leftBank : els.rightBank;
  const digits = side === "left" ? puzzle.leftDigits : puzzle.rightDigits;
  const placements = state[side];

  bank.innerHTML = "";

  digits.forEach((digit, bankIndex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "digit-tile";
    btn.textContent = digit;

    const placed = placements.includes(digit);

    if (placed) {
      btn.classList.add("used");
    }

    if (
      state.selected?.type === "bank" &&
      state.selected.side === side &&
      state.selected.bankIndex === bankIndex
    ) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => {
      if (placed) {
        returnDigitToBank(side, digit);
      } else {
        selectBankDigit(side, bankIndex, digit);
      }
    });

    bank.appendChild(btn);
  });
}

function renderDigitExpression(side, operators) {
  const container = side === "left" ? els.leftExpression : els.rightExpression;
  const placements = state[side];

  container.innerHTML = "";

  placements.forEach((digit, slotIndex) => {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "slot";
    slot.textContent = digit ?? "";

    if (digit !== null) {
      slot.classList.add("filled");
    }

    if (
      state.selected?.type === "slot" &&
      state.selected.side === side &&
      state.selected.slotIndex === slotIndex
    ) {
      slot.classList.add("selected");
    }

    slot.addEventListener("click", () => {
      clickSlot(side, slotIndex);
    });

    container.appendChild(slot);

    if (slotIndex < operators.length) {
      const op = document.createElement("span");
      op.className = "operator";
      op.textContent = displayOperator(operators[slotIndex]);
      container.appendChild(op);
    }
  });
}

// ============================================================
// BONUS RENDERING
// ============================================================

function renderBonusExpression(side) {
  const container = side === "left" ? els.leftExpression : els.rightExpression;

  const digits = side === "left" ? puzzle.leftDigits : puzzle.rightDigits;

  container.innerHTML = "";

  for (let i = 0; i < digits.length; i += 1) {
    // ------------------------------------------------------
    // NUMBER CELL
    // ------------------------------------------------------

    const digitSlot = document.createElement("div");

    digitSlot.className = "slot fixed";

    // Before Start: blank cell.
    // After Start: reveal digit.
    if (state.bonusStarted) {
      digitSlot.textContent = digits[i];

      digitSlot.classList.add("filled");
    } else {
      digitSlot.textContent = "";
    }

    container.appendChild(digitSlot);

    // ------------------------------------------------------
    // OPERATOR SLOT
    // ------------------------------------------------------

    if (i < digits.length - 1) {
      const opSlot = document.createElement("button");

      opSlot.type = "button";

      opSlot.className = "op-slot";

      const leftIndex = getLeftOperatorIndexFromRendered(side, i);

      if (
        state.selected?.type === "operator" &&
        state.selected.source === "slot" &&
        state.selected.fromIndex === leftIndex
      ) {
        opSlot.classList.add("selected");
      }

      opSlot.dataset.leftIndex = leftIndex;

      const opValue = state.bonusLeftOps[leftIndex];

      opSlot.textContent = opValue ? displayOperator(opValue) : "";

      if (!state.bonusStarted || state.solved) {
        opSlot.disabled = true;
      }

      opSlot.addEventListener("click", () => {
        clickBonusOperatorSlot(side, i);
      });

      opSlot.addEventListener("mouseenter", () => {
        if (
          state.bonusStarted &&
          !state.solved &&
          state.selected?.type === "operator"
        ) {
          setMirrorSlotHighlight(leftIndex, true);
        }
      });

      opSlot.addEventListener("mouseleave", () => {
        setMirrorSlotHighlight(leftIndex, false);
      });

      opSlot.addEventListener("focus", () => {
        if (
          state.bonusStarted &&
          !state.solved &&
          state.selected?.type === "operator"
        ) {
          setMirrorSlotHighlight(leftIndex, true);
        }
      });

      opSlot.addEventListener("blur", () => {
        setMirrorSlotHighlight(leftIndex, false);
      });

      container.appendChild(opSlot);
    }
  }
}

function renderBonusOperatorBank() {
  const container = els.operatorBank;
  container.innerHTML = "";

  const availableOperators = gameData.availableOperators || [
    "+",
    "-",
    "*",
    "/",
    "^",
  ];

  availableOperators.forEach((op, bankIndex) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "operator-tile";
    btn.textContent = displayOperator(op);

    const used = state.bonusLeftOps.includes(op);

    if (used) {
      btn.classList.add("used");
    }

    if (
      state.selected?.type === "operator" &&
      state.selected.source === "bank" &&
      state.selected.operator === op
    ) {
      btn.classList.add("selected");
    }

    if (!state.bonusStarted || state.solved) {
      btn.disabled = true;
    }

    btn.addEventListener("click", () => {
      if (used) {
        returnOperatorToBank(op);
      } else {
        selectOperator(bankIndex, op);
      }
    });

    container.appendChild(btn);
  });
}

function renderBonusTimer() {
  if (state.solved && state.elapsedMs !== null) {
    els.bonusTimer.textContent = formatElapsed(state.elapsedMs);
  } else {
    els.bonusTimer.textContent = "";
  }
}

// ============================================================
// MAIN MODE INTERACTION
// ============================================================

function selectBankDigit(side, bankIndex, digit) {
  if (state.solved) return;

  if (
    state.selected?.type === "bank" &&
    state.selected.side === side &&
    state.selected.bankIndex === bankIndex
  ) {
    state.selected = null;
  } else {
    state.selected = {
      type: "bank",
      side,
      bankIndex,
      digit,
    };
  }

  render();
}

function returnDigitToBank(side, digit) {
  if (state.solved) return;

  const slotIndex = state[side].indexOf(digit);

  if (slotIndex === -1) return;

  state[side][slotIndex] = null;
  state.selected = null;

  boardChanged();
}

function clickSlot(side, slotIndex) {
  if (state.solved) return;

  const currentDigit = state[side][slotIndex];

  if (!state.selected) {
    if (currentDigit !== null) {
      state.selected = {
        type: "slot",
        side,
        slotIndex,
      };
      render();
    }
    return;
  }

  if (state.selected.type === "bank") {
    if (state.selected.side !== side) {
      showStatus("That digit belongs on the other side.", "error");
      return;
    }

    state[side][slotIndex] = state.selected.digit;
    state.selected = null;
    boardChanged();
    return;
  }

  if (state.selected.type === "slot") {
    if (state.selected.side !== side) {
      showStatus("Digits stay within their assigned side.", "error");
      return;
    }

    const fromIndex = state.selected.slotIndex;

    if (fromIndex === slotIndex) {
      state.selected = null;
      render();
      return;
    }

    const fromDigit = state[side][fromIndex];
    const toDigit = state[side][slotIndex];

    state[side][slotIndex] = fromDigit;
    state[side][fromIndex] = toDigit;

    state.selected = null;
    boardChanged();
  }
}

function boardChanged() {
  updateCalculatedValues();

  saveState();

  if (state.solved) {
    recordCompletionIfNeeded();
  }

  render();

  // A completed equation that does not match
  // gets brief visual feedback.
  if (state.leftValue !== null && state.rightValue !== null && !state.solved) {
    flashIncorrectEquality();
  }
}

// ============================================================
// BONUS INTERACTION
// ============================================================

function selectOperator(bankIndex, operator) {
  if (!state.bonusStarted || state.solved) return;

  if (
    state.selected?.type === "operator" &&
    state.selected.source === "bank" &&
    state.selected.operator === operator
  ) {
    state.selected = null;
  } else {
    state.selected = {
      type: "operator",
      source: "bank",
      bankIndex,
      operator,
      fromIndex: null,
    };
  }

  render();
}

function clickBonusOperatorSlot(side, renderedIndex) {
  if (!state.bonusStarted || state.solved) return;

  const leftIndex = getLeftOperatorIndexFromRendered(side, renderedIndex);

  const currentOp = state.bonusLeftOps[leftIndex];

  // --------------------------------------------------------
  // NOTHING SELECTED
  //
  // Clicking a filled slot selects that placed operator.
  // --------------------------------------------------------

  if (!state.selected) {
    if (currentOp !== null) {
      state.selected = {
        type: "operator",
        source: "slot",
        fromIndex: leftIndex,
        operator: currentOp,
      };

      render();
    }

    return;
  }

  if (state.selected.type !== "operator") {
    return;
  }

  // --------------------------------------------------------
  // SELECTED OPERATOR CAME FROM BANK
  //
  // Place it here.
  //
  // If another operator was already here, that old operator
  // automatically becomes unused and returns to the bank.
  // --------------------------------------------------------

  if (state.selected.source === "bank") {
    state.bonusLeftOps[leftIndex] = state.selected.operator;

    state.selected = null;

    bonusBoardChanged();

    return;
  }

  // --------------------------------------------------------
  // SELECTED OPERATOR CAME FROM ANOTHER SLOT
  // --------------------------------------------------------

  if (state.selected.source === "slot") {
    const fromIndex = state.selected.fromIndex;

    // Clicking the same placement again deselects it.
    //
    // This also works if you click its mirrored counterpart,
    // because both visible slots map to the same leftIndex.
    if (fromIndex === leftIndex) {
      state.selected = null;
      render();

      return;
    }

    const fromOp = state.bonusLeftOps[fromIndex];

    const toOp = state.bonusLeftOps[leftIndex];

    // Swap.
    //
    // If toOp is null, this effectively becomes a move.
    state.bonusLeftOps[leftIndex] = fromOp;

    state.bonusLeftOps[fromIndex] = toOp;

    state.selected = null;

    bonusBoardChanged();
  }
}

function returnOperatorToBank(operator) {
  if (!state.bonusStarted || state.solved) return;

  const index = state.bonusLeftOps.indexOf(operator);
  if (index === -1) return;

  state.bonusLeftOps[index] = null;
  state.selected = null;

  bonusBoardChanged();
}

function getLeftOperatorIndexFromRendered(side, renderedIndex) {
  const count = puzzle.leftDigits.length - 1;

  if (side === "left") {
    return renderedIndex;
  }

  return count - 1 - renderedIndex;
}

function setMirrorSlotHighlight(leftIndex, highlighted) {
  const matchingSlots = document.querySelectorAll(
    `.op-slot[data-left-index="${leftIndex}"]`,
  );

  matchingSlots.forEach((slot) => {
    slot.classList.toggle("mirror-target", highlighted);
  });
}

function startBonusRun() {
  state.bonusStarted = true;

  state.solved = false;

  state.selected = null;

  state.elapsedMs = null;

  state.bonusLeftOps = Array(puzzle.leftDigits.length - 1).fill(null);

  timerStart = performance.now();

  showStatus("", "");

  render();
}

function stopBonusTimer() {
  timerStart = null;
}

function formatElapsed(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function updateBonusCalculatedValues() {
  // Both operators must be placed before either
  // expression has a complete value.
  if (!state.bonusStarted || state.bonusLeftOps.some((op) => op === null)) {
    state.leftValue = null;
    state.rightValue = null;
    return;
  }

  const leftOps = state.bonusLeftOps;

  const rightOps = [...leftOps].reverse();

  try {
    state.leftValue = evaluateExact(puzzle.leftDigits, leftOps).toString();

    state.rightValue = evaluateExact(puzzle.rightDigits, rightOps).toString();
  } catch {
    state.leftValue = null;
    state.rightValue = null;
  }
}

function updateBonusSolvedStatus() {
  updateBonusCalculatedValues();

  // Can't be solved until both expressions have values.
  if (state.leftValue === null || state.rightValue === null) {
    state.solved = false;
    return;
  }

  if (state.leftValue === state.rightValue) {
    if (timerStart !== null) {
      state.elapsedMs = performance.now() - timerStart;
    } else {
      state.elapsedMs = 0;
    }

    state.solved = true;
    state.selected = null;

    stopBonusTimer();

    recordCompletionIfNeeded();

    return;
  }

  state.solved = false;
}

function bonusBoardChanged() {
  updateBonusSolvedStatus();

  render();

  if (state.leftValue !== null && state.rightValue !== null && !state.solved) {
    flashIncorrectEquality();
  }
}

// ============================================================
// CLEAR
// ============================================================

function clearBoard() {
  // ========================================================
  // BONUS
  // ========================================================

  if (isBonusMode()) {
    // Before Start, there is nothing meaningful to clear.
    if (!state.bonusStarted) {
      return;
    }

    // After solving, Clear resets the Bonus completely
    // so it can be played again from the Start screen.
    if (state.solved) {
      stopBonusTimer();

      state.bonusStarted = false;
      state.solved = false;
      state.selected = null;
      state.elapsedMs = null;

      state.leftValue = null;
      state.rightValue = null;

      state.bonusLeftOps = Array(puzzle.leftDigits.length - 1).fill(null);

      render();

      return;
    }

    // During an active timed attempt:
    // clear the operators, but KEEP THE TIMER RUNNING.
    state.bonusLeftOps = Array(puzzle.leftDigits.length - 1).fill(null);

    state.selected = null;

    state.leftValue = null;
    state.rightValue = null;

    state.solved = false;

    render();

    return;
  }

  // ========================================================
  // DAILY / CHALLENGE
  // ========================================================

  state.left.fill(null);
  state.right.fill(null);

  state.leftValue = null;
  state.rightValue = null;

  state.selected = null;
  state.solved = false;
  state.hintLevel = 0;

  saveState();
  render();
}

// ============================================================
// DISPLAY HELPERS
// ============================================================

function displayOperator(op) {
  return (
    {
      "*": "×",
      "/": "÷",
      "^": "^",
      "+": "+",
      "-": "−",
    }[op] ?? op
  );
}

// ============================================================
// EXACT RATIONAL ARITHMETIC
// ============================================================

function absBigInt(n) {
  return n < 0n ? -n : n;
}

function gcd(a, b) {
  a = absBigInt(a);
  b = absBigInt(b);

  while (b !== 0n) {
    [a, b] = [b, a % b];
  }

  return a;
}

class Rational {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) {
      throw new Error("Division by zero");
    }

    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }

    const d = gcd(numerator, denominator);

    this.n = numerator / d;
    this.d = denominator / d;
  }

  add(other) {
    return new Rational(this.n * other.d + other.n * this.d, this.d * other.d);
  }

  sub(other) {
    return new Rational(this.n * other.d - other.n * this.d, this.d * other.d);
  }

  mul(other) {
    return new Rational(this.n * other.n, this.d * other.d);
  }

  div(other) {
    if (other.n === 0n) {
      throw new Error("Division by zero");
    }

    return new Rational(this.n * other.d, this.d * other.n);
  }

  powInteger(exponent) {
    if (exponent < 0n) {
      const positive = -exponent;
      return new Rational(this.d ** positive, this.n ** positive);
    }

    return new Rational(this.n ** exponent, this.d ** exponent);
  }

  equals(other) {
    return this.n === other.n && this.d === other.d;
  }

  toString() {
    return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`;
  }
}

function evaluateExact(digits, operators) {
  let values = digits.map((d) => new Rational(BigInt(d)));
  let ops = [...operators];

  while (ops.includes("^")) {
    const i = ops.indexOf("^");
    const exponent = values[i + 1];

    if (exponent.d !== 1n) {
      throw new Error("Non-integer exponent");
    }

    values[i] = values[i].powInteger(exponent.n);
    values.splice(i + 1, 1);
    ops.splice(i, 1);
  }

  let i = 0;

  while (i < ops.length) {
    if (ops[i] === "*" || ops[i] === "/") {
      values[i] =
        ops[i] === "*"
          ? values[i].mul(values[i + 1])
          : values[i].div(values[i + 1]);

      values.splice(i + 1, 1);
      ops.splice(i, 1);
    } else {
      i += 1;
    }
  }

  let result = values[0];

  for (let j = 0; j < ops.length; j += 1) {
    result =
      ops[j] === "+" ? result.add(values[j + 1]) : result.sub(values[j + 1]);
  }

  return result;
}

// ============================================================
// MAIN MODE CALCULATED VALUES
// ============================================================

function calculateSideValue(digits, operators) {
  if (digits.some((digit) => digit === null)) {
    return null;
  }

  try {
    return evaluateExact(digits, operators).toString();
  } catch {
    return null;
  }
}

function updateCalculatedValues() {
  state.leftValue = calculateSideValue(state.left, puzzle.operators);
  state.rightValue = calculateSideValue(
    state.right,
    [...puzzle.operators].reverse(),
  );

  const bothComplete = state.leftValue !== null && state.rightValue !== null;

  if (bothComplete && state.leftValue === state.rightValue) {
    state.solved = true;
    state.selected = null;
  } else {
    state.solved = false;
  }
}

// ============================================================
// SHOW VALUES
// ============================================================

function renderSideValues() {
  els.showValuesToggle.checked = showValues;

  if (!showValues) {
    els.leftValue.textContent = "";
    els.rightValue.textContent = "";
    return;
  }

  els.leftValue.textContent = state.leftValue !== null ? state.leftValue : "";
  els.rightValue.textContent =
    state.rightValue !== null ? state.rightValue : "";
}

// ============================================================
// HINT LOGIC
// ============================================================

function parseFractionString(value) {
  if (value.includes("/")) {
    const [n, d] = value.split("/");
    return {
      numerator: BigInt(n),
      denominator: BigInt(d),
    };
  }

  return {
    numerator: BigInt(value),
    denominator: 1n,
  };
}

function isTerminatingDenominator(denominator) {
  let d = denominator < 0n ? -denominator : denominator;

  while (d % 2n === 0n) d /= 2n;
  while (d % 5n === 0n) d /= 5n;

  return d === 1n;
}

function classifySolutionValue(value) {
  const { numerator, denominator } = parseFractionString(value);

  if (denominator === 1n) {
    return {
      priority: 1,
      type: "integer",
      denominator: 1n,
    };
  }

  const positive = numerator > 0n;
  const terminating = isTerminatingDenominator(denominator);

  if (positive && terminating) {
    return {
      priority: 2,
      type: "positive_terminating",
      denominator,
    };
  }

  if (positive && !terminating) {
    return {
      priority: 3,
      type: "positive_nonterminating",
      denominator,
    };
  }

  if (!positive && terminating) {
    return {
      priority: 4,
      type: "negative_terminating",
      denominator,
    };
  }

  return {
    priority: 5,
    type: "negative_nonterminating",
    denominator,
  };
}

function getPreferredHintValue(solutionValues) {
  const classified = solutionValues.map((value) => ({
    value,
    ...classifySolutionValue(value),
    fraction: parseFractionString(value),
  }));

  const bestTypePriority = Math.min(...classified.map((item) => item.priority));
  let candidates = classified.filter(
    (item) => item.priority === bestTypePriority,
  );

  if (bestTypePriority !== 1) {
    const smallestDenominator = candidates.reduce(
      (smallest, item) =>
        item.denominator < smallest ? item.denominator : smallest,
      candidates[0].denominator,
    );

    candidates = candidates.filter(
      (item) => item.denominator === smallestDenominator,
    );
  }

  function targetBucket(item) {
    const { numerator, denominator } = item.fraction;
    const hundred = 100n * denominator;

    if (numerator > 0n && numerator <= hundred) return 1;
    if (numerator < 0n && numerator >= -hundred) return 2;
    if (numerator === 0n) return 3;
    if (numerator > hundred) return 4;
    return 5;
  }

  function compareAbsoluteValues(a, b) {
    const aNum =
      a.fraction.numerator < 0n ? -a.fraction.numerator : a.fraction.numerator;
    const bNum =
      b.fraction.numerator < 0n ? -b.fraction.numerator : b.fraction.numerator;

    const left = aNum * b.fraction.denominator;
    const right = bNum * a.fraction.denominator;

    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  }

  candidates.sort((a, b) => {
    const bucketDifference = targetBucket(a) - targetBucket(b);
    if (bucketDifference !== 0) return bucketDifference;

    const magnitudeDifference = compareAbsoluteValues(a, b);
    if (magnitudeDifference !== 0) return magnitudeDifference;

    if (a.fraction.denominator < b.fraction.denominator) return -1;
    if (a.fraction.denominator > b.fraction.denominator) return 1;

    return 0;
  });

  return candidates[0];
}

function getResultTypeHint(solutionValues) {
  const best = getPreferredHintValue(solutionValues);

  switch (best.type) {
    case "integer":
      return "There is an integer solution.";

    case "positive_terminating":
      return `There is a positive solution with denominator ${best.denominator}.`;

    case "positive_nonterminating":
      return `There is a positive solution with denominator ${best.denominator}.`;

    case "negative_terminating":
      return `There is a negative solution with denominator ${best.denominator}.`;

    case "negative_nonterminating":
      return `There is a negative solution with denominator ${best.denominator}.`;
  }
}

function getTargetValueHint(solutionValues) {
  const best = getPreferredHintValue(solutionValues);
  return `One solution has value ${best.value}.`;
}

function renderHint() {
  if (state.hintLevel === 0) {
    els.hintText.textContent = "";
    els.hintBtn.textContent = "Hint";
    els.hintBtn.disabled = false;
    return;
  }

  if (state.hintLevel === 1) {
    els.hintText.textContent = getResultTypeHint(puzzle.solutionValues);
    els.hintBtn.textContent = "More help";
    els.hintBtn.disabled = false;
    return;
  }

  els.hintText.textContent = getTargetValueHint(puzzle.solutionValues);
  els.hintBtn.textContent = "Target shown";
  els.hintBtn.disabled = true;
}

// ============================================================
// STATUS
// ============================================================

function showStatus(message, kind) {
  els.status.textContent = message;
  els.status.className = "status";

  if (kind) {
    els.status.classList.add(kind);
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

els.showValuesToggle.addEventListener("change", () => {
  showValues = els.showValuesToggle.checked;
  renderSideValues();
});

els.hintBtn.addEventListener("click", () => {
  if (state.hintLevel < 2) {
    state.hintLevel += 1;
    saveState();
    renderHint();
  }
});

els.clearBtn.addEventListener("click", clearBoard);

els.shareBtn.addEventListener("click", shareResults);

els.helpInfoBtn.addEventListener("click", () => {
  els.helpDialog.showModal();
});

els.helpDialogX.addEventListener("click", () => {
  els.helpDialog.close();
});

els.helpDialogClose.addEventListener("click", () => {
  els.helpDialog.close();
});

els.helpDialog.addEventListener("click", (event) => {
  if (event.target === els.helpDialog) {
    els.helpDialog.close();
  }
});

els.howToPlayBtn.addEventListener("click", () => {
  els.howToPlayDialog.showModal();
});

els.howToPlayX.addEventListener("click", () => {
  els.howToPlayDialog.close();
});

els.howToPlayClose.addEventListener("click", () => {
  els.howToPlayDialog.close();
});

els.howToPlayDialog.addEventListener("click", (event) => {
  if (event.target === els.howToPlayDialog) {
    els.howToPlayDialog.close();
  }
});

// ============================================================
// PROTOTYPE PUZZLE NAVIGATION
// ============================================================

els.bonusStartBtn.addEventListener("click", () => {
  if (!isBonusMode()) return;
  startBonusRun();
});

// ============================================================
// GO
// ============================================================

currentMode = getInitialMode();
loadMode(currentMode);

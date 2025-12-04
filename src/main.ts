import './style.css';
import { Game } from './core/Game';
import { aiService, type AIProvider } from './services/AIService';
import { gameHistoryService } from './services/GameHistoryService';
import playbookData from './data/playbook.json';
import type { Play, Playbook, GameHistoryEntry, GameState } from './data/types';

const playbook = playbookData as Playbook;
let game: Game;
let selectedOffensePlay: Play | null = null;
let selectedDefensePlay: Play | null = null;
let history: string[] = [];

// Game state - starts at 50 yard line, 1st and 10
let gameState: GameState = {
  down: 1,
  yardsToGo: 10,
  ballPosition: 50, // 50 yard line (midfield)
  homeScore: 0,
  awayScore: 0,
  possession: 'home',
  quarter: 1
};

// In-memory play history for current session
let playHistory: { play: string; result: string; yardsGained: number; timestamp: number }[] = [];

// History playback state
let historyPlaybackAbortController: AbortController | null = null;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="game-container">
    <canvas id="renderCanvas"></canvas>
    <div id="ui-layer">
      <div class="panel" style="align-self: flex-start;">
        <h1 style="margin: 0; font-size: 1.2em;">Football America 2025</h1>
        <div id="score-display" style="font-size: 1.1em; margin: 5px 0;">HOME: 0 - AWAY: 0 | Q1</div>
        <div id="game-status">1st & 10 | Ball on 50</div>
        <div id="request-time" style="font-size: 0.85em; color: #888; margin: 5px 0;">Last request: --</div>
        <button id="btn-settings">Settings</button>
        <button id="btn-history">History</button>
        <button id="btn-new-play">New Play</button>
        <button id="btn-new-game" style="background: #aa3333;">New Game</button>
      </div>
      
      <div class="panel" id="controls">
        <div id="summary-crawl" style="display: none; text-align: center; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #444;">
          <span id="summary-outcome" style="font-weight: bold; text-transform: uppercase; margin-right: 8px;"></span>
          <span id="summary-text" style="font-size: 0.9em; color: #ccc;"></span>
        </div>
        <div id="normal-controls">
          <div style="display: flex; gap: 10px; align-items: center;">
            <button id="btn-play">Play</button>
            <button id="btn-pause">Pause</button>
            <label style="display: flex; align-items: center; gap: 5px; margin-left: 15px; cursor: pointer;">
              <input type="checkbox" id="ball-view-checkbox" checked>
              <span>Ball View</span>
            </label>
          </div>
          <input type="range" id="timeline" min="0" max="100" value="0" step="0.1" style="width: 100%; margin-top: 8px;">
          <div style="text-align: right; font-size: 0.9em;"><span id="time-display">0.0s</span></div>
        </div>
        <div id="history-playback-controls" style="display: none;">
          <div style="display: flex; gap: 10px; align-items: center; justify-content: center;">
            <button id="btn-stop-history" style="background: #aa3333; padding: 10px 30px;">⏹ Stop History Playback</button>
          </div>
          <div style="text-align: center; margin-top: 8px; font-size: 0.9em;">
            <span id="history-playback-status">Playing history...</span>
          </div>
        </div>
      </div>
    </div>

    <div id="play-selection">
      <h2>Choose Play</h2>
      <div class="play-grid" id="offense-plays">
        <!-- Offense plays injected here -->
      </div>
      <div class="play-grid" id="defense-plays" style="display:none;">
        <!-- Defense plays injected here -->
      </div>
      <div style="margin-top: 20px;">
        <button id="btn-confirm-play" disabled>Confirm Selection</button>
      </div>
    </div>

    <div id="settings-modal">
      <h2>Settings</h2>
      
      <label>AI Provider:</label>
      <div style="display: flex; gap: 10px; margin-bottom: 15px;">
        <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
          <input type="radio" name="ai-provider" value="openrouter" id="provider-openrouter">
          <span>OpenRouter (Cloud)</span>
        </label>
        <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
          <input type="radio" name="ai-provider" value="granite" id="provider-granite">
          <span>Granite (Local)</span>
        </label>
      </div>

      <div id="openrouter-settings">
        <label>OpenRouter API Key:</label>
        <input type="password" id="api-key-input" placeholder="sk-or-...">
        
        <label>Model:</label>
        <input list="model-options" id="model-select" placeholder="Select or type model...">
        <datalist id="model-options">
          <option value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash (Free)</option>
          <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (Free)</option>
          <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
          <option value="x-ai/grok-4.1-fast">Grok 4.1 Fast</option>
        </datalist>
      </div>

      <div id="granite-settings" style="display: none;">
        <div style="background: #1a2a3a; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h3 style="margin: 0 0 10px 0; font-size: 0.95em;">IBM Granite 4.0 1B (Local)</h3>
          <p style="margin: 0 0 10px 0; font-size: 0.85em; color: #aaa;">
            Run AI locally in your browser using WebGPU. No API key required!
            The model will be downloaded once and cached for future use (~700MB).
          </p>
          <div id="granite-status" style="padding: 8px; background: #0a1a2a; border-radius: 4px; margin-bottom: 10px;">
            <span id="granite-status-text">Model not loaded</span>
          </div>
          <div id="granite-progress" style="display: none; margin-bottom: 10px;">
            <div style="background: #333; height: 8px; border-radius: 4px; overflow: hidden;">
              <div id="granite-progress-bar" style="background: #4a9; height: 100%; width: 0%; transition: width 0.3s;"></div>
            </div>
            <div id="granite-progress-text" style="font-size: 0.8em; color: #aaa; margin-top: 5px;">0%</div>
          </div>
          <button id="btn-load-granite" style="width: 100%;">Download & Load Model</button>
        </div>
      </div>
      
      <div style="margin-top: 20px; text-align: right;">
        <button id="btn-save-settings">Save</button>
        <button id="btn-close-settings">Close</button>
      </div>
    </div>

    <div id="history-modal">
      <h2>Play History</h2>
      <div id="current-drive" style="background: #1a3a1a; padding: 10px; border-radius: 4px; margin-bottom: 10px;">
        <h3 style="margin: 0 0 10px 0; font-size: 0.9em;">Current Drive</h3>
        <div id="drive-summary"></div>
      </div>
      <div id="history-list" style="max-height: 250px; overflow-y: auto;">
        <!-- History items injected here -->
      </div>
      <div style="margin-top: 20px; display: flex; justify-content: space-between;">
        <button id="btn-clear-history" style="background: #aa3333;">Clear History</button>
        <div style="display: flex; gap: 10px;">
          <button id="btn-replay-all" style="background: #3a7a3a;">▶ Replay All</button>
          <button id="btn-close-history">Close</button>
        </div>
      </div>
    </div>
`;

// Initialize Game
game = new Game('renderCanvas');

// UI Elements
const playSelectionModal = document.getElementById('play-selection')!;
const offenseGrid = document.getElementById('offense-plays')!;
const defenseGrid = document.getElementById('defense-plays')!;
const btnConfirmPlay = document.getElementById('btn-confirm-play') as HTMLButtonElement;
const btnNewPlay = document.getElementById('btn-new-play') as HTMLButtonElement;
const btnNewGame = document.getElementById('btn-new-game') as HTMLButtonElement;
const btnSettings = document.getElementById('btn-settings')!;
const btnHistory = document.getElementById('btn-history')!;
const settingsModal = document.getElementById('settings-modal')!;
const btnSaveSettings = document.getElementById('btn-save-settings')!;
const btnCloseSettings = document.getElementById('btn-close-settings')!;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const modelInput = document.getElementById('model-select') as HTMLInputElement;
const timeline = document.getElementById('timeline') as HTMLInputElement;
const timeDisplay = document.getElementById('time-display')!;
const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
const ballViewCheckbox = document.getElementById('ball-view-checkbox') as HTMLInputElement;

const historyModal = document.getElementById('history-modal')!;
const historyList = document.getElementById('history-list')!;
const btnCloseHistory = document.getElementById('btn-close-history')!;
const btnClearHistory = document.getElementById('btn-clear-history')!;
const btnReplayAll = document.getElementById('btn-replay-all')!;
const normalControls = document.getElementById('normal-controls')!;
const historyPlaybackControls = document.getElementById('history-playback-controls')!;
const btnStopHistory = document.getElementById('btn-stop-history')!;
const historyPlaybackStatus = document.getElementById('history-playback-status')!;
const driveSummary = document.getElementById('drive-summary')!;
const gameStatusDisplay = document.getElementById('game-status')!;
const scoreDisplay = document.getElementById('score-display')!;
const requestTimeDisplay = document.getElementById('request-time')!;
const summaryCrawl = document.getElementById('summary-crawl')!;
const summaryOutcome = document.getElementById('summary-outcome')!;
const summaryText = document.getElementById('summary-text')!;

// Provider settings elements
const providerOpenRouter = document.getElementById('provider-openrouter') as HTMLInputElement;
const providerGranite = document.getElementById('provider-granite') as HTMLInputElement;
const openrouterSettings = document.getElementById('openrouter-settings')!;
const graniteSettings = document.getElementById('granite-settings')!;
const btnLoadGranite = document.getElementById('btn-load-granite') as HTMLButtonElement;
const graniteStatus = document.getElementById('granite-status')!;
const graniteStatusText = document.getElementById('granite-status-text')!;
const graniteProgress = document.getElementById('granite-progress')!;
const graniteProgressBar = document.getElementById('granite-progress-bar')!;
const graniteProgressText = document.getElementById('granite-progress-text')!;

// Helper function to format down
function formatDown(down: number): string {
  const ordinals = ['', '1st', '2nd', '3rd', '4th'];
  return ordinals[down] || `${down}th`;
}

// Helper function to format yard line
function formatYardLine(yardLine: number): string {
  if (yardLine === 50) return '50';
  if (yardLine > 50) return `OPP ${100 - yardLine}`;
  return `OWN ${yardLine}`;
}

// Update HUD display
function updateHUD() {
  const downText = formatDown(gameState.down);
  const yardsText = gameState.yardsToGo >= 10 ? '10' : gameState.yardsToGo.toString();
  const yardLineText = formatYardLine(gameState.ballPosition);
  const possessionText = gameState.possession === 'home' ? 'HOME' : 'AWAY';
  
  gameStatusDisplay.textContent = `${downText} & ${yardsText} | Ball on ${yardLineText} | ${possessionText} ball`;
  scoreDisplay.textContent = `HOME: ${gameState.homeScore} - AWAY: ${gameState.awayScore} | Q${gameState.quarter}`;
}

// Update summary crawl display
function updateSummaryCrawl(outcome: string, summary: string) {
  summaryCrawl.style.display = 'block';
  summaryOutcome.textContent = outcome;
  
  // Color code the outcome
  const outcomeColors: Record<string, string> = {
    'touchdown': '#4a4',
    'tackle': '#fff',
    'incomplete': '#aa4',
    'interception': '#a44',
    'turnover': '#a44'
  };
  summaryOutcome.style.color = outcomeColors[outcome.toLowerCase()] || '#fff';
  
  summaryText.textContent = summary;
}

// Calculate yards gained from simulation result
function calculateYardsGained(result: { outcome: string; summary: string }): number {
  // Try to extract yards from the summary
  const yardsMatch = result.summary.match(/(\d+)\s*yard/i);
  if (yardsMatch) {
    const yards = parseInt(yardsMatch[1]);
    // If the outcome was negative (tackle for loss, etc.), make it negative
    if (result.summary.toLowerCase().includes('loss') || result.summary.toLowerCase().includes('behind')) {
      return -yards;
    }
    return yards;
  }
  
  // Default yards based on outcome
  switch (result.outcome) {
    case 'touchdown': return Math.max(100 - gameState.ballPosition, 10);
    case 'incomplete': return 0;
    case 'interception': return 0;
    case 'turnover': return 0;
    case 'tackle': return Math.floor(Math.random() * 8) + 1; // 1-8 yards
    default: return 0;
  }
}

// Helper function to switch possession between home and away
// @param afterKickoff - If true, ball starts at typical kickoff position. If false (turnover), ball position is flipped.
function switchPossession(afterKickoff: boolean = true) {
  gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
  
  if (afterKickoff) {
    // After touchdown/kickoff - typical return position
    gameState.ballPosition = 25;
  } else {
    // Turnover - ball position flips (e.g., offense at OPP 30 → defense takes over at their own 30)
    gameState.ballPosition = 100 - gameState.ballPosition;
    // Ensure ball position is in bounds after flip
    gameState.ballPosition = Math.max(1, Math.min(99, gameState.ballPosition));
  }
  
  gameState.down = 1;
  gameState.yardsToGo = 10;
}

// Update game state after a play
function updateGameState(yardsGained: number, outcome: string) {
  // Record the play in history
  playHistory.push({
    play: `${selectedOffensePlay?.name || 'Unknown'} vs ${selectedDefensePlay?.name || 'Unknown'}`,
    result: outcome,
    yardsGained,
    timestamp: Date.now()
  });

  // Handle special outcomes
  if (outcome === 'touchdown') {
    // Add 7 points (6 for TD + 1 for extra point)
    // TODO: Add QTE (Quick Time Event) for extra point attempt instead of auto-awarding
    // For now, assume extra point is always good
    if (gameState.possession === 'home') {
      gameState.homeScore += 7;
    } else {
      gameState.awayScore += 7;
    }
    
    // Switch possession - other team gets the ball after kickoff
    switchPossession(true); // afterKickoff = true
    return;
  }

  if (outcome === 'interception' || outcome === 'turnover') {
    // Turnover - other team gets the ball at current position (flipped)
    switchPossession(false); // afterKickoff = false (turnover)
    return;
  }

  // Normal play progression
  gameState.ballPosition += yardsGained;
  
  // Keep ball position in bounds (0-100)
  // Note: 100+ would be a touchdown, but that should be handled by AI outcome
  gameState.ballPosition = Math.max(1, Math.min(99, gameState.ballPosition));
  
  // Check for first down
  if (yardsGained >= gameState.yardsToGo) {
    gameState.down = 1;
    gameState.yardsToGo = 10;
  } else {
    gameState.yardsToGo -= yardsGained;
    gameState.down++;
    
    // Turnover on downs - other team gets the ball at current spot
    if (gameState.down > 4) {
      switchPossession(false); // afterKickoff = false (turnover on downs)
    }
  }
}

// Populate Plays
function renderPlays() {
  offenseGrid.innerHTML = '';
  defenseGrid.innerHTML = '';

  playbook.plays.filter(p => p.side === 'offense').forEach(play => {
    const card = document.createElement('div');
    card.className = 'play-card';
    card.innerHTML = `<strong>${play.name}</strong><br><small>${play.type}</small>`;
    card.onclick = () => selectPlay(play, 'offense', card);
    offenseGrid.appendChild(card);
  });

  playbook.plays.filter(p => p.side === 'defense').forEach(play => {
    const card = document.createElement('div');
    card.className = 'play-card';
    card.innerHTML = `<strong>${play.name}</strong><br><small>${play.type}</small>`;
    card.onclick = () => selectPlay(play, 'defense', card);
    defenseGrid.appendChild(card);
  });
}

function selectPlay(play: Play, side: 'offense' | 'defense', element: HTMLElement) {
  // Home team is on offense when they have possession
  const homeIsOnOffense = gameState.possession === 'home';
  
  if (side === 'offense') {
    selectedOffensePlay = play;
    // Visual selection logic
    Array.from(offenseGrid.children).forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');
    
    // Check if both plays are now selected
    if (selectedDefensePlay) {
      // Both plays selected, enable confirm
      btnConfirmPlay.disabled = false;
    } else {
      // After picking offense, switch to defense selection
      offenseGrid.style.display = 'none';
      defenseGrid.style.display = 'grid';
      
      if (homeIsOnOffense) {
        // Home picked their offense, now pick opponent's defense (CPU)
        document.querySelector('#play-selection h2')!.textContent = "Choose Defense (CPU)";
      } else {
        // Home is on defense, this was CPU's offense pick, now home picks their defense
        document.querySelector('#play-selection h2')!.textContent = "Choose Defense";
      }
    }
  } else {
    selectedDefensePlay = play;
    Array.from(defenseGrid.children).forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');
    
    // Check if both plays are now selected
    if (selectedOffensePlay) {
      // Both plays selected, enable confirm
      btnConfirmPlay.disabled = false;
    } else {
      // After picking defense, switch to offense selection
      defenseGrid.style.display = 'none';
      offenseGrid.style.display = 'grid';
      
      if (homeIsOnOffense) {
        // Home is on offense, this was CPU's defense pick - shouldn't happen in normal flow
        document.querySelector('#play-selection h2')!.textContent = "Choose Offense";
      } else {
        // Home picked their defense, now pick CPU's offense
        document.querySelector('#play-selection h2')!.textContent = "Choose Offense (CPU)";
      }
    }
  }
}

// Event Listeners
btnNewPlay.onclick = () => {
  playSelectionModal.classList.add('active');
  selectedOffensePlay = null;
  selectedDefensePlay = null;
  btnConfirmPlay.disabled = true;
  
  // Check possession to determine which plays to show first
  // Home team picks their side first, then picks for CPU opponent
  const homeIsOnOffense = gameState.possession === 'home';
  
  if (homeIsOnOffense) {
    // Home is on offense - show offense plays for user to pick first
    offenseGrid.style.display = 'grid';
    defenseGrid.style.display = 'none';
    document.querySelector('#play-selection h2')!.textContent = "Choose Offense";
  } else {
    // Home is on defense - show defense plays for user to pick first
    offenseGrid.style.display = 'none';
    defenseGrid.style.display = 'grid';
    document.querySelector('#play-selection h2')!.textContent = "Choose Defense";
  }
  
  // Reset selection visuals
  renderPlays();
};

btnConfirmPlay.onclick = async () => {
  if (!selectedOffensePlay || !selectedDefensePlay) return;
  
  playSelectionModal.classList.remove('active');
  
  // Set field orientation based on possession (flip when home is on defense)
  const homeOnOffense = gameState.possession === 'home';
  game.setFieldOrientation(homeOnOffense);
  
  // Animate players to formation positions before simulation
  btnNewPlay.textContent = "Setting up...";
  btnNewPlay.disabled = true;
  await game.animateToFormation(selectedOffensePlay.formation, selectedDefensePlay.formation, 0.8);
  
  // Start Simulation
  try {
    btnNewPlay.textContent = "Simulating...";
    
    const result = await aiService.simulatePlay(selectedOffensePlay, selectedDefensePlay, history);
    
    console.log("Simulation Result:", result);
    history.push(`Play: ${selectedOffensePlay.name} vs ${selectedDefensePlay.name} -> ${result.summary}`);
    if (history.length > 5) history.shift(); // Keep last 5
    
    // Calculate yards gained and update game state
    const yardsGained = calculateYardsGained(result);
    updateGameState(yardsGained, result.outcome);
    updateHUD();
    
    // Save to IndexedDB with game state and yards gained
    await gameHistoryService.addEntry({
      timestamp: Date.now(),
      offensePlay: selectedOffensePlay,
      defensePlay: selectedDefensePlay,
      result: result,
      gameState: { ...gameState },
      yardsGained: yardsGained
    });

    game.loadSimulation(result);
    
    // Update summary crawl for QA
    updateSummaryCrawl(result.outcome, result.summary);
    
    // Update Timeline UI
    timeline.max = (result.frames[result.frames.length - 1].tick / 10).toString();
    
    btnNewPlay.textContent = "New Play";
    btnNewPlay.disabled = false;
    
    // Auto play
    game.play();
    
  } catch (error) {
    alert("Simulation failed: " + error);
    btnNewPlay.textContent = "New Play";
    btnNewPlay.disabled = false;
  }
};

// Settings
btnSettings.onclick = () => {
  const settings = aiService.getSettings();
  apiKeyInput.value = settings.apiKey || '';
  modelInput.value = settings.model;
  
  // Set provider radio
  if (settings.provider === 'granite') {
    providerGranite.checked = true;
    openrouterSettings.style.display = 'none';
    graniteSettings.style.display = 'block';
  } else {
    providerOpenRouter.checked = true;
    openrouterSettings.style.display = 'block';
    graniteSettings.style.display = 'none';
  }
  
  // Update granite status
  updateGraniteStatus();
  
  settingsModal.classList.add('active');
};

// Provider radio change handlers
providerOpenRouter.onchange = () => {
  openrouterSettings.style.display = 'block';
  graniteSettings.style.display = 'none';
};

providerGranite.onchange = () => {
  openrouterSettings.style.display = 'none';
  graniteSettings.style.display = 'block';
  updateGraniteStatus();
};

// Update Granite status display
function updateGraniteStatus() {
  const settings = aiService.getSettings();
  if (settings.isGraniteLoaded) {
    graniteStatusText.textContent = '✅ Model loaded and ready!';
    graniteStatus.style.borderLeft = '3px solid #4a9';
    btnLoadGranite.textContent = 'Model Ready';
    btnLoadGranite.disabled = true;
  } else if (settings.isGraniteLoading) {
    graniteStatusText.textContent = '⏳ Loading model...';
    graniteStatus.style.borderLeft = '3px solid #fa4';
    btnLoadGranite.disabled = true;
  } else {
    graniteStatusText.textContent = 'Model not loaded';
    graniteStatus.style.borderLeft = '3px solid #888';
    btnLoadGranite.textContent = 'Download & Load Model';
    btnLoadGranite.disabled = false;
  }
}

// Load Granite model button
btnLoadGranite.onclick = async () => {
  btnLoadGranite.disabled = true;
  btnLoadGranite.textContent = 'Loading...';
  graniteProgress.style.display = 'block';
  
  // Set up progress callback
  aiService.onGraniteLoadProgress = (progress, status) => {
    graniteProgressBar.style.width = `${progress}%`;
    graniteProgressText.textContent = status;
    graniteStatusText.textContent = `⏳ ${status}`;
  };
  
  try {
    await aiService.loadGraniteModel();
    updateGraniteStatus();
    graniteProgress.style.display = 'none';
  } catch (error) {
    graniteStatusText.textContent = `❌ Error: ${error instanceof Error ? error.message : 'Failed to load model'}`;
    graniteStatus.style.borderLeft = '3px solid #f44';
    btnLoadGranite.textContent = 'Retry Download';
    btnLoadGranite.disabled = false;
    graniteProgress.style.display = 'none';
  }
};

btnSaveSettings.onclick = () => {
  const provider: AIProvider = providerGranite.checked ? 'granite' : 'openrouter';
  aiService.saveSettings(apiKeyInput.value, modelInput.value, provider);
  settingsModal.classList.remove('active');
};

btnCloseSettings.onclick = () => {
  settingsModal.classList.remove('active');
};

// Playback Controls
btnPlay.onclick = () => game.play();
btnPause.onclick = () => game.pause();

// Ball View toggle
ballViewCheckbox.onchange = () => {
  game.setBallViewMode(ballViewCheckbox.checked);
};

timeline.oninput = (e) => {
  const val = parseFloat((e.target as HTMLInputElement).value);
  game.scrub(val);
  game.pause(); // Pause while scrubbing
};

game.onTimeUpdate = (time, total) => {
  timeline.value = time.toString();
  timeDisplay.textContent = `${time.toFixed(1)}s / ${total.toFixed(1)}s`;
};

// Handle playback completion - trigger touchdown celebration
game.onPlaybackComplete = (outcome) => {
  if (outcome === 'touchdown') {
    game.celebrateTouchdown();
  }
};

// History
btnHistory.onclick = async () => {
  historyModal.classList.add('active');
  
  // Show current drive summary
  if (playHistory.length > 0) {
    driveSummary.innerHTML = playHistory.map((p, i) => {
      const yardsText = p.yardsGained >= 0 ? `+${p.yardsGained}` : `${p.yardsGained}`;
      const yardColor = p.yardsGained >= 0 ? '#4a4' : '#a44';
      return `<div style="padding: 3px 0; border-bottom: 1px solid #333;">
        <span style="color: #888;">#${i + 1}</span> ${p.play} 
        <span style="color: ${yardColor};">${yardsText} yds</span>
        <span style="color: #888; font-size: 0.8em;">(${p.result})</span>
      </div>`;
    }).join('');
  } else {
    driveSummary.innerHTML = '<div style="color: #888;">No plays yet this drive</div>';
  }
  
  // Load saved history from IndexedDB
  const entries = await gameHistoryService.getAllEntries();
  historyList.innerHTML = '';
  
  if (entries.length === 0) {
    historyList.innerHTML = '<div style="color: #888; padding: 10px;">No saved plays. Play some games to see history here.</div>';
    return;
  }
  
  entries.sort((a, b) => b.timestamp - a.timestamp).forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const date = new Date(entry.timestamp).toLocaleString();
    const outcomeColor = entry.result.outcome === 'touchdown' ? '#4a4' : 
                         entry.result.outcome === 'interception' ? '#a44' : '#fff';
    
    // Calculate yards for display
    const yards = calculateYardsGainedFromEntry(entry);
    const yardsText = yards >= 0 ? `+${yards}` : `${yards}`;
    const yardsColor = yards > 0 ? '#4a4' : yards < 0 ? '#a44' : '#888';
    
    const infoDiv = document.createElement('div');
    infoDiv.style.flex = '1';
    infoDiv.innerHTML = `
      <div class="timestamp">${date}</div>
      <div><strong>${entry.offensePlay.name}</strong> vs <strong>${entry.defensePlay.name}</strong></div>
      <div style="font-size: 0.85em; color: #aaa; margin-top: 3px;">${entry.result.summary || ''}</div>
    `;
    
    const yardsDiv = document.createElement('div');
    yardsDiv.style.color = yardsColor;
    yardsDiv.style.fontWeight = 'bold';
    yardsDiv.style.marginRight = '10px';
    yardsDiv.style.minWidth = '50px';
    yardsDiv.style.textAlign = 'right';
    yardsDiv.textContent = `${yardsText} yds`;
    
    const resultDiv = document.createElement('div');
    resultDiv.className = 'result';
    resultDiv.style.color = outcomeColor;
    resultDiv.style.textTransform = 'uppercase';
    resultDiv.textContent = entry.result.outcome;
    
    const replayBtn = document.createElement('button');
    replayBtn.className = 'replay-btn';
    replayBtn.style.marginLeft = '10px';
    replayBtn.style.padding = '4px 8px';
    replayBtn.style.fontSize = '0.8em';
    replayBtn.textContent = '▶ Replay';
    replayBtn.onclick = (e) => {
      e.stopPropagation();
      loadHistoryEntry(entry);
    };
    
    item.appendChild(infoDiv);
    item.appendChild(yardsDiv);
    item.appendChild(resultDiv);
    item.appendChild(replayBtn);
    historyList.appendChild(item);
  });
};

btnCloseHistory.onclick = () => {
  historyModal.classList.remove('active');
};

// Clear history button
btnClearHistory.onclick = async () => {
  if (confirm('Are you sure you want to clear all play history?')) {
    await gameHistoryService.clearHistory();
    playHistory = [];
    driveSummary.innerHTML = '<div style="color: #888;">No plays yet this drive</div>';
    historyList.innerHTML = '<div style="color: #888; padding: 10px;">History cleared.</div>';
  }
};

// Enable/disable main controls
function setControlsEnabled(enabled: boolean) {
  btnNewPlay.disabled = !enabled;
  btnNewGame.disabled = !enabled;
  btnSettings.style.pointerEvents = enabled ? 'auto' : 'none';
  btnHistory.style.pointerEvents = enabled ? 'auto' : 'none';
  btnPlay.disabled = !enabled;
  btnPause.disabled = !enabled;
  timeline.disabled = !enabled;
  
  // Visual feedback
  const opacity = enabled ? '1' : '0.5';
  btnNewPlay.style.opacity = opacity;
  btnNewGame.style.opacity = opacity;
  btnSettings.style.opacity = opacity;
  btnHistory.style.opacity = opacity;
}

// Show/hide history playback UI
function setHistoryPlaybackMode(active: boolean) {
  normalControls.style.display = active ? 'none' : 'block';
  historyPlaybackControls.style.display = active ? 'block' : 'none';
  setControlsEnabled(!active);
}

// Sleep helper that respects abort signal
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Aborted'));
      });
    }
  });
}

// Wait for play to finish
function waitForPlayToFinish(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    
    const checkInterval = setInterval(() => {
      if (signal?.aborted) {
        clearInterval(checkInterval);
        reject(new Error('Aborted'));
        return;
      }
      
      // Check if playback is done (time reached total)
      const timeValue = parseFloat(timeline.value);
      const maxValue = parseFloat(timeline.max);
      if (timeValue >= maxValue - 0.1) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    
    // Also listen for abort
    if (signal) {
      signal.addEventListener('abort', () => {
        clearInterval(checkInterval);
        reject(new Error('Aborted'));
      });
    }
  });
}

// Replay all history entries
async function replayAllHistory() {
  const entries = await gameHistoryService.getAllEntries();
  if (entries.length === 0) {
    alert('No history to replay!');
    return;
  }
  
  // Sort by timestamp (oldest first)
  entries.sort((a, b) => a.timestamp - b.timestamp);
  
  // Close the modal
  historyModal.classList.remove('active');
  
  // Enter history playback mode
  setHistoryPlaybackMode(true);
  
  // Create abort controller
  historyPlaybackAbortController = new AbortController();
  const signal = historyPlaybackAbortController.signal;
  
  // Reset game state for playback
  resetGameState();
  updateHUD();
  
  try {
    for (let i = 0; i < entries.length; i++) {
      if (signal.aborted) break;
      
      const entry = entries[i];
      historyPlaybackStatus.textContent = `Playing ${i + 1} of ${entries.length}: ${entry.offensePlay.name} vs ${entry.defensePlay.name}`;
      
      // Animate players to formation positions
      await game.animateToFormation(entry.offensePlay.formation, entry.defensePlay.formation, 0.5);
      
      if (signal.aborted) break;
      
      // Small pause after formation
      await sleep(300, signal);
      
      if (signal.aborted) break;
      
      // Load and play the simulation
      game.loadSimulation(entry.result);
      updateSummaryCrawl(entry.result.outcome, entry.result.summary);
      timeline.max = (entry.result.frames[entry.result.frames.length - 1].tick / 10).toString();
      game.play();
      
      // Wait for play to finish
      await waitForPlayToFinish(signal);
      
      if (signal.aborted) break;
      
      // Update game state based on this play
      const yardsGained = calculateYardsGainedFromEntry(entry);
      updateGameStateFromReplay(yardsGained, entry.result.outcome);
      updateHUD();
      
      // Pause between plays (unless it's the last one)
      if (i < entries.length - 1) {
        historyPlaybackStatus.textContent = `Completed ${i + 1} of ${entries.length}. Next play in 1s...`;
        await sleep(1000, signal);
      }
    }
    
    if (!signal.aborted) {
      historyPlaybackStatus.textContent = 'History playback complete!';
      await sleep(1500);
    }
  } catch (e) {
    // Aborted - that's fine
    console.log('[History Playback] Stopped by user');
  }
  
  // Exit history playback mode
  setHistoryPlaybackMode(false);
  historyPlaybackAbortController = null;
  
  // Restore the final state from history
  await restoreGameFromHistory();
}

// Update game state during replay (similar to updateGameState but without saving)
function updateGameStateFromReplay(yardsGained: number, outcome: string) {
  if (outcome === 'touchdown') {
    if (gameState.possession === 'home') {
      gameState.homeScore += 7;
    } else {
      gameState.awayScore += 7;
    }
    // After TD kickoff - new team starts at their 25
    gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
    gameState.ballPosition = 25;
    gameState.down = 1;
    gameState.yardsToGo = 10;
    return;
  }

  if (outcome === 'interception' || outcome === 'turnover') {
    // Turnover - flip position for new team
    gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
    gameState.ballPosition = 100 - gameState.ballPosition;
    gameState.down = 1;
    gameState.yardsToGo = 10;
    return;
  }

  gameState.ballPosition += yardsGained;
  gameState.ballPosition = Math.max(1, Math.min(99, gameState.ballPosition));
  
  if (yardsGained >= gameState.yardsToGo) {
    gameState.down = 1;
    gameState.yardsToGo = 10;
  } else {
    gameState.yardsToGo -= yardsGained;
    gameState.down++;
    
    // Turnover on downs - flip position for new team
    if (gameState.down > 4) {
      gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
      gameState.ballPosition = 100 - gameState.ballPosition;
      gameState.down = 1;
      gameState.yardsToGo = 10;
    }
  }
}

// Replay All button handler
btnReplayAll.onclick = () => replayAllHistory();

// Stop history playback button
btnStopHistory.onclick = () => {
  if (historyPlaybackAbortController) {
    historyPlaybackAbortController.abort();
  }
};

function loadHistoryEntry(entry: GameHistoryEntry) {
  historyModal.classList.remove('active');
  
  // Restore game state if available
  if (entry.gameState) {
    gameState = { ...entry.gameState };
    updateHUD();
    // Set field orientation based on possession
    game.setFieldOrientation(gameState.possession === 'home');
  }
  
  game.loadSimulation(entry.result);
  updateSummaryCrawl(entry.result.outcome, entry.result.summary);
  timeline.max = (entry.result.frames[entry.result.frames.length - 1].tick / 10).toString();
  game.play();
}

// Set up request time callback
aiService.onRequestComplete = (durationMs: number) => {
  const seconds = (durationMs / 1000).toFixed(2);
  requestTimeDisplay.textContent = `Last request: ${seconds}s`;
  requestTimeDisplay.style.color = durationMs < 5000 ? '#4a4' : durationMs < 15000 ? '#aa4' : '#a44';
};

// Reset game to initial state
function resetGameState() {
  gameState = {
    down: 1,
    yardsToGo: 10,
    ballPosition: 50,
    homeScore: 0,
    awayScore: 0,
    possession: 'home',
    quarter: 1
  };
  playHistory = [];
  history = [];
  summaryCrawl.style.display = 'none';
  updateHUD();
  // Reset field orientation (home starts on offense)
  game.setFieldOrientation(true);
}

// Start a new game - clear history and reset state
async function startNewGame() {
  if (!confirm('Start a new game? This will erase all play history.')) {
    return;
  }
  await gameHistoryService.clearHistory();
  resetGameState();
  game.setFormation('pro_set', '4-3'); // Reset to default formations
}

// Restore game state from saved history
async function restoreGameFromHistory() {
  const entries = await gameHistoryService.getAllEntries();
  if (entries.length === 0) {
    console.log('[Game] No history found, starting fresh game');
    return;
  }
  
  // Sort by timestamp to replay in order
  entries.sort((a, b) => a.timestamp - b.timestamp);
  
  console.log(`[Game] Restoring game state from ${entries.length} plays...`);
  
  // Reset to initial state first
  resetGameState();
  
  // Replay each play to rebuild state by simulating outcomes
  // This ensures possession is correctly tracked even for old entries
  // that were saved before possession switching was implemented
  for (const entry of entries) {
    const yardsGained = calculateYardsGainedFromEntry(entry);
    const outcome = entry.result.outcome;
    
    // Simulate game state changes based on outcome
    if (outcome === 'touchdown') {
      if (gameState.possession === 'home') {
        gameState.homeScore += 7;
      } else {
        gameState.awayScore += 7;
      }
      // Switch possession after touchdown - other team starts at their 25
      gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
      gameState.ballPosition = 25;
      gameState.down = 1;
      gameState.yardsToGo = 10;
    } else if (outcome === 'interception' || outcome === 'turnover') {
      // Switch possession on turnover - flip ball position
      gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
      gameState.ballPosition = 100 - gameState.ballPosition;
      gameState.down = 1;
      gameState.yardsToGo = 10;
    } else {
      // Normal play - update ball position and check for first down
      gameState.ballPosition += yardsGained;
      gameState.ballPosition = Math.max(1, Math.min(99, gameState.ballPosition));
      
      if (yardsGained >= gameState.yardsToGo) {
        gameState.down = 1;
        gameState.yardsToGo = 10;
      } else {
        gameState.yardsToGo -= yardsGained;
        gameState.down++;
        
        if (gameState.down > 4) {
          // Turnover on downs - flip position for new team
          gameState.possession = gameState.possession === 'home' ? 'away' : 'home';
          gameState.ballPosition = 100 - gameState.ballPosition;
          gameState.down = 1;
          gameState.yardsToGo = 10;
        }
      }
    }
    
    // Add to play history for display
    playHistory.push({
      play: `${entry.offensePlay.name} vs ${entry.defensePlay.name}`,
      result: entry.result.outcome,
      yardsGained,
      timestamp: entry.timestamp
    });
    
    // Add to AI context history
    history.push(`Play: ${entry.offensePlay.name} vs ${entry.defensePlay.name} -> ${entry.result.summary}`);
    if (history.length > 5) history.shift();
  }
  
  // Update HUD with restored state
  updateHUD();
  
  // Set field orientation based on current possession
  game.setFieldOrientation(gameState.possession === 'home');
  
  // Load the last play's simulation into the scrubber so it can be replayed
  const lastEntry = entries[entries.length - 1];
  game.loadSimulation(lastEntry.result);
  
  // Update timeline UI with the last play's duration
  timeline.max = (lastEntry.result.frames[lastEntry.result.frames.length - 1].tick / 10).toString();
  
  // Show the last play's summary
  updateSummaryCrawl(lastEntry.result.outcome, lastEntry.result.summary);
  
  console.log(`[Game] Restored: ${gameState.homeScore}-${gameState.awayScore}, ${formatDown(gameState.down)} & ${gameState.yardsToGo} at ${formatYardLine(gameState.ballPosition)}, ${gameState.possession.toUpperCase()} ball`);
}

// Helper to calculate yards from a history entry
function calculateYardsGainedFromEntry(entry: GameHistoryEntry): number {
  // First, check if yardsGained was stored directly (new entries have this)
  if (entry.yardsGained !== undefined && entry.yardsGained !== null) {
    return entry.yardsGained;
  }
  
  // Fallback: Try to extract yards from the summary (for legacy entries)
  const yardsMatch = entry.result.summary.match(/(\d+)\s*yard/i);
  if (yardsMatch) {
    const yards = parseInt(yardsMatch[1]);
    if (entry.result.summary.toLowerCase().includes('loss') || entry.result.summary.toLowerCase().includes('behind')) {
      return -yards;
    }
    return yards;
  }
  
  // Final fallback: Default yards based on outcome
  switch (entry.result.outcome) {
    case 'touchdown': return 10; // Assume minimum TD distance
    case 'incomplete': return 0;
    case 'interception': return 0;
    case 'turnover': return 0;
    case 'tackle': return 3; // Assume average gain for tackle
    default: return 0;
  }
}

// New Game button handler
btnNewGame.onclick = () => startNewGame();

// Initial Render
renderPlays();
updateHUD(); // Initialize HUD with starting state

// Restore game from history on load
restoreGameFromHistory();

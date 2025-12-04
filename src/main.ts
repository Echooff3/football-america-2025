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

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="game-container">
    <canvas id="renderCanvas"></canvas>
    <div id="ui-layer">
      <div class="panel" style="align-self: flex-start;">
        <h1 style="margin: 0; font-size: 1.2em;">Football America 2025</h1>
        <div id="score-display" style="font-size: 1.1em; margin: 5px 0;">HOME: 0 - AWAY: 0 | Q1</div>
        <div id="game-status">1st & 10 | Ball on 50</div>
        <button id="btn-settings">Settings</button>
        <button id="btn-history">History</button>
        <button id="btn-new-play">New Play</button>
      </div>
      
      <div class="panel" id="controls">
        <button id="btn-play">Play</button>
        <button id="btn-pause">Pause</button>
        <input type="range" id="timeline" min="0" max="100" value="0" step="0.1">
        <span id="time-display">0.0s</span>
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

    <div id="history-modal" style="display:none;">
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
        <button id="btn-close-history">Close</button>
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
const btnSettings = document.getElementById('btn-settings')!;
const btnHistory = document.getElementById('btn-history')!;
const settingsModal = document.getElementById('settings-modal')!;
const btnSaveSettings = document.getElementById('btn-save-settings')!;
const btnCloseSettings = document.getElementById('btn-close-settings')!;
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const modelInput = document.getElementById('model-select') as HTMLInputElement;
const timeline = document.getElementById('timeline') as HTMLInputElement;
const timeDisplay = document.getElementById('time-display')!;
const btnPlay = document.getElementById('btn-play')!;
const btnPause = document.getElementById('btn-pause')!;

const historyModal = document.getElementById('history-modal')!;
const historyList = document.getElementById('history-list')!;
const btnCloseHistory = document.getElementById('btn-close-history')!;
const btnClearHistory = document.getElementById('btn-clear-history')!;
const driveSummary = document.getElementById('drive-summary')!;
const gameStatusDisplay = document.getElementById('game-status')!;
const scoreDisplay = document.getElementById('score-display')!;

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
  
  gameStatusDisplay.textContent = `${downText} & ${yardsText} | Ball on ${yardLineText}`;
  scoreDisplay.textContent = `HOME: ${gameState.homeScore} - AWAY: ${gameState.awayScore} | Q${gameState.quarter}`;
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
    gameState.homeScore += 7;
    gameState.ballPosition = 50; // Reset to 50
    gameState.down = 1;
    gameState.yardsToGo = 10;
    return;
  }

  if (outcome === 'interception' || outcome === 'turnover') {
    gameState.ballPosition = 50; // Reset to 50
    gameState.down = 1;
    gameState.yardsToGo = 10;
    return;
  }

  // Normal play progression
  gameState.ballPosition += yardsGained;
  
  // Check for first down
  if (yardsGained >= gameState.yardsToGo) {
    gameState.down = 1;
    gameState.yardsToGo = 10;
  } else {
    gameState.yardsToGo -= yardsGained;
    gameState.down++;
    
    // Turnover on downs
    if (gameState.down > 4) {
      gameState.down = 1;
      gameState.yardsToGo = 10;
      gameState.ballPosition = 50; // Reset to 50
    }
  }

  // Keep ball position in bounds
  gameState.ballPosition = Math.max(1, Math.min(99, gameState.ballPosition));
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
  if (side === 'offense') {
    selectedOffensePlay = play;
    // Visual selection logic
    Array.from(offenseGrid.children).forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');
    
    // For demo, auto-switch to defense selection or just pick random defense
    // Let's show defense grid now
    offenseGrid.style.display = 'none';
    defenseGrid.style.display = 'grid';
    document.querySelector('#play-selection h2')!.textContent = "Choose Defense (CPU)";
  } else {
    selectedDefensePlay = play;
    Array.from(defenseGrid.children).forEach(c => c.classList.remove('selected'));
    element.classList.add('selected');
    btnConfirmPlay.disabled = false;
  }
}

// Event Listeners
btnNewPlay.onclick = () => {
  playSelectionModal.classList.add('active');
  offenseGrid.style.display = 'grid';
  defenseGrid.style.display = 'none';
  document.querySelector('#play-selection h2')!.textContent = "Choose Offense";
  selectedOffensePlay = null;
  selectedDefensePlay = null;
  btnConfirmPlay.disabled = true;
  // Reset selection visuals
  renderPlays();
};

btnConfirmPlay.onclick = async () => {
  if (!selectedOffensePlay || !selectedDefensePlay) return;
  
  playSelectionModal.classList.remove('active');
  
  // Set players to formation positions before simulation
  game.setFormation(selectedOffensePlay.formation, selectedDefensePlay.formation);
  
  // Start Simulation
  try {
    btnNewPlay.textContent = "Simulating...";
    btnNewPlay.disabled = true;
    
    const result = await aiService.simulatePlay(selectedOffensePlay, selectedDefensePlay, history);
    
    console.log("Simulation Result:", result);
    history.push(`Play: ${selectedOffensePlay.name} vs ${selectedDefensePlay.name} -> ${result.summary}`);
    if (history.length > 5) history.shift(); // Keep last 5
    
    // Calculate yards gained and update game state
    const yardsGained = calculateYardsGained(result);
    updateGameState(yardsGained, result.outcome);
    updateHUD();
    
    // Save to IndexedDB with game state
    await gameHistoryService.addEntry({
      timestamp: Date.now(),
      offensePlay: selectedOffensePlay,
      defensePlay: selectedDefensePlay,
      result: result,
      gameState: { ...gameState }
    });

    game.loadSimulation(result);
    
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

timeline.oninput = (e) => {
  const val = parseFloat((e.target as HTMLInputElement).value);
  game.scrub(val);
  game.pause(); // Pause while scrubbing
};

game.onTimeUpdate = (time, total) => {
  timeline.value = time.toString();
  timeDisplay.textContent = `${time.toFixed(1)}s / ${total.toFixed(1)}s`;
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
    
    const infoDiv = document.createElement('div');
    infoDiv.style.flex = '1';
    infoDiv.innerHTML = `
      <div class="timestamp">${date}</div>
      <div><strong>${entry.offensePlay.name}</strong> vs <strong>${entry.defensePlay.name}</strong></div>
      <div style="font-size: 0.85em; color: #aaa; margin-top: 3px;">${entry.result.summary || ''}</div>
    `;
    
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

function loadHistoryEntry(entry: GameHistoryEntry) {
  historyModal.classList.remove('active');
  
  // Restore game state if available
  if (entry.gameState) {
    gameState = { ...entry.gameState };
    updateHUD();
  }
  
  game.loadSimulation(entry.result);
  timeline.max = (entry.result.frames[entry.result.frames.length - 1].tick / 10).toString();
  game.play();
}

// Initial Render
renderPlays();
updateHUD(); // Initialize HUD with starting state

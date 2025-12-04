import './style.css';
import { Game } from './core/Game';
import { aiService } from './services/AIService';
import { gameHistoryService } from './services/GameHistoryService';
import playbookData from './data/playbook.json';
import type { Play, Playbook, GameHistoryEntry } from './data/types';

const playbook = playbookData as Playbook;
let game: Game;
let selectedOffensePlay: Play | null = null;
let selectedDefensePlay: Play | null = null;
let history: string[] = [];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div id="game-container">
    <canvas id="renderCanvas"></canvas>
    <div id="ui-layer">
      <div class="panel" style="align-self: flex-start;">
        <h1 style="margin: 0; font-size: 1.2em;">Football America 2025</h1>
        <div id="game-status">Down: 1st & 10 | Ball on: 20</div>
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
      
      <div style="margin-top: 20px; text-align: right;">
        <button id="btn-save-settings">Save</button>
        <button id="btn-close-settings">Close</button>
      </div>
    </div>

    <div id="history-modal" style="display:none;">
      <h2>Play History</h2>
      <div id="history-list" style="max-height: 300px; overflow-y: auto;">
        <!-- History items injected here -->
      </div>
      <div style="margin-top: 20px; text-align: right;">
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
    
    // Save to IndexedDB
    await gameHistoryService.addEntry({
      timestamp: Date.now(),
      offensePlay: selectedOffensePlay,
      defensePlay: selectedDefensePlay,
      result: result
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
  settingsModal.classList.add('active');
};

btnSaveSettings.onclick = () => {
  aiService.saveSettings(apiKeyInput.value, modelInput.value);
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
  const entries = await gameHistoryService.getAllEntries();
  historyList.innerHTML = '';
  
  entries.sort((a, b) => b.timestamp - a.timestamp).forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';
    const date = new Date(entry.timestamp).toLocaleString();
    item.innerHTML = `
      <div>
        <div class="timestamp">${date}</div>
        <div>${entry.offensePlay.name} vs ${entry.defensePlay.name}</div>
      </div>
      <div class="result">${entry.result.outcome}</div>
    `;
    item.onclick = () => loadHistoryEntry(entry);
    historyList.appendChild(item);
  });
};

btnCloseHistory.onclick = () => {
  historyModal.classList.remove('active');
};

function loadHistoryEntry(entry: GameHistoryEntry) {
  historyModal.classList.remove('active');
  game.loadSimulation(entry.result);
  timeline.max = (entry.result.frames[entry.result.frames.length - 1].tick / 10).toString();
  game.play();
}

// Initial Render
renderPlays();

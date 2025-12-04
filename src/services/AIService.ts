import { SimulationSchema, type SimulationResult, type Play, type Playbook } from '../data/types';
import { expandKeyframes, type CompressedSimulation } from '../utils/interpolation';
import playbookData from '../data/playbook.json';
import {
  AutoModelForCausalLM,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer
} from "@huggingface/transformers";

const DEFAULT_MODEL = "amazon/nova-2-lite-v1";
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const GRANITE_MODEL_ID = "onnx-community/granite-4.0-1b-ONNX-web";

export type AIProvider = 'openrouter' | 'granite';

// Load playbook formations
const playbook = playbookData as Playbook;

// Compressed keyframe schema - much smaller output from AI
const COMPRESSED_SIMULATION_SCHEMA = {
  type: "object",
  properties: {
    outcome: {
      type: "string",
      enum: ["touchdown", "tackle", "incomplete", "interception", "turnover"],
      description: "The result of the play"
    },
    yardsGained: {
      type: "number",
      description: "Yards gained (positive) or lost (negative) on the play"
    },
    summary: { 
      type: "string",
      description: "A brief text summary of what happened in the play"
    },
    keyframes: {
      type: "array",
      description: "Sparse keyframes (every 5 ticks) - will be interpolated. Only include 6-10 keyframes total.",
      items: {
        type: "object",
        properties: {
          t: { type: "number", description: "Tick number (0, 5, 10, 15, etc.)" },
          b: { 
            type: "array", 
            items: { type: "number" },
            description: "Ball position [x, y, z]"
          },
          p: {
            type: "array",
            description: "Player states as arrays [id, x, z, rotation, animation]",
            items: {
              type: "array",
              items: [
                { type: "string" },
                { type: "number" },
                { type: "number" },
                { type: "number" },
                { type: "string", enum: ["idle", "sprint", "backpedal", "throw", "catch", "tackle", "fall", "block"] }
              ]
            }
          },
          e: {
            type: "array",
            items: { type: "string" },
            description: "Events that happen at this keyframe (snap, handoff, throw, catch, tackle, etc.)"
          }
        },
        required: ["t", "b", "p"]
      }
    }
  },
  required: ["outcome", "yardsGained", "summary", "keyframes"],
  additionalProperties: false
};

export class AIService {
  private apiKey: string | null = null;
  private model: string = DEFAULT_MODEL;
  private provider: AIProvider = 'openrouter';
  
  // Granite model state
  private graniteModel: PreTrainedModel | null = null;
  private graniteTokenizer: PreTrainedTokenizer | null = null;
  private isGraniteLoading: boolean = false;
  private graniteLoadProgress: number = 0;
  public onGraniteLoadProgress: ((progress: number, status: string) => void) | null = null;
  
  // Request timing metrics
  private lastRequestDurationMs: number = 0;
  public onRequestComplete: ((durationMs: number) => void) | null = null;

  constructor() {
    this.loadSettings();
  }

  public loadSettings() {
    this.apiKey = localStorage.getItem('openrouter_api_key');
    this.model = localStorage.getItem('openrouter_model') || DEFAULT_MODEL;
    this.provider = (localStorage.getItem('ai_provider') as AIProvider) || 'openrouter';
  }

  public saveSettings(apiKey: string, model: string, provider: AIProvider) {
    this.apiKey = apiKey;
    this.model = model;
    this.provider = provider;
    localStorage.setItem('openrouter_api_key', apiKey);
    localStorage.setItem('openrouter_model', model);
    localStorage.setItem('ai_provider', provider);
  }

  public getSettings() {
    return {
      apiKey: this.apiKey,
      model: this.model,
      provider: this.provider,
      isGraniteLoaded: this.graniteModel !== null && this.graniteTokenizer !== null,
      isGraniteLoading: this.isGraniteLoading,
      graniteLoadProgress: this.graniteLoadProgress
    };
  }

  public getLastRequestDuration(): number {
    return this.lastRequestDurationMs;
  }

  /**
   * Load the Granite model for local inference
   */
  public async loadGraniteModel(): Promise<boolean> {
    if (this.graniteModel && this.graniteTokenizer) {
      console.log('[Granite] Model already loaded in memory');
      return true; // Already loaded
    }

    if (this.isGraniteLoading) {
      console.log('[Granite] Model is currently loading...');
      return false; // Already loading
    }

    this.isGraniteLoading = true;
    this.graniteLoadProgress = 0;

    try {
      // Configure transformers.js for browser with caching
      console.log('[Granite] Configuring transformers.js...');
      
      // Enable WASM multi-threading if available
      if (env.backends?.onnx?.wasm) {
        env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency ?? 4;
        console.log('[Granite] WASM threads:', navigator.hardwareConcurrency ?? 4);
      }
      
      // CRITICAL: Enable browser cache and remote models
      env.useBrowserCache = true;
      env.allowRemoteModels = true;
      env.allowLocalModels = false; // We're loading from HuggingFace Hub
      
      // Set cache directory (uses IndexedDB in browser)
      // This ensures the model is cached and reused
      console.log('[Granite] Browser cache enabled:', env.useBrowserCache);
      console.log('[Granite] Cache dir:', env.cacheDir);

      this.onGraniteLoadProgress?.(5, 'Checking cache...');
      console.log('[Granite] Loading tokenizer from:', GRANITE_MODEL_ID);
      console.time('[Granite] Tokenizer load time');
      
      this.onGraniteLoadProgress?.(10, 'Loading tokenizer...');
      this.graniteTokenizer = await AutoTokenizer.from_pretrained(GRANITE_MODEL_ID, {
        progress_callback: (progress: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
          if (progress.status === 'download' && progress.file) {
            const pct = progress.progress ? Math.round(progress.progress) : 0;
            console.log(`[Granite] Downloading tokenizer: ${progress.file} - ${pct}%`);
          } else if (progress.status === 'done') {
            console.log(`[Granite] Tokenizer file loaded: ${progress.file}`);
          } else if (progress.status === 'cached') {
            console.log(`[Granite] Tokenizer loaded from cache: ${progress.file}`);
          }
        }
      });
      console.timeEnd('[Granite] Tokenizer load time');
      
      this.onGraniteLoadProgress?.(30, 'Loading model (this may take a while)...');
      console.log('[Granite] Loading model from:', GRANITE_MODEL_ID);
      console.time('[Granite] Model load time');
      
      this.graniteModel = await AutoModelForCausalLM.from_pretrained(GRANITE_MODEL_ID, {
        dtype: "q4",
        device: "webgpu",
        progress_callback: (progress: { status: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
          if (progress.status === 'download' && progress.file) {
            const pct = progress.progress ? Math.round(progress.progress) : 0;
            const loadedMB = progress.loaded ? (progress.loaded / 1024 / 1024).toFixed(1) : '?';
            const totalMB = progress.total ? (progress.total / 1024 / 1024).toFixed(1) : '?';
            console.log(`[Granite] Downloading: ${progress.file} - ${pct}% (${loadedMB}/${totalMB} MB)`);
            this.onGraniteLoadProgress?.(30 + pct * 0.65, `Downloading model: ${pct}%`);
          } else if (progress.status === 'done') {
            console.log(`[Granite] Model file loaded: ${progress.file}`);
          } else if (progress.status === 'cached') {
            console.log(`[Granite] Model loaded from cache: ${progress.file}`);
            this.onGraniteLoadProgress?.(90, 'Loading from cache...');
          } else if (progress.status === 'initiate') {
            console.log(`[Granite] Initiating: ${progress.file}`);
          } else if (progress.status === 'ready') {
            console.log(`[Granite] Ready: ${progress.file}`);
          } else {
            console.log(`[Granite] Progress:`, progress);
          }
        }
      });
      console.timeEnd('[Granite] Model load time');

      this.onGraniteLoadProgress?.(100, 'Model loaded!');
      this.isGraniteLoading = false;
      console.log('[Granite] Model successfully loaded and ready!');
      return true;
    } catch (error) {
      console.error("[Granite] Error loading model:", error);
      this.isGraniteLoading = false;
      this.graniteModel = null;
      this.graniteTokenizer = null;
      throw error;
    }
  }

  /**
   * Check if Granite model is ready
   */
  public isGraniteReady(): boolean {
    return this.graniteModel !== null && this.graniteTokenizer !== null;
  }

  public async simulatePlay(offensePlay: Play, defensePlay: Play, history: string[]): Promise<SimulationResult> {
    const startTime = performance.now();
    try {
      let result: SimulationResult;
      if (this.provider === 'granite') {
        result = await this.simulatePlayWithGranite(offensePlay, defensePlay, history);
      } else {
        result = await this.simulatePlayWithOpenRouter(offensePlay, defensePlay, history);
      }
      this.lastRequestDurationMs = performance.now() - startTime;
      this.onRequestComplete?.(this.lastRequestDurationMs);
      return result;
    } catch (error) {
      this.lastRequestDurationMs = performance.now() - startTime;
      this.onRequestComplete?.(this.lastRequestDurationMs);
      throw error;
    }
  }

  /**
   * Simulate play using local Granite model
   */
  private async simulatePlayWithGranite(offensePlay: Play, defensePlay: Play, _history: string[]): Promise<SimulationResult> {
    if (!this.graniteModel || !this.graniteTokenizer) {
      throw new Error("Granite model not loaded. Please load the model first in Settings.");
    }

    console.log('[Granite] Starting play simulation...');
    console.time('[Granite] Total simulation time');

    // Calculate chance modifiers based on play matchup
    const chanceContext = this.calculateChanceModifiers(offensePlay, defensePlay);
    
    // Get formation starting positions
    const offenseFormation = this.getFormationPositions(offensePlay.formation, 'offense');
    const defenseFormation = this.getFormationPositions(defensePlay.formation, 'defense');

    const prompt = `You are a football simulation engine. Generate JSON for a play simulation.

PLAY MATCHUP:
Offense: ${offensePlay.name} - ${offensePlay.description}
Defense: ${defensePlay.name} - ${defensePlay.description}

FORMATIONS:
${offenseFormation}
${defenseFormation}

CHANCE FACTORS:
${chanceContext}

Generate a JSON response with this exact structure:
{
  "outcome": "touchdown|tackle|incomplete|interception|turnover",
  "yardsGained": <number>,
  "summary": "<brief play description>",
  "keyframes": [
    {"t": 0, "b": [0,0,0], "p": [["off_1",x,z,0,"idle"], ...], "e": ["snap"]},
    {"t": 5, "b": [x,y,z], "p": [["off_1",x,z,rot,"sprint"], ...], "e": []},
    ...
  ]
}

Output ONLY valid JSON, no other text:`;

    console.log('[Granite] Prompt length:', prompt.length, 'characters');

    try {
      const messages = [
        {
          role: "user",
          content: prompt
        }
      ];

      // Apply chat template
      console.log('[Granite] Applying chat template...');
      console.time('[Granite] Chat template');
      const chatInput = this.graniteTokenizer.apply_chat_template(messages, {
        add_generation_prompt: true,
        return_dict: true,
      }) as Record<string, unknown>;
      console.timeEnd('[Granite] Chat template');

      const inputIds = chatInput.input_ids as { dims: number[] };
      console.log('[Granite] Input token count:', inputIds.dims[1]);

      // Generate response
      console.log('[Granite] Starting generation (max_new_tokens: 2048)...');
      console.time('[Granite] Model generation');
      const generateResult = await (this.graniteModel as any).generate({
        ...chatInput,
        max_new_tokens: 2048,
        do_sample: true,
        temperature: 0.7,
        return_dict_in_generate: true,
      });
      console.timeEnd('[Granite] Model generation');

      const outputTokenCount = generateResult.sequences.dims?.[1] - inputIds.dims[1];
      console.log('[Granite] Output token count:', outputTokenCount);

      // Decode response
      console.log('[Granite] Decoding response...');
      console.time('[Granite] Decode');
      const response = this.graniteTokenizer.batch_decode(
        generateResult.sequences.slice(null, [inputIds.dims[1], null]),
        { skip_special_tokens: true }
      )[0];
      console.timeEnd('[Granite] Decode');

      console.log("[Granite] Raw response:", response);
      console.log("[Granite] Response length:", response.length, 'characters');

      // Parse the JSON from response
      console.log('[Granite] Parsing JSON...');
      let jsonContent = response.trim();
      jsonContent = this.stripMarkdownCodeFences(jsonContent);
      jsonContent = this.stripJsonComments(jsonContent);
      
      // Try to extract JSON from the response
      const jsonMatch = jsonContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[Granite] No JSON found in response');
        throw new Error("Could not find JSON in Granite response");
      }
      jsonContent = jsonMatch[0];
      console.log('[Granite] Extracted JSON length:', jsonContent.length);

      let compressed: CompressedSimulation & { yardsGained: number };
      try {
        compressed = JSON.parse(jsonContent);
        console.log('[Granite] JSON parsed successfully');
      } catch (parseError) {
        console.error("[Granite] Failed to parse JSON:", jsonContent);
        console.log('[Granite] Falling back to generated simulation');
        // Generate a fallback simple result
        compressed = this.generateFallbackSimulation(offensePlay, defensePlay);
      }

      // Sanitize the response
      compressed = this.sanitizeCompressedSimulation(compressed);

      console.log(`[Granite] Received ${compressed.keyframes.length} keyframes, expanding with interpolation...`);

      // Expand keyframes to full frames
      const frames = expandKeyframes(compressed, 10, 'linear');

      console.log(`[Granite] Expanded to ${frames.length} frames`);

      const result: SimulationResult = {
        outcome: compressed.outcome,
        summary: compressed.summary,
        frames
      };

      const parsed = SimulationSchema.parse(result);
      console.timeEnd('[Granite] Total simulation time');
      console.log('[Granite] Simulation complete:', parsed.outcome, '-', parsed.summary);
      return parsed as SimulationResult;

    } catch (error) {
      console.timeEnd('[Granite] Total simulation time');
      console.error("[Granite] Simulation failed:", error);
      throw error;
    }
  }

  /**
   * Generate a fallback simulation when Granite output is invalid
   */
  private generateFallbackSimulation(offensePlay: Play, defensePlay: Play): CompressedSimulation & { yardsGained: number } {
    const outcomes = ["touchdown", "tackle", "incomplete", "interception"] as const;
    const outcome = outcomes[Math.floor(Math.random() * outcomes.length)];
    const yardsGained = outcome === "touchdown" ? 50 : 
                        outcome === "incomplete" ? 0 : 
                        outcome === "interception" ? 0 : 
                        Math.floor(Math.random() * 15) - 2;

    return {
      outcome,
      yardsGained,
      summary: `${offensePlay.name} vs ${defensePlay.name}: ${outcome}`,
      keyframes: [
        { t: 0, b: [0, 0, 0], p: this.generateBasicPlayerPositions(0), e: ["snap"] },
        { t: 10, b: [0, 1, 5], p: this.generateBasicPlayerPositions(5), e: [] },
        { t: 20, b: [0, 0, yardsGained], p: this.generateBasicPlayerPositions(yardsGained), e: [outcome] }
      ]
    };
  }

  /**
   * Generate basic player positions for fallback
   */
  private generateBasicPlayerPositions(zOffset: number): [string, number, number, number, string][] {
    const players: [string, number, number, number, string][] = [];
    for (let i = 1; i <= 11; i++) {
      players.push([`off_${i}`, (i - 6) * 2, -5 + zOffset, 0, "sprint"]);
    }
    for (let i = 1; i <= 11; i++) {
      players.push([`def_${i}`, (i - 6) * 2, 5 + zOffset * 0.5, 180, "sprint"]);
    }
    return players;
  }

  /**
   * Simulate play using OpenRouter API
   */
  private async simulatePlayWithOpenRouter(offensePlay: Play, defensePlay: Play, history: string[]): Promise<SimulationResult> {
    if (!this.apiKey) {
      throw new Error("OpenRouter API Key is missing. Please set it in Settings.");
    }

    // Calculate chance modifiers based on play matchup
    const chanceContext = this.calculateChanceModifiers(offensePlay, defensePlay);
    
    // Get formation starting positions
    const offenseFormation = this.getFormationPositions(offensePlay.formation, 'offense');
    const defenseFormation = this.getFormationPositions(defensePlay.formation, 'defense');

    const systemPrompt = `You are a football simulation engine. Generate COMPRESSED keyframes for a play.

CRITICAL: Output ONLY 6-10 keyframes total (at ticks 0, 5, 10, 15, 20, 25, etc). These will be interpolated to smooth animation.

Field coordinates:
- LOS (line of scrimmage) at z=0
- Offense starts at negative z (behind LOS)
- Defense starts at positive z (ahead of LOS)  
- Ball starts at {x: 0, y: 0, z: 0}
- Positive z = downfield toward defense's endzone
- x: -26.5 to 26.5 (sidelines)

STARTING FORMATIONS (Tick 0 - USE THESE EXACT POSITIONS):
${offenseFormation}
${defenseFormation}

CHANCE FACTORS FOR THIS PLAY:
${chanceContext}

PLAYER BEHAVIOR RULES:
1. OFFENSE VELOCITY: Offensive skill players (WRs, RBs, TEs) should move at realistic speeds:
   - Sprint speed: ~8-10 yards per tick when running routes
   - After catch: 6-8 yards per tick
   - Linemen blocking: 1-2 yards movement max

2. DEFENSE IDLE BEHAVIOR: If a defensive player has no direct assignment or loses their target:
   - They should LOCK ON to the nearest offensive player
   - Move toward that player aggressively
   - Prioritize: ball carrier > nearest receiver > QB

3. COLLISION/SHAKE MECHANIC: When a defender collides with an offensive ball carrier:
   - 30% chance: Offense "shakes" the defender (breaks tackle, continues moving)
   - 50% chance: Tackle occurs (play ends)
   - 20% chance: Defender slows down the runner but doesn't fully tackle

Use these factors to determine realistic outcomes. Include variability - not every play goes as planned.

Player IDs (USE THESE EXACT IDs):
- Offense: off_1 through off_11
- Defense: def_1 through def_11

Animations: idle, sprint, backpedal, throw, catch, tackle, fall, block

Output format (COMPACT):
{
  "outcome": "touchdown|tackle|incomplete|interception|turnover",
  "yardsGained": <number>,
  "summary": "<brief play description>",
  "keyframes": [
    {"t": 0, "b": [x,y,z], "p": [["off_1",x,z,rot,"idle"], ...], "e": ["snap"]},
    {"t": 5, "b": [x,y,z], "p": [["off_1",x,z,rot,"sprint"], ...], "e": []},
    ...
  ]
}`;

    const userPrompt = `Offense: ${offensePlay.name} - ${offensePlay.description}
Defense: ${defensePlay.name} - ${defensePlay.description}
${history.length > 0 ? `Recent plays: ${history.slice(-3).join("; ")}` : ""}

Generate 6-10 keyframes showing the play from snap to whistle. START with formation positions at tick 0.`;

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin,
          "X-Title": "Football America 2025",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 8000, // Reduced - we need much less with compression
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "compressed_simulation",
              strict: true,
              schema: COMPRESSED_SIMULATION_SCHEMA
            }
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      
      // Check if the response was completed
      const finishReason = data.choices?.[0]?.finish_reason;
      if (!finishReason || finishReason === 'length') {
        console.error("API response was truncated:", data);
        throw new Error("AI response was truncated (incomplete). The model may have hit its output token limit. Try a different model or simplify the request.");
      }
      
      const content = data.choices[0].message.content;
      
      if (!content || content.trim() === '') {
        throw new Error("AI returned an empty response. Please try again.");
      }
      
      // Strip markdown code fences if present
      let jsonContent = content.trim();
      jsonContent = this.stripMarkdownCodeFences(jsonContent);
      
      // Strip JavaScript-style comments (some models add // comments to JSON)
      jsonContent = this.stripJsonComments(jsonContent);
      
      // Parse the compressed format
      let compressed: CompressedSimulation & { yardsGained: number };
      try {
        compressed = JSON.parse(jsonContent);
      } catch (parseError) {
        console.error("Failed to parse AI response as JSON:", jsonContent);
        throw new Error(`AI returned invalid JSON. This may be due to a truncated response. Error: ${parseError instanceof Error ? parseError.message : 'Unknown parse error'}`);
      }
      
      // Sanitize the response - fix invalid values
      compressed = this.sanitizeCompressedSimulation(compressed);
      
      console.log(`Received ${compressed.keyframes.length} keyframes, expanding with interpolation...`);
      
      // Expand keyframes to full frames using linear interpolation
      const frames = expandKeyframes(compressed, 10, 'linear');
      
      console.log(`Expanded to ${frames.length} frames`);
      
      // Build the full result
      const result: SimulationResult = {
        outcome: compressed.outcome,
        summary: compressed.summary,
        frames
      };
      
      // Validate with Zod
      const parsed = SimulationSchema.parse(result);
      
      return parsed as SimulationResult;

    } catch (error) {
      console.error("Simulation failed:", error);
      throw error;
    }
  }

  /**
   * Calculate chance modifiers based on play matchup
   * Returns context string for the AI prompt
   */
  private calculateChanceModifiers(offensePlay: Play, defensePlay: Play): string {
    const modifiers: string[] = [];
    
    // Analyze play types for advantages/disadvantages
    const offenseType = offensePlay.type.toLowerCase();
    const offenseName = offensePlay.name.toLowerCase();
    const defenseName = defensePlay.name.toLowerCase();
    
    // Run vs Pass detection
    const isRunPlay = offenseType.includes('run') || offenseName.includes('run') || 
                      offenseName.includes('dive') || offenseName.includes('sweep') ||
                      offenseName.includes('draw') || offenseName.includes('iso');
    const isPassPlay = offenseType.includes('pass') || offenseName.includes('pass') ||
                       offenseName.includes('slant') || offenseName.includes('streak') ||
                       offenseName.includes('screen') || offenseName.includes('out');
    
    // Defense type detection
    const isZoneCoverage = defenseName.includes('zone') || defenseName.includes('cover 2') ||
                          defenseName.includes('cover 3') || defenseName.includes('cover 4');
    const isManCoverage = defenseName.includes('man') || defenseName.includes('cover 1') ||
                          defenseName.includes('press');
    const isBlitz = defenseName.includes('blitz') || defenseName.includes('pressure');
    const isRunDefense = defenseName.includes('run') || defenseName.includes('goal line') ||
                         defenseName.includes('stuff') || defenseName.includes('stack');
    
    // Calculate matchup advantages
    if (isRunPlay) {
      if (isRunDefense) {
        modifiers.push("DEFENSE ADVANTAGE: Run defense vs run play. 60% chance of tackle for loss or minimal gain (0-2 yards).");
        modifiers.push("20% chance of average gain (3-5 yards), 20% chance of good gain (6+ yards).");
      } else if (isBlitz) {
        modifiers.push("NEUTRAL: Blitz vs run. Could go either way - 40% big loss, 30% small gain, 30% big gain if RB finds hole.");
      } else {
        modifiers.push("OFFENSE ADVANTAGE: Pass defense vs run play. 50% chance of good gain (5-8 yards).");
        modifiers.push("30% chance of big gain (10+ yards), 20% chance of tackle at line.");
      }
    }
    
    if (isPassPlay) {
      if (isBlitz) {
        modifiers.push("HIGH RISK/REWARD: Blitz vs pass. QB has ~2.5 seconds max.");
        modifiers.push("30% sack/pressure, 25% incomplete, 25% short gain, 20% big play.");
      } else if (isManCoverage) {
        modifiers.push("CONTESTED: Man coverage. Depends on route timing.");
        modifiers.push("35% incomplete, 35% short gain (3-7 yards), 20% medium gain (8-15), 10% big play.");
      } else if (isZoneCoverage) {
        modifiers.push("ZONE WINDOWS: Zone coverage. QB can find soft spots.");
        modifiers.push("25% incomplete, 40% short gain, 25% medium gain, 10% interception risk if forced.");
      }
    }
    
    // Screen play special case
    if (offenseName.includes('screen')) {
      if (isBlitz) {
        modifiers.push("OFFENSE ADVANTAGE: Screen beats blitz! 50% big gain (10+ yards), 30% medium gain, 20% tackle for loss if read.");
      } else {
        modifiers.push("Screen play: 40% small gain (2-5), 35% medium gain (6-10), 15% big gain, 10% loss.");
      }
    }
    
    // Play action
    if (offenseName.includes('play action') || offenseName.includes('pa ')) {
      if (isRunDefense) {
        modifiers.push("OFFENSE ADVANTAGE: Play action freezes run defense. Extra time for routes.");
        modifiers.push("40% medium-big gain, 35% short gain, 25% incomplete.");
      }
    }
    
    // Add some randomness instruction
    modifiers.push("");
    modifiers.push("IMPORTANT: Add realistic variability. Players don't execute perfectly every time.");
    modifiers.push("Include some element of chance - maybe a dropped pass, a missed tackle, or a great individual effort.");
    
    return modifiers.join("\n");
  }

  /**
   * Get formatted formation positions for AI prompt
   */
  private getFormationPositions(formationName: string, side: 'offense' | 'defense'): string {
    const formations = side === 'offense' ? playbook.formations.offense : playbook.formations.defense;
    const formation = formations[formationName];
    
    if (!formation) {
      console.warn(`Formation "${formationName}" not found for ${side}, using default`);
      // Use first available formation as fallback
      const defaultFormation = Object.values(formations)[0];
      if (!defaultFormation) {
        return `${side.toUpperCase()} formation not found`;
      }
      return this.formatFormationPositions(defaultFormation.positions, side);
    }
    
    return this.formatFormationPositions(formation.positions, side);
  }

  /**
   * Format formation positions for the AI prompt
   */
  private formatFormationPositions(positions: Record<string, { x: number; z: number; role: string }>, side: 'offense' | 'defense'): string {
    const lines = [`${side.toUpperCase()} Starting Positions:`];
    
    for (const [playerId, pos] of Object.entries(positions)) {
      lines.push(`  ${playerId} (${pos.role}): x=${pos.x}, z=${pos.z}`);
    }
    
    return lines.join("\n");
  }

  /**
   * Strip markdown code fences from AI response
   */
  private stripMarkdownCodeFences(content: string): string {
    let result = content.trim();
    
    // Remove opening fence with optional language specifier
    // Matches: ```json, ```JSON, ```, etc.
    result = result.replace(/^```(?:json|JSON)?\s*\n?/i, '');
    
    // Remove closing fence
    result = result.replace(/\n?```\s*$/i, '');
    
    return result.trim();
  }

  /**
   * Strip JavaScript-style comments from JSON string
   * Some models return JSON with // comments which is invalid
   */
  private stripJsonComments(content: string): string {
    // Remove single-line comments (// ...) but be careful not to remove // inside strings
    // Strategy: Process line by line and remove comments that aren't inside string literals
    const lines = content.split('\n');
    const cleanedLines = lines.map(line => {
      // Find the position of // that's not inside a string
      let inString = false;
      let stringChar = '';
      let commentStart = -1;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const prevChar = i > 0 ? line[i - 1] : '';
        
        if (!inString) {
          if (char === '"' || char === "'") {
            inString = true;
            stringChar = char;
          } else if (char === '/' && line[i + 1] === '/' && prevChar !== ':') {
            // Found a comment start (but not in a URL like http://)
            commentStart = i;
            break;
          }
        } else {
          // Inside a string - check for unescaped closing quote
          if (char === stringChar && prevChar !== '\\') {
            inString = false;
            stringChar = '';
          }
        }
      }
      
      if (commentStart !== -1) {
        // Remove the comment, but also trim trailing whitespace and commas
        let cleaned = line.substring(0, commentStart).trimEnd();
        return cleaned;
      }
      return line;
    });
    
    return cleanedLines.join('\n');
  }

  /**
   * Sanitize compressed simulation data - fix invalid enum values
   */
  private sanitizeCompressedSimulation(data: CompressedSimulation & { yardsGained: number }): CompressedSimulation & { yardsGained: number } {
    const validOutcomes = ["touchdown", "tackle", "incomplete", "interception", "turnover"] as const;
    const validAnimations = ["idle", "sprint", "backpedal", "throw", "catch", "tackle", "fall", "block"] as const;
    
    // Fix outcome if invalid
    if (!validOutcomes.includes(data.outcome as any)) {
      console.warn(`Invalid outcome "${data.outcome}", mapping to valid value...`);
      // Map common invalid outcomes to valid ones
      const outcomeLower = data.outcome.toLowerCase();
      if (outcomeLower.includes('gain') || outcomeLower.includes('yards') || outcomeLower.includes('complete')) {
        data.outcome = "tackle"; // A completed play that ended normally
      } else if (outcomeLower.includes('sack') || outcomeLower.includes('loss')) {
        data.outcome = "tackle";
      } else if (outcomeLower.includes('drop') || outcomeLower.includes('miss') || outcomeLower.includes('incomplete')) {
        data.outcome = "incomplete";
      } else if (outcomeLower.includes('intercept') || outcomeLower.includes('pick')) {
        data.outcome = "interception";
      } else if (outcomeLower.includes('fumble') || outcomeLower.includes('turnover')) {
        data.outcome = "turnover";
      } else if (outcomeLower.includes('touchdown') || outcomeLower.includes('td') || outcomeLower.includes('score')) {
        data.outcome = "touchdown";
      } else {
        data.outcome = "tackle"; // Default fallback
      }
    }
    
    // Fix animations in keyframes
    const animationMap: Record<string, typeof validAnimations[number]> = {
      'squat': 'idle',
      'crouch': 'idle',
      'stance': 'idle',
      'set': 'idle',
      'run': 'sprint',
      'running': 'sprint',
      'jog': 'sprint',
      'rush': 'sprint',
      'pass': 'throw',
      'throwing': 'throw',
      'receiving': 'catch',
      'catching': 'catch',
      'tackling': 'tackle',
      'hit': 'tackle',
      'blocking': 'block',
      'falling': 'fall',
      'down': 'fall',
      'back': 'backpedal',
      'retreat': 'backpedal',
    };
    
    for (const keyframe of data.keyframes) {
      for (const player of keyframe.p) {
        const animation = player[4] as string;
        if (!validAnimations.includes(animation as any)) {
          const mapped = animationMap[animation.toLowerCase()];
          if (mapped) {
            player[4] = mapped;
          } else {
            console.warn(`Unknown animation "${animation}", defaulting to "idle"`);
            player[4] = 'idle';
          }
        }
      }
    }
    
    return data;
  }
}

export const aiService = new AIService();

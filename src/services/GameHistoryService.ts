import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GameHistoryEntry } from '../data/types';

interface FootballDB extends DBSchema {
  history: {
    key: number;
    value: GameHistoryEntry;
    indexes: { 'by-timestamp': number };
  };
}

export class GameHistoryService {
  private dbPromise: Promise<IDBPDatabase<FootballDB>>;

  constructor() {
    this.dbPromise = openDB<FootballDB>('football-america-2025', 1, {
      upgrade(db) {
        const store = db.createObjectStore('history', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('by-timestamp', 'timestamp');
      },
    });
  }

  async addEntry(entry: Omit<GameHistoryEntry, 'id'>): Promise<number> {
    const db = await this.dbPromise;
    return db.add('history', entry);
  }

  async getAllEntries(): Promise<GameHistoryEntry[]> {
    const db = await this.dbPromise;
    return db.getAllFromIndex('history', 'by-timestamp');
  }

  async getEntry(id: number): Promise<GameHistoryEntry | undefined> {
    const db = await this.dbPromise;
    return db.get('history', id);
  }

  async clearHistory(): Promise<void> {
    const db = await this.dbPromise;
    return db.clear('history');
  }
}

export const gameHistoryService = new GameHistoryService();

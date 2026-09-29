import express, { Router } from 'express';
import { db } from '../db/index.js';
import { createBackup, listBackups, inspectBackup, stageRestore, backupsDir } from '../services/backup.js';

export const backupRouter = Router();

// Downloads a fresh backup (a copy also stays in data/backups).
backupRouter.get('/export', (_req, res) => {
  const { name, path } = createBackup(db);
  res.download(path, name);
});

backupRouter.get('/', (_req, res) => {
  res.json({ folder: backupsDir, backups: listBackups() });
});

// Validates the upload, stages it, then restarts (start.bat relaunches on exit code 75).
backupRouter.post('/restore', express.raw({ type: 'application/octet-stream', limit: '500mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'No file received.' });
  const counts = inspectBackup(buf);
  stageRestore(buf);
  const autoRestart = process.env.BRJ_LAUNCHER === '1';
  res.json({ ...counts, restart: autoRestart ? 'automatic' : 'manual' });
  if (autoRestart) {
    setTimeout(() => {
      db.close();
      process.exit(75);
    }, 400);
  }
});

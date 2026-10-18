/**
 * API Configuration for Kadr
 * 
 * In development (Vite dev server), the proxy handles /api → backend.
 * In production (Tauri .exe), we need the absolute backend URL.
 */

const isDev = !!(import.meta as any).env?.DEV;

export const API_BASE = isDev ? '' : 'http://127.0.0.1:8000';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

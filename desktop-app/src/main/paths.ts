import { app } from 'electron'
import { join } from 'path'

export function resourcePath(file: string): string {
  if (app.isPackaged) return join(process.resourcesPath, file)
  return join(__dirname, '../../resources', file)
}
